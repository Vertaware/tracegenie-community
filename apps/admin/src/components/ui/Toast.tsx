import { MotionPresence,MotionSurface,useIsPresent } from "@tracegenie/shared/motion";
import { useCallback,useEffect,useRef,useState,type CSSProperties } from "react";
import { AlertCircle,CheckCircle2,Info,X } from "lucide-react";

import { cn } from "../../lib/utils";

type ToastType = "success" | "error" | "info";

type ToastItem = {
  id: number;
  type: ToastType;
  message: string;
  scope?: string;
};

let nextId = 0;

const TOAST_DURATION_MS = 8000;

const icons: Record<ToastType, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const iconTone: Record<ToastType, string> = {
  success: "text-success-700",
  error: "text-danger-700",
  info: "text-muted",
};

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const mountedRef = useRef(false);
  const scopedToastIdsRef = useRef(new Map<string, number>());

  const addToast = useCallback((type: ToastType, message: string, scope?: string) => {
    if (!mountedRef.current) {
      return;
    }

    const id = ++nextId;
    if (scope) {
      scopedToastIdsRef.current.set(scope, id);
    }

    setToasts((prev) => [
      ...prev.filter((toast) => !scope || toast.scope !== scope),
      { id, type, message, scope },
    ]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    if (!mountedRef.current) {
      return;
    }

    for (const [scope, scopedId] of scopedToastIdsRef.current) {
      if (scopedId === id) {
        scopedToastIdsRef.current.delete(scope);
        break;
      }
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissToastScope = useCallback((scope: string) => {
    if (!mountedRef.current) {
      return;
    }

    const id = scopedToastIdsRef.current.get(scope);
    if (id === undefined) {
      return;
    }

    scopedToastIdsRef.current.delete(scope);
    setToasts((prev) => prev.filter((toast) => toast.scope !== scope));
  }, []);

  const dismissAllToasts = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    scopedToastIdsRef.current.clear();
    setToasts([]);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      scopedToastIdsRef.current.clear();
    };
  }, []);

  return { toasts, addToast, dismissToast, dismissToastScope, dismissAllToasts };
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const isPresent = useIsPresent();
  const remainingMsRef = useRef(TOAST_DURATION_MS);
  const startedAtRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);
  const hoverRef = useRef(false);
  const focusRef = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const Icon = icons[toast.type];

  const clearTimer = useCallback(() => {
    if (timeoutRef.current === null) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const armTimer = useCallback((durationMs: number) => {
    clearTimer();
    remainingMsRef.current = durationMs;
    startedAtRef.current = Date.now();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      onDismissRef.current(toast.id);
    }, durationMs);
  }, [clearTimer, toast.id]);

  useEffect(() => {
    if (isPresent) armTimer(TOAST_DURATION_MS);
    return clearTimer;
  }, [armTimer, clearTimer, isPresent]);

  function pauseTimer() {
    if (pausedRef.current || timeoutRef.current === null) return;
    pausedRef.current = true;
    remainingMsRef.current = Math.max(0, remainingMsRef.current - (Date.now() - startedAtRef.current));
    clearTimer();
  }

  function resumeTimer() {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    armTimer(remainingMsRef.current > 0 ? remainingMsRef.current : TOAST_DURATION_MS);
  }

  function syncPause() {
    if (hoverRef.current || focusRef.current) {
      pauseTimer();
      return;
    }
    resumeTimer();
  }

  return (
    <MotionSurface kind="toast" layout="position"
      id={`admin-toast-${toast.id}`}
      className="tg-toast flex items-center gap-2.5 rounded-xl border border-border/35 bg-surface px-3.5 py-2.5 text-label font-medium text-foreground shadow-panel"
      role={toast.type === "error" ? "alert" : "status"}
      aria-live={toast.type === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      data-toast-scope={toast.scope}
      data-toast-type={toast.type}
      style={{ pointerEvents: "auto", "--tg-toast-lifetime": `${TOAST_DURATION_MS}ms` } as CSSProperties}
      onPointerEnter={() => {
        hoverRef.current = true;
        syncPause();
      }}
      onPointerLeave={() => {
        hoverRef.current = false;
        syncPause();
      }}
      onFocus={() => {
        focusRef.current = true;
        syncPause();
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        focusRef.current = false;
        syncPause();
      }}
    >
      <Icon className={cn("size-4 shrink-0", iconTone[toast.type])} aria-hidden="true" />
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="tg-icon-button ml-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
        aria-label="Dismiss notification"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </MotionSurface>
  );
}

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div id="admin-notifications" className="pointer-events-none fixed bottom-6 right-6 z-50 flex max-w-[calc(100vw-3rem)] flex-col gap-2" aria-label="Notifications">
      <MotionPresence initial={false}>
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
      </MotionPresence>
    </div>
  );
}
