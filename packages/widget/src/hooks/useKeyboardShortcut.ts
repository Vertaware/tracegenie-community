import { useEffect } from "react";

import { matchesShortcut } from "../lib/utils";

export function useKeyboardShortcut(shortcut: string | undefined, enabled: boolean, onTrigger: () => void) {
  useEffect(() => {
    if (!shortcut || !enabled) {
      return;
    }

    const handler = (event: KeyboardEvent) => {
      if (matchesShortcut(event, shortcut)) {
        event.preventDefault();
        onTrigger();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcut, enabled, onTrigger]);
}
