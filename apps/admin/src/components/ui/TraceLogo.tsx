import traceGenieLogoUrl from "../../../../../packages/shared/src/assets/tracegenie-logo.svg?inline";
import traceGenieMarkUrl from "../../../../../packages/shared/src/assets/tracegenie-mark.svg?inline";

type TraceLogoProps = {
  size?: "sm" | "md" | "lg";
  variant?: "full" | "icon";
  align?: "left" | "center";
  className?: string;
};

const sizes = {
  sm: { width: 122, height: 42 },
  md: { width: 153, height: 53 },
  lg: { width: 183, height: 63 },
};

const iconSizes = {
  sm: { width: 28, height: 28 },
  md: { width: 36, height: 36 },
  lg: { width: 48, height: 48 },
};

export function TraceLogo({ size = "md", variant = "full", align = "left", className }: TraceLogoProps) {
  const dim = variant === "icon" ? iconSizes[size] : sizes[size];
  return (
    <img
      src={variant === "icon" ? traceGenieMarkUrl : traceGenieLogoUrl}
      alt="TraceGenie"
      className={className}
      data-tracegenie-logo={variant}
      width={dim.width}
      height={dim.height}
      style={{
        width: dim.width,
        height: dim.height,
        display: "block",
        flexShrink: 0,
        marginInline: align === "center" ? "auto" : undefined,
      }}
    />
  );
}
