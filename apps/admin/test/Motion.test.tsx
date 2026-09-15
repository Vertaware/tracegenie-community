import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, test, vi } from "vitest";
import { MotionCelebration, MotionPage, MotionPresence, MotionSurface } from "@tracegenie/shared/motion";

function mediaPreference(initial = false) {
  let reduced = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return reduced; },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  return (value: boolean) => act(() => { reduced = value; listeners.forEach(listener => listener()); });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test("route reveals preserve draft nodes and only replay when pathname changes", () => {
  mediaPreference();
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  let mounts = 0;
  function Draft() {
    useEffect(() => { mounts += 1; }, []);
    return <input aria-label="Draft" defaultValue="" />;
  }
  const view = render(<MotionPage path="/settings/email"><Draft /></MotionPage>);
  const input = screen.getByLabelText("Draft");
  fireEvent.change(input, { target: { value: "Keep this draft" } });
  view.rerender(<MotionPage path="/settings/email"><Draft /></MotionPage>);
  expect(animate).toHaveBeenCalledTimes(1);
  view.rerender(<MotionPage path="/settings/general"><Draft /></MotionPage>);
  expect(screen.getByLabelText("Draft")).toBe(input);
  expect(input).toHaveValue("Keep this draft");
  expect(mounts).toBe(1);
  expect(animate).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledOnce();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});

test("changing reduced-motion preference disables travel and removes celebrations live", async () => {
  const setReduced = mediaPreference();
  render(<MotionSurface kind="dialog" data-testid="surface"><MotionCelebration /></MotionSurface>);
  expect(document.querySelectorAll(".tg-motion-particle")).toHaveLength(12);
  setReduced(true);
  expect(document.querySelector(".tg-motion-celebration")).toBeNull();
  await waitFor(() => expect(screen.getByTestId("surface").style.transform).toBe("none"));
});

test("a closing surface is immediately inert and is removed after its exit", async () => {
  mediaPreference(true);
  const view = render(<MotionPresence><MotionSurface key="panel" kind="dialog" role="dialog">Panel</MotionSurface></MotionPresence>);
  view.rerender(<MotionPresence>{null}</MotionPresence>);
  expect(screen.queryByRole("dialog")).toBeNull();
  const exiting = document.querySelector('[data-motion-present="false"]');
  expect(exiting).toHaveAttribute("inert");
  expect(exiting).toHaveAttribute("aria-hidden", "true");
  expect(exiting).toHaveStyle({ pointerEvents: "none" });
  await waitFor(() => expect(exiting).not.toBeInTheDocument());
});

test("rapid reversal keeps one interactive instance and its draft", async () => {
  mediaPreference();
  function Harness() {
    const [open, setOpen] = useState(true);
    return <div><button onClick={() => setOpen(value => !value)}>Toggle</button><MotionPresence>{open ? <MotionSurface key="panel" role="dialog"><input aria-label="Retained draft" /></MotionSurface> : null}</MotionPresence></div>;
  }
  render(<Harness />);
  const draft = screen.getByLabelText("Retained draft");
  fireEvent.change(draft, { target: { value: "Still editing" } });
  fireEvent.click(screen.getByText("Toggle"));
  fireEvent.click(screen.getByText("Toggle"));
  await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
  expect(screen.getByLabelText("Retained draft")).toBe(draft);
  expect(draft).toHaveValue("Still editing");
  expect(screen.getByRole("dialog")).not.toHaveAttribute("inert");
});
