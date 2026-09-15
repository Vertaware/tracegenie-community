import type { InputHTMLAttributes,TextareaHTMLAttributes } from "react";

import { cn } from "../../lib/utils";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "style">;

export function Input(props: InputProps) {
  return (
    <input
      {...props}
      className={cn(
        "tg-soft-input h-10 w-full rounded-lg border px-3 text-body text-foreground outline-none transition placeholder:text-muted/70 focus:border-primary focus:ring-3 focus:ring-primary/15",
        props.className,
      )}
    />
  );
}

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "style">;

export function Textarea(props: TextareaProps) {
  return (
    <textarea
      {...props}
      className={cn(
        "tg-soft-input min-h-24 w-full rounded-lg border px-3 py-2 text-body text-foreground outline-none transition placeholder:text-muted/70 focus:border-primary focus:ring-3 focus:ring-primary/15",
        props.className,
      )}
    />
  );
}
