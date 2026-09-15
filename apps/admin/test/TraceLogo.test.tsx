import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import "@testing-library/jest-dom/vitest";

import { TraceLogo } from "../src/components/ui/TraceLogo";

afterEach(cleanup);

test("full and icon variants use the canonical scalable assets", () => {
  const { rerender } = render(<TraceLogo variant="full" size="sm" />);
  const fullLogo = screen.getByRole("img", { name: "TraceGenie" });

  expect(fullLogo).toHaveAttribute("data-tracegenie-logo", "full");
  expect(fullLogo.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  expect(fullLogo).toHaveAttribute("width", "122");
  expect(fullLogo).toHaveAttribute("height", "42");

  rerender(<TraceLogo variant="icon" size="lg" align="center" />);
  const iconLogo = screen.getByRole("img", { name: "TraceGenie" });

  expect(iconLogo).toHaveAttribute("data-tracegenie-logo", "icon");
  expect(iconLogo.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  expect(iconLogo).toHaveAttribute("width", "48");
  expect(iconLogo).toHaveAttribute("height", "48");
  expect(iconLogo).toHaveStyle({ marginInline: "auto" });
});
