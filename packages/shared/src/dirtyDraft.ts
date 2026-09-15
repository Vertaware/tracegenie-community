export type DraftSurface = "admin-form" | "widget";

export type DraftExitIntent =
  | "internal-navigation"
  | "organization-switch"
  | "browser-refresh"
  | "close"
  | "cancel"
  | "escape"
  | "scrim";

export type DirtyDraftInput = {
  surface: DraftSurface;
  intent: DraftExitIntent;
  isDirty: boolean;
  isMutationPending: boolean;
};

export type DirtyDraftExitDecision =
  | { kind: "allow" }
  | { kind: "block-pending" }
  | { kind: "native-beforeunload" }
  | { kind: "confirm"; options: readonly ["stay", "discard"] }
  | { kind: "confirm"; options: readonly ["keep-editing", "discard"] };

export function resolveDirtyDraftExit(input: DirtyDraftInput): DirtyDraftExitDecision {
  if (input.isMutationPending) {
    return { kind: "block-pending" };
  }
  if (!input.isDirty) {
    return { kind: "allow" };
  }
  if (input.intent === "browser-refresh") {
    return { kind: "native-beforeunload" };
  }
  return input.surface === "widget"
    ? { kind: "confirm", options: ["keep-editing", "discard"] }
    : { kind: "confirm", options: ["stay", "discard"] };
}
