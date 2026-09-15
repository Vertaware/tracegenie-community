import { describe, expect, test } from "vitest";

import { readableBrandForeground } from "../src/components/FeedbackWidget";

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  return channels
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(first: string, second: string) {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

describe("readableBrandForeground", () => {
  test.each(["#000000", "#2563eb", "#777777", "#aaaaaa", "#ffffff"])(
    "keeps primary-button text AA-readable on %s",
    (background) => {
      expect(contrast(readableBrandForeground(background), background)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
