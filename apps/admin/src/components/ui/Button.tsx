import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/utils";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> & {
  tone?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ className, tone = "primary", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      data-tg-primary-target={tone === "primary" ? "true" : undefined}
      className={cn(
        "tg-action-button inline-flex h-10 items-center justify-center rounded-full px-3.5 text-label font-semibold transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        tone === "primary" && "bg-primary text-primary-foreground hover:bg-primary-hover",
        tone === "secondary" && "border border-border-strong bg-surface text-foreground hover:bg-surface-muted/45",
        tone === "ghost" && "text-muted hover:bg-surface-muted/45 hover:text-foreground",
        tone === "danger" && "border border-danger-700 bg-surface text-danger-700 hover:bg-danger-50",
        className,
      )}
      {...props}
    />
  );
}
