import { useEffect,useRef } from "react";

import { redactCapturedText } from "../lib/utils";

type ClientErrorContext = {
  message: string;
  stack?: string;
  source?: string;
};

export function useClientErrorCapture(enabled: boolean) {
  const errorRef = useRef<ClientErrorContext | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const onError = (event: ErrorEvent) => {
      errorRef.current = {
        message: redactCapturedText(event.message),
        stack: event.error?.stack ? redactCapturedText(event.error.stack) : undefined,
        source: event.filename ? redactCapturedText(event.filename) : undefined,
      };
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      errorRef.current = {
        message: redactCapturedText(reason.message),
        stack: reason.stack ? redactCapturedText(reason.stack) : undefined,
        source: "unhandledrejection",
      };
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [enabled]);

  return errorRef;
}
