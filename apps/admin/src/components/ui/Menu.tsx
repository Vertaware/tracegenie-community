import { MotionPresence,MotionSurface } from "@tracegenie/shared/motion";
import {
createContext,
type ButtonHTMLAttributes,
type HTMLAttributes,
type KeyboardEvent as ReactKeyboardEvent,
type ReactNode,
type RefObject,
useCallback,
useContext,
useEffect,
useId,
useRef,
useState,
} from "react";
import { flushSync } from "react-dom";

import { cn } from "../../lib/utils";

type MenuContextValue = {
  contentId: string;
  contentRef: RefObject<HTMLDivElement | null>;
  close: (restoreFocus?: boolean) => void;
  closeForSelection: () => void;
  open: boolean;
  openWithFocus: (target?: "first" | "last") => void;
  toggle: () => void;
  triggerId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenuContext(componentName: string) {
  const context = useContext(MenuContext);
  if (!context) {
    throw new Error(`${componentName} must be rendered inside Menu.`);
  }
  return context;
}

function getMenuItems(content: HTMLElement | null) {
  if (!content) return [];
  return Array.from(content.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}

type MenuProps = Omit<HTMLAttributes<HTMLDivElement>, "style"> & {
  children: ReactNode;
  dismissKey?: string;
};

type ActiveMenu = {
  close: () => void;
  id: string;
};

let activeMenu: ActiveMenu | null = null;

export function Menu({ children, className, dismissKey, id, ...props }: MenuProps) {
  const generatedId = useId();
  const [open, setOpen] = useState(false);
  const pendingFocusRef = useRef<"first" | "last" | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousDismissKeyRef = useRef(dismissKey);
  const idPrefix = id ?? `menu-${generatedId}`;
  const instanceId = `${idPrefix}-${generatedId}`;
  const triggerId = `${idPrefix}-trigger-${generatedId}`;
  const contentId = `${idPrefix}-content-${generatedId}`;

  const cancelPendingFocus = useCallback(() => {
    if (focusFrameRef.current === null) return;
    window.cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = null;
  }, []);

  const scheduleTriggerFocus = useCallback((fallbackOnly: boolean) => {
    cancelPendingFocus();
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null;
      const activeElement = document.activeElement;
      const needsFallback = !activeElement || activeElement === document.body || !activeElement.isConnected || Boolean(contentRef.current?.contains(activeElement));
      if (!fallbackOnly || needsFallback) {
        triggerRef.current?.focus();
      }
    });
  }, [cancelPendingFocus]);

  const close = useCallback((restoreFocus = false) => {
    pendingFocusRef.current = null;
    setOpen(false);
    if (activeMenu?.id === instanceId) {
      activeMenu = null;
    }
    if (restoreFocus) {
      scheduleTriggerFocus(false);
    } else {
      cancelPendingFocus();
    }
  }, [cancelPendingFocus, instanceId, scheduleTriggerFocus]);

  const closeForSelection = useCallback(() => {
    pendingFocusRef.current = null;
    setOpen(false);
    if (activeMenu?.id === instanceId) {
      activeMenu = null;
    }
    scheduleTriggerFocus(true);
  }, [instanceId, scheduleTriggerFocus]);

  const registerAsActive = useCallback(() => {
    if (activeMenu?.id !== instanceId) {
      activeMenu?.close();
      activeMenu = { close: () => close(false), id: instanceId };
    }
  }, [close, instanceId]);

  const openWithFocus = useCallback((target?: "first" | "last") => {
    cancelPendingFocus();
    registerAsActive();
    pendingFocusRef.current = target ?? null;
    if (open) {
      const items = getMenuItems(contentRef.current);
      const focusTarget = target === "last" ? items.at(-1) : items[0];
      pendingFocusRef.current = null;
      focusTarget?.focus();
      return;
    }
    setOpen(true);
  }, [cancelPendingFocus, open, registerAsActive]);

  const toggle = useCallback(() => {
    if (open) {
      close(false);
      return;
    }
    cancelPendingFocus();
    registerAsActive();
    pendingFocusRef.current = null;
    setOpen(true);
  }, [cancelPendingFocus, close, open, registerAsActive]);

  useEffect(() => {
    if (Object.is(previousDismissKeyRef.current, dismissKey)) return;
    previousDismissKeyRef.current = dismissKey;
    if (open) {
      close(false);
    }
  }, [close, dismissKey, open]);

  useEffect(() => () => {
    cancelPendingFocus();
    if (activeMenu?.id === instanceId) {
      activeMenu = null;
    }
  }, [cancelPendingFocus, instanceId]);

  useEffect(() => {
    if (!open || !pendingFocusRef.current) return;
    const items = getMenuItems(contentRef.current);
    const target = pendingFocusRef.current === "last" ? items.at(-1) : items[0];
    pendingFocusRef.current = null;
    target?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let tabDismissTimer: number | undefined;

    function isInsideMenu(target: EventTarget | null) {
      return target instanceof Node && (
        Boolean(triggerRef.current?.contains(target)) || Boolean(contentRef.current?.contains(target))
      );
    }

    function onPointerDown(event: PointerEvent) {
      if (!isInsideMenu(event.target)) close(false);
    }

    function onFocusIn(event: FocusEvent) {
      if (!isInsideMenu(event.target)) close(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab") {
        window.clearTimeout(tabDismissTimer);
        tabDismissTimer = window.setTimeout(() => close(false), 0);
      }
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(tabDismissTimer);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  return (
    <MenuContext.Provider
      value={{ contentId, contentRef, close, closeForSelection, open, openWithFocus, toggle, triggerId, triggerRef }}
    >
      <div id={id} className={cn("relative", className)} {...props}>
        {children}
      </div>
    </MenuContext.Provider>
  );
}

type MenuTriggerProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style" | "type">;

export function MenuTrigger({ children, onClick, onKeyDown, ...props }: MenuTriggerProps) {
  const { close, contentId, open, openWithFocus, toggle, triggerId, triggerRef } = useMenuContext("MenuTrigger");

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openWithFocus("first");
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openWithFocus(event.key === "ArrowDown" ? "first" : "last");
      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      close(true);
    }
  }

  return (
    <button
      {...props}
      ref={triggerRef}
      id={triggerId}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={contentId}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) toggle();
      }}
      onKeyDown={handleKeyDown}
    >
      {children}
    </button>
  );
}

type MenuContentProps = Omit<HTMLAttributes<HTMLDivElement>, "style">;

export function MenuContent({ children, onKeyDown, ...props }: MenuContentProps) {
  const { close, contentId, contentRef, open, triggerId } = useMenuContext("MenuContent");

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }

    const items = getMenuItems(contentRef.current);
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = currentIndex === -1
        ? (direction === 1 ? 0 : items.length - 1)
        : (currentIndex + direction + items.length) % items.length;
      items[nextIndex]?.focus();
    }
  }

  return (
    <MotionPresence>
      {open ? <MotionSurface kind="popover"
      {...props}
      ref={contentRef}
      id={contentId}
      role="menu"
      aria-labelledby={triggerId}
      aria-orientation="vertical"
      onKeyDown={handleKeyDown}
    >
      {children}
    </MotionSurface> : null}
    </MotionPresence>
  );
}

type MenuItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "style" | "type"> & {
  onSelect?: () => void;
};

export function MenuItem({ children, onSelect, ...props }: MenuItemProps) {
  const { closeForSelection } = useMenuContext("MenuItem");
  const {
    "aria-disabled": ariaDisabled,
    disabled,
    onKeyDown,
    ...buttonProps
  } = props;
  const isDisabled = disabled || ariaDisabled === true || ariaDisabled === "true";

  function preventDisabledActivation(event: ReactKeyboardEvent<HTMLButtonElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || !isDisabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <button
      {...buttonProps}
      type="button"
      role="menuitem"
      aria-disabled={isDisabled || undefined}
      tabIndex={-1}
      onClick={(event) => {
        if (isDisabled) {
          event.preventDefault();
          return;
        }
        flushSync(() => closeForSelection());
        onSelect?.();
      }}
      onKeyDown={preventDisabledActivation}
    >
      {children}
    </button>
  );
}
