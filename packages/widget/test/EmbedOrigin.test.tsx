import { describe, expect, it } from "vitest";
import { resolveEmbedOrigin } from "../src/lib/embedOrigin";

describe("Community embed API origin", () => {
  it("uses the self-hosted script server when embedded on another website", () => {
    expect(resolveEmbedOrigin("https://feedback.example.test/widget/embed.js", "https://shop.example.test"))
      .toBe("https://feedback.example.test");
  });

  it("preserves a local installation port", () => {
    expect(resolveEmbedOrigin("http://localhost:8088/widget/embed.js", "http://localhost:3000"))
      .toBe("http://localhost:8088");
  });

  it("uses the page origin when there is no script element", () => {
    expect(resolveEmbedOrigin(undefined, "https://feedback.example.test"))
      .toBe("https://feedback.example.test");
  });

  it("does not select an opaque blob origin", () => {
    expect(resolveEmbedOrigin("blob:https://feedback.example.test/fixture", "https://feedback.example.test"))
      .toBe("https://feedback.example.test");
  });
});
