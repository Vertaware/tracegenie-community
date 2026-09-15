import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { traceGenieTheme } from "../dist/constants/theme.js";

const sharedRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(sharedRoot, "../..");
const themeCss = fs.readFileSync(path.join(sharedRoot, "src/theme.css"), "utf8");
const adminCss = fs.readFileSync(path.join(repoRoot, "apps/admin/src/styles/index.css"), "utf8");
const widgetCss = fs.readFileSync(path.join(repoRoot, "packages/widget/src/styles/widget.css"), "utf8");
const widgetSource = fs.readFileSync(path.join(repoRoot, "packages/widget/src/components/FeedbackWidget.tsx"), "utf8");

function variables(source) {
  return Object.fromEntries([...source.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => Number.parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return entry.isFile() && /\.(?:tsx|css)$/.test(entry.name) ? [entryPath] : [];
  });
}

const tokens = variables(themeCss);
const widgetTokens = variables(widgetCss);

test("shared visual contract exposes five text roles, three elevations, and locked shape/icon tokens", () => {
  assert.deepEqual(
    ["display", "title", "body", "label", "caption"].map((role) => tokens[`tg-text-${role}-size`]),
    ["24px", "17px", "14px", "13px", "12px"],
  );
  assert.equal(tokens["tg-text-label-line"], "16px");
  assert.equal(tokens["tg-letter-spacing"], "0");
  assert.deepEqual(
    ["display", "title", "body", "label", "caption"].map((role) => tokens[`tg-text-${role}-line`]),
    ["32px", "24px", "20px", "16px", "16px"],
  );
  assert.deepEqual(
    [...themeCss.matchAll(/--tg-elevation-(\d):/g)].map((match) => match[1]),
    ["0", "1", "2"],
  );
  assert.equal(tokens["tg-radius-panel"], "12px");
  assert.equal(tokens["tg-radius-lg"], "8px");
  assert.equal(tokens["tg-icon-stroke"], "1.75");
  assert.equal(tokens["tg-space-3"], "12px");
});

test("semantic text, focus, and strong control borders pass contrast thresholds", () => {
  const textPairs = [
    ["tg-foreground", "tg-background"],
    ["tg-muted", "tg-background"],
    ["tg-primary", "tg-surface"],
    ["tg-primary-foreground", "tg-primary"],
    ["tg-success-700", "tg-success-50"],
    ["tg-warning-700", "tg-warning-50"],
    ["tg-danger-700", "tg-danger-50"],
  ];
  for (const [foreground, background] of textPairs) {
    assert.ok(contrast(tokens[foreground], tokens[background]) >= 4.5, `${foreground} must pass AA on ${background}`);
  }
  assert.ok(contrast(tokens["tg-border-strong"], tokens["tg-surface"]) >= 3, "strong control border must pass non-text contrast");
  assert.ok(contrast(tokens["tg-primary"], tokens["tg-surface"]) >= 3, "solid focus border must pass non-text contrast");
  assert.match(adminCss, /\.tg-soft-input[\s\S]*?border-color:\s*var\(--tg-border-strong\)/);
  assert.match(adminCss, /\.tg-card[\s\S]*?border:\s*1px solid var\(--tg-border\)/);
});

test("TypeScript theme export stays aligned with the shared CSS color API", () => {
  assert.deepEqual(traceGenieTheme.colors, {
    background: tokens["tg-background"],
    surface: tokens["tg-surface"],
    surfaceMuted: tokens["tg-surface-muted"],
    borderSubtle: tokens["tg-border-subtle"],
    border: tokens["tg-border"],
    borderStrong: tokens["tg-border-strong"],
    foreground: tokens["tg-foreground"],
    muted: tokens["tg-muted"],
    primary: tokens["tg-primary"],
    primaryHover: tokens["tg-primary-hover"],
    primaryLight: tokens["tg-primary-light"],
    primaryForeground: tokens["tg-primary-foreground"],
    brand50: tokens["tg-brand-50"],
    brand100: tokens["tg-brand-100"],
    brand200: tokens["tg-brand-200"],
    brand300: tokens["tg-brand-300"],
    brand400: tokens["tg-brand-400"],
    brand500: tokens["tg-brand-500"],
    brand600: tokens["tg-brand-600"],
    brand700: tokens["tg-brand-700"],
    accent50: tokens["tg-accent-50"],
    accent100: tokens["tg-accent-100"],
    accent500: tokens["tg-accent-500"],
    neutral900: tokens["tg-neutral-900"],
    success: tokens["tg-success"],
    success50: tokens["tg-success-50"],
    success200: tokens["tg-success-200"],
    success700: tokens["tg-success-700"],
    warning: tokens["tg-warning"],
    warning50: tokens["tg-warning-50"],
    warning100: tokens["tg-warning-100"],
    warning200: tokens["tg-warning-200"],
    warning700: tokens["tg-warning-700"],
    danger: tokens["tg-danger"],
    danger50: tokens["tg-danger-50"],
    danger200: tokens["tg-danger-200"],
    danger700: tokens["tg-danger-700"],
  });
});

test("widget keeps the same five-role, three-elevation, zero-tracking, one-weight contract", () => {
  assert.deepEqual(
    ["display", "title", "body", "label", "caption"].map((role) => widgetTokens[`tgw-text-${role}-size`]),
    ["24px", "17px", "14px", "13px", "12px"],
  );
  assert.deepEqual(
    [...new Set([...widgetCss.matchAll(/--tgw-elevation-(\d):/g)].map((match) => match[1]))],
    ["0", "1", "2"],
  );
  assert.equal(widgetTokens["tgw-text-label-line"], "16px");
  assert.deepEqual(
    ["display", "title", "body", "label", "caption"].map((role) => widgetTokens[`tgw-text-${role}-line`]),
    ["32px", "24px", "20px", "16px", "16px"],
  );
  assert.equal(widgetTokens["tgw-focus-shadow"], "0 0 0 2px var(--tgw-focus-border)");
  assert.doesNotMatch(widgetCss, /font-size:\s*\d+px|border-radius:\s*(?:\d+px|50%)/);
  assert.doesNotMatch(widgetCss, /(?:gap|padding):\s*[1-9]\d*(?:\.\d+)?px/);
  assert.deepEqual([...widgetCss.matchAll(/letter-spacing:\s*([^;]+);/g)].map((match) => match[1].trim()), ["0", "0", "0"]);
  assert.deepEqual([...widgetSource.matchAll(/strokeWidth="([^"]+)"/g)].map((match) => match[1]), Array(5).fill("1.75"));
  assert.match(adminCss, /svg\.lucide\s*\{\s*stroke-width:\s*var\(--tg-icon-stroke\)/);
});

test("legacy feature and demo sources no longer bypass type, tracking, elevation, or palette tokens", () => {
  const roots = [
    "apps/admin/src",
    "apps/demo/src",
  ];
  const files = roots.flatMap((root) => sourceFiles(path.join(repoRoot, root)));
  const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");

  assert.doesNotMatch(source, /\btext-\[|\btracking-(?!normal\b)|\bshadow-\[|(?<!-)\bshadow-(?:xs|sm|md|lg|xl|2xl)\b|\bsize-3\.5\b/);
  assert.doesNotMatch(source, /stroke-width%3D%22(?!1\.75%22)/);
  assert.doesNotMatch(source, /(?:bg|border|ring|text)-(?:amber|blue|cyan|emerald|gray|green|indigo|neutral|orange|purple|red|rose|slate|teal|violet|yellow|zinc)-\d{1,3}/);
  assert.doesNotMatch(source, /(?:bg|border|ring)-(?:white|black)(?:\/\d{1,3})?/);
});
