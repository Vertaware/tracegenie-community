import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Button } from "../src/components/ui/Button";

afterEach(cleanup);

const adminStyles = readFileSync(resolve(process.cwd(), "src/styles/index.css"), "utf8");

function readHexToken(name: string) {
  const match = adminStyles.match(new RegExp(`^\\s*${name}:\\s*(#[0-9a-f]{6});`, "im"));
  expect(match, `${name} must be explicitly defined as a six-digit hex color`).not.toBeNull();
  return match?.[1] ?? "#000000";
}

function relativeLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: string, second: string) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

test("primary CTA uses the shared AA-safe blue and foreground contract", () => {
  const primary = readHexToken("--tg-primary");
  const primaryHover = readHexToken("--tg-primary-hover");
  const foreground = readHexToken("--tg-primary-foreground");

  expect(foreground.toLowerCase()).toBe("#ffffff");
  expect(contrastRatio(primary, foreground)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(primaryHover, foreground)).toBeGreaterThanOrEqual(4.5);

  render(<Button>Save changes</Button>);

  expect(screen.getByRole("button", { name: "Save changes" })).toHaveClass(
    "bg-primary",
    "text-primary-foreground",
    "hover:bg-primary-hover",
  );
});
