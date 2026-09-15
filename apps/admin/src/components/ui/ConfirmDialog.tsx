import { MotionPresence,MotionSurface } from "@tracegenie/shared/motion";
import { useId,useLayoutEffect,useRef,useState } from "react";
import { createPortal } from "react-dom";

import { Button,ButtonProps } from "./Button";
import { acquireBodyScrollLock } from "./bodyScrollLock";

export type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  confirmTone?: ButtonProps["tone"];
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

type DialogEntry = {
  dialog: HTMLElement;
  restoreChain: HTMLElement[];
  setIsTopmost: (isTopmost: boolean) => void;
};

const openDialogs: DialogEntry[] = [];

function updateDialogStack() {
  const topDialog = openDialogs[openDialogs.length - 1];
  openDialogs.forEach((entry) => entry.setIsTopmost(entry === topDialog));
}

function createRestoreChain(opener: HTMLElement | null) {
  if (!opener) return [];

  for (let index = openDialogs.length - 1; index >= 0; index -= 1) {
    const entry = openDialogs[index];
    if (entry.dialog.contains(opener)) {
      return [opener, ...entry.restoreChain];
    }
  }

  return [opener];
}

function focusConnectedTarget(targets: HTMLElement[]) {
  targets.find((target) => target.isConnected)?.focus();
}

function registerDialog(entry: DialogEntry) {
  openDialogs.push(entry);
  updateDialogStack();

  return () => {
    const index = openDialogs.lastIndexOf(entry);
    if (index < 0) return;

    const wasTopmost = index === openDialogs.length - 1;
    openDialogs.splice(index, 1);
    updateDialogStack();

    if (!wasTopmost) return;

    const nextTop = openDialogs[openDialogs.length - 1];
    if (nextTop) {
      focusFirstControl(nextTop.dialog);
    } else {
      focusConnectedTarget(entry.restoreChain);
    }
  };
}

function isTopDialog(dialog: HTMLElement) {
  return openDialogs[openDialogs.length - 1]?.dialog === dialog;
}

function focusFirstControl(dialog: HTMLElement) {
  const firstControl = dialog.querySelector<HTMLElement>(FOCUSABLE);
  (firstControl ?? dialog).focus();
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  confirmTone = "danger",
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);
  const isPendingRef = useRef(isPending);
  const [isTopmost, setIsTopmost] = useState(false);
  const reactId = useId();
  const titleId = `confirm-dialog-title-${reactId}`;
  const descriptionId = `confirm-dialog-description-${reactId}`;

  useLayoutEffect(() => {
    onConfirmRef.current = onConfirm;
    onCancelRef.current = onCancel;
    isPendingRef.current = isPending;
  }, [isPending, onCancel, onConfirm]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const dialogNode = dialogRef.current;
    if (!dialogNode) return;
    const dialog: HTMLDivElement = dialogNode;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseBodyLock = acquireBodyScrollLock(dialog.ownerDocument);
    const unregisterDialog = registerDialog({
      dialog,
      restoreChain: createRestoreChain(opener),
      setIsTopmost,
    });

    focusFirstControl(dialog);

    function onKeyDown(event: KeyboardEvent) {
      if (!isTopDialog(dialog)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!isPendingRef.current) onCancelRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    function onFocusIn(event: FocusEvent) {
      if (!isTopDialog(dialog) || dialog.contains(event.target as Node)) return;
      focusFirstControl(dialog);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      unregisterDialog();
      releaseBodyLock();
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return;

    if (isTopmost && isOpen) {
      backdrop.removeAttribute("inert");
    } else {
      backdrop.setAttribute("inert", "");
    }
  }, [isTopmost, isOpen]);

  return createPortal(
    <MotionPresence>
    {isOpen ? <MotionSurface kind="fade"
      ref={backdropRef}
      className="tg-fade-in fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4 backdrop-blur-sm"
      aria-hidden={isTopmost ? undefined : true}
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget
          && !isPendingRef.current
          && dialogRef.current
          && isTopDialog(dialogRef.current)
        ) {
          onCancelRef.current();
        }
      }}
    >
      <MotionSurface kind="dialog"
        ref={dialogRef}
        className="tg-dialog-card tg-card w-full max-w-md p-6 shadow-overlay"
        role="dialog"
        tabIndex={-1}
        aria-modal={isTopmost ? "true" : undefined}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isPending}
      >
        <h2 id={titleId} className="text-title text-foreground">{title}</h2>
        <p id={descriptionId} className="mt-2 text-body text-muted">{description}</p>

        <div className="mt-6 flex justify-end gap-2">
          <Button className="min-h-11" tone="secondary" onClick={() => onCancelRef.current()} disabled={isPending}>
            {cancelText}
          </Button>
          <Button className="min-h-11" tone={confirmTone} onClick={() => onConfirmRef.current()} disabled={isPending}>
            {isPending ? "Working…" : confirmText}
          </Button>
        </div>
      </MotionSurface>
    </MotionSurface> : null}
    </MotionPresence>,
    document.body,
  );
}
