import { MotionPresence,MotionSurface } from "@tracegenie/shared/motion";
import { useId,useLayoutEffect,useRef,useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties,KeyboardEvent as ReactKeyboardEvent,MouseEvent as ReactMouseEvent,PropsWithChildren,ReactNode } from "react";
import { ChevronDown,ChevronRight,ChevronUp,ChevronsUpDown,Search } from "lucide-react";

import { cn } from "../../lib/utils";

export { SkeletonTableRows as ListLoadingState } from "./SkeletonLoader";

const HEADER_FILTER_MENU_WIDTH = 288;
const HEADER_FILTER_MENU_GAP = 8;
const HEADER_FILTER_MENU_MARGIN = 12;
const HEADER_FILTER_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/*
 * Table primitives shared by every list surface. One density, one header
 * treatment, one row interaction model (keyboard included).
 */

export function TableShell({ children, className, id }: PropsWithChildren<{ className?: string; id?: string }>) {
  return (
    <div id={id} className={cn("tg-card overflow-hidden p-0 transition-shadow", className)}>
      {children}
    </div>
  );
}

export function Table({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <table className={cn("min-w-full border-collapse text-body", className)}>{children}</table>;
}

/**
 * Lists keep their decision-making columns at 1280px. Supporting and secondary
 * data stays available from the row detail route and the mobile card instead of
 * forcing a horizontal scroll in the working table view.
 */
export type TableColumnPriority = "essential" | "supporting" | "secondary";

export const TABLE_COLUMN_PRIORITY_CLASS: Record<TableColumnPriority, string> = {
  essential: "",
  supporting: "hidden min-[1281px]:table-cell",
  secondary: "hidden min-[1281px]:table-cell",
};

export function tableColumnClass(priority: TableColumnPriority, className?: string) {
  return cn(TABLE_COLUMN_PRIORITY_CLASS[priority], className);
}

export function TableDetailAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="tg-action-button inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
    >
      <ChevronRight className="size-4" aria-hidden="true" />
    </button>
  );
}

type SortState<K extends string> = {
  sortKey: K;
  sortDir: "asc" | "desc";
};

export function Th<K extends string>({
  children,
  sortable,
  col,
  sort,
  onSort,
  className,
  action,
}: PropsWithChildren<{
  sortable?: boolean;
  col?: K;
  sort?: SortState<K>;
  onSort?: (col: K) => void;
  className?: string;
  action?: ReactNode;
}>) {
  const base = "px-4 py-2.5 text-left text-caption font-medium text-muted";

  if (!sortable || !col || !onSort) {
    return (
      <th className={cn(base, className)}>
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0">{children}</span>
          {action ? <span className="shrink-0">{action}</span> : null}
        </div>
      </th>
    );
  }

  const isActive = sort?.sortKey === col;

  return (
    <th className={cn(base, "p-0", className)} aria-sort={isActive ? (sort?.sortDir === "asc" ? "ascending" : "descending") : undefined}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onSort(col)}
          className="tg-action-button flex w-full items-center gap-1 px-4 py-2.5 text-left text-caption font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        >
          {children}
          {isActive ? (
            sort?.sortDir === "asc" ? (
              <ChevronUp className="size-3 text-primary" />
            ) : (
              <ChevronDown className="size-3 text-primary" />
            )
          ) : (
            <ChevronsUpDown className="size-3 text-muted/50" />
          )}
        </button>
        {action ? <span className="shrink-0 pr-2">{action}</span> : null}
      </div>
    </th>
  );
}

/** Shared selection contract for table rows that retain a separate activation control. */
export type TableRowSelection = {
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onCheckedChange: (checked: boolean) => void;
};

export type TableSelectionHeaderProps = {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onCheckedChange: (checked: boolean) => void;
};

function SelectionCheckbox({
  checked,
  disabled,
  ariaLabel,
  onCheckedChange,
  indeterminate = false,
}: TableRowSelection & { indeterminate?: boolean }) {
  const checkboxRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      aria-label={ariaLabel}
      aria-checked={indeterminate ? "mixed" : checked}
      className="size-4 rounded border-border text-primary focus-visible:outline-2 focus-visible:outline-primary"
      checked={checked}
      disabled={disabled}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  );
}

export function TableSelectionHeader({
  checked,
  indeterminate = false,
  disabled,
  ariaLabel,
  onCheckedChange,
}: TableSelectionHeaderProps) {
  return (
    <Th className="w-12">
      <SelectionCheckbox
        checked={checked}
        indeterminate={indeterminate}
        disabled={disabled}
        ariaLabel={ariaLabel}
        onCheckedChange={onCheckedChange}
      />
    </Th>
  );
}

const INTERACTIVE_ROW_TARGET = "a[href], button, input, select, textarea, [role='button'], [role='link']";

/** Clickable row, with a native table-row selection mode when a checkbox is present. */
export function RowButton({
  children,
  onActivate,
  selected,
  ariaLabel,
  id,
  selection,
  activationControl = false,
}: PropsWithChildren<{
  onActivate: () => void;
  selected?: boolean;
  ariaLabel?: string;
  id?: string;
  selection?: TableRowSelection;
  activationControl?: boolean;
}>) {
  const isSelected = selection?.checked ?? selected ?? false;
  const rowProvidesActivation = !selection && !activationControl;

  function onKeyDown(event: ReactKeyboardEvent<HTMLTableRowElement>) {
    if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
      event.preventDefault();
      onActivate();
    }
  }

  function onClick(event: ReactMouseEvent<HTMLTableRowElement>) {
    if (selection && event.target instanceof Element && event.target.closest(INTERACTIVE_ROW_TARGET)) return;
    onActivate();
  }

  return (
    <tr
      id={id}
      role={rowProvidesActivation ? "button" : undefined}
      tabIndex={rowProvidesActivation ? 0 : undefined}
      aria-selected={selection ? isSelected : selected ? true : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={rowProvidesActivation ? onKeyDown : undefined}
      className={cn(
        "tg-row-button group cursor-pointer transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
        isSelected ? "bg-primary-light/60" : "hover:bg-surface-muted/45",
      )}
    >
      {selection ? (
        <Td className="w-12">
          <SelectionCheckbox {...selection} />
        </Td>
      ) : null}
      {children}
    </tr>
  );
}

export function Td({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>;
}

/* ── Filter row controls (second header row) ── */

export function FilterSearch({
  value,
  onChange,
  placeholder = "Filter…",
  ariaLabel,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
}) {
  return (
    <div className="group relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted transition-colors group-focus-within:text-primary" aria-hidden="true" />
      <input
        id={id}
        aria-label={ariaLabel ?? placeholder}
        className="tg-soft-input h-8 w-full rounded-lg border pl-7 pr-2 text-caption text-foreground outline-none transition-colors placeholder:text-muted/70 hover:border-border focus:border-primary focus:bg-surface"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function FilterSelect({
  value,
  onChange,
  children,
  ariaLabel,
}: PropsWithChildren<{
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}>) {
  return (
    <div className="group relative">
      <select
        aria-label={ariaLabel}
        className="tg-soft-input h-8 w-full cursor-pointer appearance-none rounded-lg border pl-2.5 pr-6 text-caption text-muted outline-none transition-colors hover:border-border focus:border-primary focus:bg-surface"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
    </div>
  );
}

export function FilterDate({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="date"
      aria-label={ariaLabel}
      className="tg-soft-input h-8 w-full cursor-pointer rounded-lg border px-2 text-caption text-muted outline-none transition-colors hover:border-border focus:border-primary focus:bg-surface"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function FilterReset({ show, onReset, label = "Reset" }: { show: boolean; onReset: () => void; label?: string }) {
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={onReset}
      className="tg-copy-button rounded px-1 text-caption font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
    >
      {label}
    </button>
  );
}

export function CompactToolButton({
  icon,
  label,
  active = false,
  badge,
  onClick,
  expanded,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      className={cn(
        "tg-tool-button relative flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-primary",
        active
          ? "border-primary/20 bg-primary-light text-primary"
          : "border-border/45 bg-surface text-muted hover:bg-surface-muted/60 hover:text-foreground",
      )}
    >
      {icon}
      {badge && badge > 0 ? (
        <span className="tg-empty-icon absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1 py-0.5 text-caption font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export function TableCommandBar({
  children,
  id,
  className,
  ariaLabel = "Table commands",
}: PropsWithChildren<{
  id?: string;
  className?: string;
  ariaLabel?: string;
}>) {
  return (
    <div
      id={id}
      role="group"
      aria-label={ariaLabel}
      data-header-filter-root="true"
      className={cn("flex min-w-0 flex-wrap items-stretch gap-2", className)}
    >
      {children}
    </div>
  );
}

export function TableCommandButton({
  icon,
  label,
  value,
  badge,
  active = false,
  expanded,
  controls,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  badge?: number;
  active?: boolean;
  expanded?: boolean;
  controls?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={value ? `${label}: ${value}` : label}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      className={cn(
        "tg-tool-button flex min-h-11 min-w-0 flex-[1_1_8.75rem] items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60",
        active
          ? "border-primary/25 bg-primary-light text-primary"
          : "border-border/55 bg-surface text-muted hover:bg-surface-muted/60 hover:text-foreground",
      )}
    >
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-label font-medium leading-4 text-foreground">{label}</span>
        {value ? <span className="mt-0.5 block break-words text-caption leading-4 text-muted">{value}</span> : null}
      </span>
      {badge && badge > 0 ? (
        <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-caption font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export function HeaderFilterMenu({
  menuKey,
  openMenu,
  onToggle,
  label,
  icon,
  active,
  children,
}: {
  menuKey: string;
  openMenu: string | null;
  onToggle: (menuKey: string) => void;
  label: string;
  icon: ReactNode;
  active?: boolean;
  children: ReactNode;
}) {
  const isOpen = openMenu === menuKey;
  const id = useId().replace(/:/g, "");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeReasonRef = useRef<"escape" | "outside" | "toggle" | null>(null);
  const wasOpenRef = useRef(false);
  const focusedOnOpenRef = useRef(false);
  const dismissRequestedRef = useRef(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; originX: number } | null>(null);
  const triggerId = `header-filter-trigger-${id}`;
  const menuId = `header-filter-menu-${id}`;
  const labelId = `header-filter-label-${id}`;

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;

      const left = Math.min(
        Math.max(rect.right - HEADER_FILTER_MENU_WIDTH, HEADER_FILTER_MENU_MARGIN),
        window.innerWidth - HEADER_FILTER_MENU_WIDTH - HEADER_FILTER_MENU_MARGIN,
      );

      setMenuPosition({
        top: rect.bottom + HEADER_FILTER_MENU_GAP,
        left,
        originX: Math.min(
          HEADER_FILTER_MENU_WIDTH - 18,
          Math.max(18, rect.left + rect.width / 2 - left),
        ),
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (isOpen && menuPosition && !focusedOnOpenRef.current) {
      wasOpenRef.current = true;
      focusedOnOpenRef.current = true;
      dismissRequestedRef.current = false;
      menuRef.current?.querySelector<HTMLElement>(HEADER_FILTER_FOCUSABLE)?.focus();
      return;
    }

    if (!isOpen && wasOpenRef.current) {
      if (closeReasonRef.current === "escape") buttonRef.current?.focus();
      wasOpenRef.current = false;
      focusedOnOpenRef.current = false;
      dismissRequestedRef.current = false;
      closeReasonRef.current = null;
    }
  }, [isOpen, menuPosition]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    function isInsideThisFilter(target: EventTarget | null) {
      return target instanceof Node && (buttonRef.current?.contains(target) || menuRef.current?.contains(target));
    }

    function requestClose(reason: "escape" | "outside") {
      if (dismissRequestedRef.current) return;
      dismissRequestedRef.current = true;
      closeReasonRef.current = reason;
      onToggle(menuKey);
    }

    function onPointerDown(event: PointerEvent) {
      if (isInsideThisFilter(event.target)) return;
      requestClose("outside");
    }

    function onFocusIn(event: FocusEvent) {
      if (isInsideThisFilter(event.target)) return;
      requestClose("outside");
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      requestClose("escape");
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, menuKey, onToggle]);

  return (
    <div data-header-filter-root="true">
      <button
        ref={buttonRef}
        id={triggerId}
        type="button"
        className={cn(
          "tg-tool-button flex size-7 list-none items-center justify-center rounded-full border border-transparent text-muted transition-colors hover:border-border hover:bg-surface-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden",
          active || isOpen ? "bg-primary-light text-primary" : "",
        )}
        onClick={() => {
          closeReasonRef.current = isOpen ? "toggle" : null;
          onToggle(menuKey);
        }}
        aria-haspopup="dialog"
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-label={label}
        title={label}
      >
        {icon}
      </button>
      {menuPosition
        ? createPortal(
            <MotionPresence>
            {isOpen ? <MotionSurface kind="popover"
              ref={menuRef}
              id={menuId}
              data-header-filter-root="true"
              role="dialog"
              aria-labelledby={labelId}
              tabIndex={-1}
              className="tg-popover-in fixed z-50 w-72 rounded-2xl border border-border/65 bg-surface p-3 shadow-overlay"
              style={{
                top: `${menuPosition.top}px`,
                left: `${menuPosition.left}px`,
                "--tg-popover-origin-x": `${menuPosition.originX}px`,
              } as CSSProperties}
            >
              <div className="space-y-2">
                <p id={labelId} className="text-caption font-medium text-foreground">
                  {label}
                </p>
                {children}
              </div>
            </MotionSurface> : null}
            </MotionPresence>,
            document.body,
          )
        : null}
    </div>
  );
}

/* ── Empty / error blocks shared by lists ── */

export function ListEmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex flex-col items-center gap-3 px-6 py-16 text-center"
    >
      <div
        aria-hidden="true"
        className="tg-empty-icon flex size-11 items-center justify-center rounded-xl bg-primary-light text-primary"
      >
        {icon}
      </div>
      <div>
        <p className="text-body font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-body text-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}

export function ListFilterEmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <div>
        <p className="text-label font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-caption text-muted">{body}</p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="tg-action-button rounded-lg border border-border px-3 py-1.5 text-label font-semibold text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
      >
        {actionLabel}
      </button>
    </div>
  );
}

export function ListErrorState({
  message,
  onRetry,
  retryLabel = "Retry",
}: {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <p className="text-body text-danger-700">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="tg-action-button rounded-lg border border-border px-3 py-1.5 text-label font-semibold text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
      >
        {retryLabel}
      </button>
    </div>
  );
}

export function ListStaleState({
  id,
  message,
  retryLabel,
  onRetry,
}: {
  id?: string;
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div id={id} role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/25 bg-warning-50 px-4 py-3">
      <p className="text-body text-warning-700">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="tg-action-button rounded-lg border border-warning/35 bg-surface px-3 py-1.5 text-label font-semibold text-foreground transition-colors hover:bg-warning-100 focus-visible:outline-2 focus-visible:outline-primary"
      >
        {retryLabel}
      </button>
    </div>
  );
}
