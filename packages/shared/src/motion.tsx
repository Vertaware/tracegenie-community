import { forwardRef, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent, type Transition } from "motion/react";

export { AnimatePresence as MotionPresence, useIsPresent } from "motion/react";

/** Shared with motion.css. UI speed and spring personality are separate controls. */
export const motionTokens = {
  quick: 0.14, standard: 0.22, reveal: 0.32, celebration: 0.7,
  easeOut: [0.23, 1, 0.32, 1] as const,
  spring: { type: "spring", stiffness: 420, damping: 30, mass: 0.85 } as const,
};

function subscribeMotionPreference(notify: () => void) {
  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  media?.addEventListener("change", notify);
  return () => media?.removeEventListener("change", notify);
}

/** Reactive, including preference changes while an overlay is open. SSR defaults to no travel. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotionPreference,
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true,
    () => true);
}

export type MotionKind = "fade" | "popover" | "dialog" | "drawer" | "sheet" | "toast" | "reveal";
const poses: Record<MotionKind, { from: string; to: string; leave: string }> = {
  fade: { from: "none", to: "none", leave: "none" },
  popover: { from: "translateY(-6px) scale(0.94)", to: "translateY(0px) scale(1)", leave: "translateY(-3px) scale(0.97)" },
  dialog: { from: "translateY(18px) scale(0.94)", to: "translateY(0px) scale(1)", leave: "translateY(10px) scale(0.97)" },
  drawer: { from: "translateX(100%)", to: "translateX(0%)", leave: "translateX(100%)" },
  sheet: { from: "translateY(32px) scale(0.96)", to: "translateY(0px) scale(1)", leave: "translateY(20px) scale(0.97)" },
  toast: { from: "translateY(16px) scale(0.92)", to: "translateY(0px) scale(1)", leave: "translateX(20px) scale(0.96)" },
  reveal: { from: "translateY(12px) scale(0.985)", to: "translateY(0px) scale(1)", leave: "translateY(-4px) scale(0.99)" },
};

type SurfaceProps = Omit<HTMLAttributes<HTMLDivElement>, "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"> & {
  kind?: MotionKind;
  delay?: number;
  layout?: boolean | "position";
};

/** Keep inside MotionPresence. Closing nodes become inert immediately, before their visual exit. */
export const MotionSurface = forwardRef<HTMLDivElement, SurfaceProps>(function MotionSurface(
  { kind = "reveal", delay = 0, layout, children, className = "", style, ...props }, ref,
) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const pose = poses[kind];
  const transition: Transition = reduced || kind === "fade"
    ? { duration: reduced ? 0.1 : motionTokens.standard, ease: "easeOut" }
    : { ...motionTokens.spring, delay };
  return (
    <motion.div
      {...props}
      ref={ref}
      className={`tg-motion-surface ${className}`}
      data-motion-kind={kind}
      data-motion-present={present ? "true" : "false"}
      inert={!present || props.inert || undefined}
      aria-hidden={!present ? true : props["aria-hidden"]}
      style={{ ...style, pointerEvents: !present ? "none" : style?.pointerEvents }}
      initial={{ opacity: 0, transform: reduced ? "none" : pose.from }}
      animate={{ opacity: 1, transform: reduced ? "none" : pose.to }}
      exit={{ opacity: 0, transform: reduced ? "none" : pose.leave, transition: { duration: reduced ? 0.1 : motionTokens.quick, ease: "easeOut" } }}
      transition={{ ...transition, transform: reduced ? { duration: 0 } : transition, opacity: { duration: motionTokens.quick, delay: reduced ? 0 : delay } }}
      layout={reduced ? false : layout}
    >
      {children}
    </motion.div>
  );
});

/** Replay only on pathname changes. No keyed Outlet, so query edits and drafts retain their state. */
export function MotionPage({ path, children, className }: { path: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const animation = ref.current?.animate?.(
      reduced ? [{ opacity: 0.6 }, { opacity: 1 }] : [
        { opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" },
      ],
      { duration: reduced ? 100 : 320, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
    return () => animation?.cancel();
  }, [path, reduced]);
  return (
    <div ref={ref} className={className} data-motion-page="true">
      {children}
    </div>
  );
}

/** Inline count changes, without announcing duplicate exiting values. */
export function MotionNumber({ value }: { value: number }) {
  const reduced = useReducedMotion();
  return (
    <span className="tg-motion-number" aria-label={String(value)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={value} aria-hidden="true" style={{ display: "inline-block" }}
          initial={{ opacity: 0, transform: reduced ? "none" : "translateY(55%) rotateX(-35deg)" }}
          animate={{ opacity: 1, transform: "translateY(0%) rotateX(0deg)" }}
          exit={{ opacity: 0, transform: reduced ? "none" : "translateY(-55%) rotateX(35deg)" }}
          transition={{ duration: reduced ? 0.1 : 0.22, ease: [...motionTokens.easeOut] }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** A finite, decorative burst for actual completion. Never intercepts input or runs forever. */
export function MotionCelebration() {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <span className="tg-motion-celebration" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <i key={index} className="tg-motion-particle" style={{
          "--tg-particle-angle": `${index * 30}deg`,
          "--tg-particle-delay": `${(index % 3) * 35}ms`,
          "--tg-particle-color": index % 2 ? "var(--tg-primary)" : "var(--tg-success)",
        } as CSSProperties} />
      ))}
    </span>
  );
}
