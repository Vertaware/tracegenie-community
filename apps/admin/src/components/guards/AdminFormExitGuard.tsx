import {
createContext,
type ReactNode,
useCallback,
useContext,
useEffect,
useMemo,
useRef,
useState,
} from "react";
import { resolveDirtyDraftExit,type DraftExitIntent } from "@tracegenie/shared";
import { useBeforeUnload,useBlocker } from "react-router-dom";

import { ConfirmDialog } from "../ui/ConfirmDialog";

type AdminFormSnapshot = {
  isDirty: boolean;
  isMutationPending: boolean;
};

type AdminFormRegistration = {
  id: string;
  getSnapshot: () => AdminFormSnapshot;
  discard: () => void;
  retainedSearchParams?: readonly string[];
};

type PendingExit =
  | { kind: "route"; intent: "internal-navigation" }
  | {
      kind: "manual";
      intent: Exclude<DraftExitIntent, "browser-refresh">;
      proceed: () => void;
      discardAndProceed?: () => void;
    };

type AdminFormExitGuardContextValue = {
  register: (registration: AdminFormRegistration) => () => void;
  notify: (id: string) => void;
  requestExit: (
    intent: Exclude<DraftExitIntent, "browser-refresh">,
    proceed: () => void,
    discardAndProceed?: () => void,
  ) => void;
  commitAndExit: (proceed: () => void) => void;
};

type UseAdminFormExitGuardInput = {
  id: string;
  isDirty: boolean;
  isMutationPending: boolean;
  onDiscard: () => void;
  /** View changes that keep this form and all its drafts mounted. */
  retainedSearchParams?: readonly string[];
};

const AdminFormExitGuardContext = createContext<AdminFormExitGuardContextValue | null>(null);

function getDecision(registration: AdminFormRegistration | null, intent: DraftExitIntent) {
  if (!registration) return { kind: "allow" } as const;
  const snapshot = registration.getSnapshot();
  return resolveDirtyDraftExit({
    surface: "admin-form",
    intent,
    isDirty: snapshot.isDirty,
    isMutationPending: snapshot.isMutationPending,
  });
}

export function AdminFormExitGuardProvider({ children }: { children: ReactNode }) {
  const activeRegistrationRef = useRef<AdminFormRegistration | null>(null);
  const bypassNextRouteRef = useRef(false);
  const pendingExitRef = useRef<PendingExit | null>(null);
  const [registrationVersion, setRegistrationVersion] = useState(0);
  const [pendingExit, setPendingExit] = useState<PendingExit | null>(null);

  const updatePendingExit = useCallback((exit: PendingExit | null) => {
    pendingExitRef.current = exit;
    setPendingExit(exit);
  }, []);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (currentLocation.pathname === nextLocation.pathname
      && currentLocation.search === nextLocation.search
      && currentLocation.hash === nextLocation.hash) {
      return false;
    }
    const retained = activeRegistrationRef.current?.retainedSearchParams;
    if (retained?.length && currentLocation.pathname === nextLocation.pathname
      && currentLocation.hash === nextLocation.hash) {
      const current = new URLSearchParams(currentLocation.search);
      const next = new URLSearchParams(nextLocation.search);
      retained.forEach((key) => { current.delete(key); next.delete(key); });
      current.sort();
      next.sort();
      if (current.toString() === next.toString()) return false;
    }
    if (bypassNextRouteRef.current) {
      bypassNextRouteRef.current = false;
      return false;
    }
    return getDecision(activeRegistrationRef.current, "internal-navigation").kind !== "allow";
  });

  const register = useCallback((registration: AdminFormRegistration) => {
    activeRegistrationRef.current = registration;
    setRegistrationVersion((current) => current + 1);
    return () => {
      if (activeRegistrationRef.current?.id === registration.id) {
        activeRegistrationRef.current = null;
        setRegistrationVersion((current) => current + 1);
      }
    };
  }, []);

  const notify = useCallback((id: string) => {
    if (activeRegistrationRef.current?.id === id) {
      setRegistrationVersion((current) => current + 1);
    }
  }, []);

  const requestExit = useCallback((
    intent: Exclude<DraftExitIntent, "browser-refresh">,
    proceed: () => void,
    discardAndProceed?: () => void,
  ) => {
    if (pendingExitRef.current) return;
    const decision = getDecision(activeRegistrationRef.current, intent);
    if (decision.kind === "allow") {
      proceed();
      return;
    }
    updatePendingExit({ kind: "manual", intent, proceed, discardAndProceed });
  }, [updatePendingExit]);

  const commitAndExit = useCallback((proceed: () => void) => {
    if (blocker.state === "blocked") {
      updatePendingExit(null);
      blocker.proceed();
      return;
    }
    const pending = pendingExitRef.current;
    if (pending) {
      updatePendingExit(null);
      if (pending.kind === "route") {
        return;
      }
      pending.proceed();
      return;
    }

    bypassNextRouteRef.current = true;
    try {
      proceed();
    } finally {
      window.setTimeout(() => {
        bypassNextRouteRef.current = false;
      }, 0);
    }
  }, [blocker, updatePendingExit]);

  useBeforeUnload(useCallback((event) => {
    const decision = getDecision(activeRegistrationRef.current, "browser-refresh");
    if (decision.kind === "native-beforeunload" || decision.kind === "block-pending") {
      event.preventDefault();
      event.returnValue = "";
    }
  }, []));

  useEffect(() => {
    if (blocker.state === "blocked" && !pendingExitRef.current) {
      updatePendingExit({ kind: "route", intent: "internal-navigation" });
    }
  }, [blocker.state, updatePendingExit]);

  const pendingDecision = pendingExit
    ? getDecision(activeRegistrationRef.current, pendingExit.intent)
    : null;

  useEffect(() => {
    if (!pendingExit || pendingDecision?.kind !== "allow") return;
    const exit = pendingExit;
    updatePendingExit(null);
    if (exit.kind === "route") {
      if (blocker.state === "blocked") blocker.proceed();
      return;
    }
    exit.proceed();
  }, [blocker, pendingDecision?.kind, pendingExit, registrationVersion, updatePendingExit]);

  const stay = useCallback(() => {
    const exit = pendingExit;
    updatePendingExit(null);
    if (exit?.kind === "route" && blocker.state === "blocked") {
      blocker.reset();
    }
  }, [blocker, pendingExit, updatePendingExit]);

  const discardAndProceed = useCallback(() => {
    const exit = pendingExit;
    if (!exit) return;
    if (exit.kind === "manual" && exit.discardAndProceed) {
      updatePendingExit(null);
      exit.discardAndProceed();
      return;
    }
    activeRegistrationRef.current?.discard();
    updatePendingExit(null);
    if (exit.kind === "route") {
      if (blocker.state === "blocked") blocker.proceed();
      return;
    }
    exit.proceed();
  }, [blocker, pendingExit, updatePendingExit]);

  const value = useMemo<AdminFormExitGuardContextValue>(() => ({
    register,
    notify,
    requestExit,
    commitAndExit,
  }), [commitAndExit, notify, register, requestExit]);

  return (
    <AdminFormExitGuardContext.Provider value={value}>
      <div id="admin-form-exit-guard-root" className="contents">
        {children}
        <ConfirmDialog
          isOpen={pendingDecision?.kind === "confirm"}
          title="Discard unsaved changes?"
          description="Your changes on this page have not been saved. Discard them and continue?"
          confirmText="Discard"
          cancelText="Stay"
          confirmTone="danger"
          onConfirm={discardAndProceed}
          onCancel={stay}
        />
      </div>
    </AdminFormExitGuardContext.Provider>
  );
}

export function useAdminFormExitGuard({
  id,
  isDirty,
  isMutationPending,
  onDiscard,
  retainedSearchParams,
}: UseAdminFormExitGuardInput) {
  const context = useContext(AdminFormExitGuardContext);
  const register = context?.register;
  const notify = context?.notify;
  const snapshotRef = useRef<AdminFormSnapshot>({ isDirty, isMutationPending });
  const discardRef = useRef(onDiscard);
  snapshotRef.current = { isDirty, isMutationPending };
  discardRef.current = onDiscard;

  useEffect(() => {
    if (!register) return;
    return register({
      id,
      getSnapshot: () => snapshotRef.current,
      discard: () => discardRef.current(),
      retainedSearchParams,
    });
  }, [id, register, retainedSearchParams]);

  useEffect(() => {
    notify?.(id);
  }, [id, isDirty, isMutationPending, notify]);

  return {
    requestExit: context?.requestExit ?? ((
      _intent: Exclude<DraftExitIntent, "browser-refresh">,
      proceed: () => void,
    ) => proceed()),
    commitAndExit: context?.commitAndExit ?? ((proceed: () => void) => proceed()),
  };
}

export function useAdminExitActions() {
  const context = useContext(AdminFormExitGuardContext);
  return {
    requestExit: context?.requestExit ?? ((
      _intent: Exclude<DraftExitIntent, "browser-refresh">,
      proceed: () => void,
    ) => proceed()),
    commitAndExit: context?.commitAndExit ?? ((proceed: () => void) => proceed()),
  };
}
