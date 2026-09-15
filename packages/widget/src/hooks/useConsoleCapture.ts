import { useEffect,useRef } from "react";

import { redactCapturedText } from "../lib/utils";

type ConsoleEntry = {
  level: "log" | "info" | "warn" | "error";
  message: string;
  timestamp: string;
};

export function useConsoleCapture(enabled: boolean, maxEntries: number) {
  const entriesRef = useRef<ConsoleEntry[]>([]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };

    const pushEntry = (level: ConsoleEntry["level"], args: unknown[]) => {
      const message = args
        .map((value) => {
          if (typeof value === "string") {
            return value;
          }

          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })
        .join(" ");
      const redactedMessage = redactCapturedText(message);

      entriesRef.current = [
        ...entriesRef.current.slice(Math.max(entriesRef.current.length - maxEntries + 1, 0)),
        {
          level,
          message: redactedMessage.slice(0, 4000),
          timestamp: new Date().toISOString(),
        },
      ];
    };

    console.log = (...args: unknown[]) => {
      pushEntry("log", args);
      original.log(...args);
    };
    console.info = (...args: unknown[]) => {
      pushEntry("info", args);
      original.info(...args);
    };
    console.warn = (...args: unknown[]) => {
      pushEntry("warn", args);
      original.warn(...args);
    };
    console.error = (...args: unknown[]) => {
      pushEntry("error", args);
      original.error(...args);
    };

    return () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
    };
  }, [enabled, maxEntries]);

  return entriesRef;
}
