import { useEffect,useRef,useCallback } from "react";

const IDLE_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
  "click",
];

/**
 * Calls `onIdle` after `timeoutMs` of user inactivity.
 * Resets the timer on any mouse, keyboard, touch, or scroll event.
 */
export function useIdleTimer(onIdle: () => void, timeoutMs = 30 * 60 * 1000) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  const lastResetTime = useRef<number>(0);

  const reset = useCallback(() => {
    const now = Date.now();
    // Throttle to once per second so mousemove doesn't churn timers.
    if (now - lastResetTime.current < 1000) return;
    lastResetTime.current = now;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onIdleRef.current();
    }, timeoutMs);
  }, [timeoutMs]);

  useEffect(() => {
    reset();

    IDLE_EVENTS.forEach((evt) => window.addEventListener(evt, reset, { passive: true }));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      IDLE_EVENTS.forEach((evt) => window.removeEventListener(evt, reset));
    };
  }, [reset]);
}
