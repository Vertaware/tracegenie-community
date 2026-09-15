import { useMemo,useRef,useState } from "react";

import { type NormalizedRect,normalizeRect,rectFromPoints,transformImagePixels } from "../lib/imagePrivacy";

type EditorMode = "crop" | "redact";
type ResizeHandle = "northwest" | "northeast" | "southwest" | "southeast";
type PointerPoint = { x: number; y: number };
type PointerInteraction =
  | { kind: "draw"; start: PointerPoint }
  | { kind: "move"; index: number; start: PointerPoint; origin: NormalizedRect }
  | { kind: "resize"; index: number; handle: ResizeHandle; origin: NormalizedRect };

type ScreenshotPrivacyEditorProps = {
  file: File;
  previewUrl: string;
  onApply: (file: File) => Promise<void>;
  onCancel: () => void;
};

const FULL_IMAGE: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 };
const CENTER_REDACTION: NormalizedRect = { x: 0.3, y: 0.35, width: 0.4, height: 0.2 };
const MIN_REGION_SIZE = 0.02;

function percent(value: number) {
  return Math.round(value * 100);
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rectStyle(rect: NormalizedRect) {
  return {
    left: `${percent(rect.x)}%`,
    top: `${percent(rect.y)}%`,
    width: `${percent(rect.width)}%`,
    height: `${percent(rect.height)}%`,
  };
}

function RangeField(props: {
  label: string;
  value: number;
  maximum?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="tgw-editor-range-field">
      <span>{props.label}</span>
      <input
        type="range"
        min="0"
        max={props.maximum ?? 100}
        step="1"
        value={percent(props.value)}
        aria-label={props.label}
        onChange={(event) => props.onChange(Number(event.target.value) / 100)}
      />
      <span>{percent(props.value)}%</span>
    </label>
  );
}

export function ScreenshotPrivacyEditor(props: ScreenshotPrivacyEditorProps) {
  const [mode, setMode] = useState<EditorMode>("redact");
  const [crop, setCrop] = useState<NormalizedRect>(FULL_IMAGE);
  const [redactions, setRedactions] = useState<NormalizedRect[]>([]);
  const [selectedRedaction, setSelectedRedaction] = useState<number | null>(null);
  const [draftRect, setDraftRect] = useState<NormalizedRect | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pointerInteractionRef = useRef<PointerInteraction | null>(null);
  const activeRedaction = selectedRedaction === null ? null : redactions[selectedRedaction] ?? null;
  const hasChanges = useMemo(
    () => crop.x !== 0 || crop.y !== 0 || crop.width !== 1 || crop.height !== 1 || redactions.length > 0,
    [crop, redactions.length],
  );

  function pointerPosition(clientX: number, clientY: number) {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: clamp((clientX - bounds.left) / bounds.width),
      y: clamp((clientY - bounds.top) / bounds.height),
    };
  }

  function startDrawing(event: React.PointerEvent<HTMLDivElement>) {
    if (saving || event.button !== 0) return;
    const point = pointerPosition(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerInteractionRef.current = { kind: "draw", start: point };
    setDraftRect({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function startMoving(event: React.PointerEvent<HTMLDivElement>, index: number) {
    if (saving || event.button !== 0) return;
    event.stopPropagation();
    stageRef.current?.setPointerCapture(event.pointerId);
    setSelectedRedaction(index);
    pointerInteractionRef.current = {
      kind: "move",
      index,
      start: pointerPosition(event.clientX, event.clientY),
      origin: redactions[index],
    };
  }

  function startResizing(event: React.PointerEvent<HTMLSpanElement>, index: number, handle: ResizeHandle) {
    if (saving || event.button !== 0) return;
    event.stopPropagation();
    stageRef.current?.setPointerCapture(event.pointerId);
    setSelectedRedaction(index);
    pointerInteractionRef.current = { kind: "resize", index, handle, origin: redactions[index] };
  }

  function resizedRect(origin: NormalizedRect, handle: ResizeHandle, point: PointerPoint) {
    const right = origin.x + origin.width;
    const bottom = origin.y + origin.height;
    const left = handle === "northwest" || handle === "southwest"
      ? clamp(point.x, 0, right - MIN_REGION_SIZE)
      : origin.x;
    const top = handle === "northwest" || handle === "northeast"
      ? clamp(point.y, 0, bottom - MIN_REGION_SIZE)
      : origin.y;
    const nextRight = handle === "northeast" || handle === "southeast"
      ? clamp(point.x, origin.x + MIN_REGION_SIZE, 1)
      : right;
    const nextBottom = handle === "southwest" || handle === "southeast"
      ? clamp(point.y, origin.y + MIN_REGION_SIZE, 1)
      : bottom;
    return { x: left, y: top, width: nextRight - left, height: nextBottom - top };
  }

  function continuePointerInteraction(event: React.PointerEvent<HTMLDivElement>) {
    const interaction = pointerInteractionRef.current;
    if (!interaction) return;
    const point = pointerPosition(event.clientX, event.clientY);
    if (interaction.kind === "draw") {
      setDraftRect(rectFromPoints(interaction.start.x, interaction.start.y, point.x, point.y));
      return;
    }
    setRedactions((current) => current.map((rect, index) => {
      if (index !== interaction.index) return rect;
      if (interaction.kind === "move") {
        return {
          ...interaction.origin,
          x: clamp(interaction.origin.x + point.x - interaction.start.x, 0, 1 - interaction.origin.width),
          y: clamp(interaction.origin.y + point.y - interaction.start.y, 0, 1 - interaction.origin.height),
        };
      }
      return resizedRect(interaction.origin, interaction.handle, point);
    }));
  }

  function finishPointerInteraction(event: React.PointerEvent<HTMLDivElement>) {
    const interaction = pointerInteractionRef.current;
    if (!interaction) return;
    pointerInteractionRef.current = null;
    if (interaction.kind !== "draw") return;
    const point = pointerPosition(event.clientX, event.clientY);
    const nextRect = rectFromPoints(interaction.start.x, interaction.start.y, point.x, point.y);
    setDraftRect(null);
    if (nextRect.width < MIN_REGION_SIZE || nextRect.height < MIN_REGION_SIZE) return;
    if (mode === "crop") {
      setCrop(nextRect);
    } else {
      setRedactions((current) => {
        setSelectedRedaction(current.length);
        return [...current, nextRect];
      });
    }
  }

  function updateCrop(patch: Partial<NormalizedRect>) {
    setCrop((current) => normalizeRect({ ...current, ...patch }));
  }

  function updateSelectedRedaction(patch: Partial<NormalizedRect>) {
    if (selectedRedaction === null) return;
    setRedactions((current) => current.map((rect, index) => (
      index === selectedRedaction ? normalizeRect({ ...rect, ...patch }) : rect
    )));
  }

  function addKeyboardRedaction() {
    setRedactions((current) => {
      setSelectedRedaction(current.length);
      return [...current, CENTER_REDACTION];
    });
    setMode("redact");
  }

  function removeSelectedRedaction() {
    if (selectedRedaction === null) return;
    setRedactions((current) => current.filter((_, index) => index !== selectedRedaction));
    setSelectedRedaction(null);
  }

  async function applyChanges() {
    if (!hasChanges) {
      props.onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const protectedFile = await transformImagePixels(props.file, { crop, redactions });
      await props.onApply(protectedFile);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The protected image could not be created.");
      setSaving(false);
    }
  }

  return (
    <section id="tgw-screenshot-editor" className="tgw-screenshot-editor" aria-label="Screenshot privacy editor">
      <div className="tgw-editor-header">
        <div className="tgw-editor-heading">
          <h3>Protect screenshot</h3>
          <p>Crop the image and cover anything private before attaching it.</p>
        </div>
        <button type="button" className="tgw-text-button" onClick={props.onCancel} disabled={saving}>
          Cancel
        </button>
      </div>

      <div className="tgw-editor-mode" role="group" aria-label="Screenshot edit mode">
        <button type="button" aria-pressed={mode === "crop"} onClick={() => setMode("crop")}>
          Crop
        </button>
        <button type="button" aria-pressed={mode === "redact"} onClick={() => setMode("redact")}>
          Redact
        </button>
      </div>

      <div
        ref={stageRef}
        className={`tgw-editor-stage tgw-editor-stage--${mode}`}
        onPointerDown={startDrawing}
        onPointerMove={continuePointerInteraction}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={() => {
          pointerInteractionRef.current = null;
          setDraftRect(null);
        }}
      >
        <img src={props.previewUrl} alt="Screenshot being protected" draggable={false} />
        {crop.x !== 0 || crop.y !== 0 || crop.width !== 1 || crop.height !== 1 ? (
          <span className="tgw-editor-crop-region" style={rectStyle(crop)} aria-hidden="true" />
        ) : null}
        {redactions.map((rect, index) => (
          <div
            key={index}
            role="button"
            tabIndex={0}
            className="tgw-editor-redaction-region"
            style={rectStyle(rect)}
            aria-label={`Redaction ${index + 1}`}
            aria-pressed={selectedRedaction === index}
            onPointerDown={(event) => startMoving(event, index)}
            onClick={() => setSelectedRedaction(index)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedRedaction(index);
              }
            }}
          >
            {(["northwest", "northeast", "southwest", "southeast"] as const).map((handle) => (
              <span
                key={handle}
                className={`tgw-editor-resize-handle tgw-editor-resize-handle--${handle}`}
                aria-label={`Resize redaction ${index + 1} from ${handle === "northwest" ? "top left" : handle === "northeast" ? "top right" : handle === "southwest" ? "bottom left" : "bottom right"}`}
                onPointerDown={(event) => startResizing(event, index, handle)}
              />
            ))}
          </div>
        ))}
        {draftRect ? (
          <span className={`tgw-editor-draft-region tgw-editor-draft-region--${mode}`} style={rectStyle(draftRect)} aria-hidden="true" />
        ) : null}
      </div>

      <div className="tgw-editor-controls">
        {mode === "crop" ? (
          <details className="tgw-editor-precise-controls">
            <summary>Precise controls</summary>
            <div className="tgw-editor-range-grid" aria-label="Crop boundaries">
              <RangeField label="Crop left" value={crop.x} maximum={95} onChange={(x) => updateCrop({ x })} />
              <RangeField label="Crop top" value={crop.y} maximum={95} onChange={(y) => updateCrop({ y })} />
              <RangeField label="Crop width" value={crop.width} maximum={100 - percent(crop.x)} onChange={(width) => updateCrop({ width })} />
              <RangeField label="Crop height" value={crop.height} maximum={100 - percent(crop.y)} onChange={(height) => updateCrop({ height })} />
            </div>
          </details>
        ) : (
          <div className="tgw-editor-redaction-controls">
            <div className="tgw-editor-control-actions">
              <button type="button" className="tgw-text-button" onClick={addKeyboardRedaction}>
                Add redaction
              </button>
              <button type="button" className="tgw-text-button" onClick={removeSelectedRedaction} disabled={selectedRedaction === null}>
                Remove selected
              </button>
              <button type="button" className="tgw-text-button" onClick={() => { setRedactions([]); setSelectedRedaction(null); }} disabled={redactions.length === 0}>
                Clear all
              </button>
            </div>
            {activeRedaction ? (
              <details className="tgw-editor-precise-controls">
                <summary>Precise controls</summary>
                <div className="tgw-editor-range-grid" aria-label="Selected redaction boundaries">
                  <RangeField label="Redaction left" value={activeRedaction.x} maximum={95} onChange={(x) => updateSelectedRedaction({ x })} />
                  <RangeField label="Redaction top" value={activeRedaction.y} maximum={95} onChange={(y) => updateSelectedRedaction({ y })} />
                  <RangeField label="Redaction width" value={activeRedaction.width} maximum={100 - percent(activeRedaction.x)} onChange={(width) => updateSelectedRedaction({ width })} />
                  <RangeField label="Redaction height" value={activeRedaction.height} maximum={100 - percent(activeRedaction.y)} onChange={(height) => updateSelectedRedaction({ height })} />
                </div>
              </details>
            ) : (
              <p className="tgw-editor-help">Drag over private content or add a keyboard-adjustable region.</p>
            )}
          </div>
        )}
      </div>

      {error ? <p className="tgw-editor-error" role="alert">{error}</p> : null}

      <div className="tgw-editor-footer">
        <span>{redactions.length} redaction{redactions.length === 1 ? "" : "s"}</span>
        <button type="button" className="tgw-button-primary tgw-editor-apply" onClick={() => void applyChanges()} disabled={saving}>
          {saving ? "Protecting image..." : "Apply protection"}
        </button>
      </div>
    </section>
  );
}
