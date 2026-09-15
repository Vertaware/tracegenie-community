const LOCK_ATTRIBUTE = "data-tg-overlay-scroll-locked";
const LOCK_STYLE_ID = "tg-overlay-scroll-lock-style";

type LockState = {
  count: number;
  attributeWasPresent: boolean;
};

const lockStates = new WeakMap<Document, LockState>();

function ensureLockStyle(documentNode: Document) {
  if (documentNode.getElementById(LOCK_STYLE_ID)) return;

  const style = documentNode.createElement("style");
  style.id = LOCK_STYLE_ID;
  style.textContent = `body[${LOCK_ATTRIBUTE}] { overflow: hidden !important; }`;
  documentNode.head.append(style);
}

export function acquireBodyScrollLock(documentNode: Document = document) {
  const state = lockStates.get(documentNode) ?? {
    count: 0,
    attributeWasPresent: false,
  };

  if (state.count === 0) {
    state.attributeWasPresent = documentNode.body.hasAttribute(LOCK_ATTRIBUTE);
    ensureLockStyle(documentNode);
    documentNode.body.setAttribute(LOCK_ATTRIBUTE, "");
  }

  state.count += 1;
  lockStates.set(documentNode, state);

  let released = false;
  return () => {
    if (released) return;
    released = true;

    state.count = Math.max(0, state.count - 1);
    if (state.count > 0) return;

    if (!state.attributeWasPresent) {
      documentNode.body.removeAttribute(LOCK_ATTRIBUTE);
    }
    lockStates.delete(documentNode);
  };
}
