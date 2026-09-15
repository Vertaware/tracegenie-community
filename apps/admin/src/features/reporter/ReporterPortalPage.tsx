import { FormEvent,useEffect,useRef,useState } from "react";
import { type FeedbackStatus,STATUS_META } from "@tracegenie/shared";
import { ArrowLeft,ChevronRight,RefreshCw,Download } from "lucide-react";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { StatusChip } from "../../components/ui/StatusChip";
import { TraceLogo } from "../../components/ui/TraceLogo";
import { ApiError,api } from "../../lib/api";
import { AuthShell } from "../auth/AuthShell";
import { reporterSelfServiceApi } from "./reporterSelfServiceApi";

type ReporterScope = {
  organizationId: string;
  organizationName: string;
  projects: Array<{
    projectId: string;
    projectKey: string;
    projectName: string;
  }>;
};

type ReporterStatusHistoryEntry = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  createdAt: string;
};

type ReporterAttachment = {
  id: string;
  kind: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  expiresAt?: string | null;
  downloadStatus?: "ready" | "expired";
  createdAt: string;
};

type ReporterTicket = {
  id: string;
  ticketNumber: number;
  title: string;
  description: string;
  status: string;
  isOverageLocked: boolean;
  requesterNotificationsEnabled: boolean;
  resolutionFeedback: {
    state: "awaiting_confirmation" | "confirmed_fixed" | "still_happening" | "closed";
    respondedAt: string | null;
  } | null;
  project: {
    name: string;
    organizationName: string;
  };
  comments?: Array<{
    id: string;
    body: string;
    createdAt: string;
    author?: "reporter" | "team" | "unknown";
  }>;
  createdAt?: string;
  updatedAt?: string;
  attachments?: ReporterAttachment[];
  statusHistory?: ReporterStatusHistoryEntry[];
};

type ReporterTicketPagination = {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  hasNextPage: boolean;
};

type ReporterCommentRecovery = {
  ticketId: string;
  body: string;
  clientRequestId: string;
  error: string;
};

type ReporterAttachmentRecovery = {
  ticketId: string;
  file: File;
  clientRequestId: string;
  error: string;
};

type ReporterCommentStatus = {
  ticketId: string;
  message: string;
};

type ReporterCommentValidation = {
  ticketId: string;
  message: string;
};

type ReporterResolutionRecovery = {
  ticketId: string;
  action: "confirm_fixed" | "still_happening";
  clientRequestId: string;
  body?: string;
  error: string;
};

type ReporterBridgeState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; ticketNumber: number; organizationName: string; projectName: string }
  | { status: "offline" }
  | { status: "invalid"; message: string };

const REPORTER_BRIDGE_STORAGE_KEY = "tracegenie:reporter-bridge";
const REPORTER_OTP_RESEND_SECONDS = 60;
const REPORTER_OTP_EXPIRY_SECONDS = 10 * 60;

type ReporterAuthStep = "email" | "code" | "authenticated";
type ReporterAuthErrorField = "email" | "code" | "summary";

function positiveDuration(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : fallback;
}

function initialReporterBridgeToken() {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.slice(1));
  const hashToken = hashParams.get("bridge")?.trim() ?? "";
  const viewAllTickets = url.searchParams.get("view") === "all" && !hashToken;
  const queryContainedBridge = url.searchParams.has("bridge");
  if (hashToken) {
    window.sessionStorage.setItem(REPORTER_BRIDGE_STORAGE_KEY, hashToken);
    hashParams.delete("bridge");
  }
  if (hashToken || queryContainedBridge) {
    url.searchParams.delete("bridge");
    url.hash = hashParams.toString();
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  if (hashToken) {
    return hashToken;
  }
  if (viewAllTickets) {
    window.sessionStorage.removeItem(REPORTER_BRIDGE_STORAGE_KEY);
    return "";
  }
  return window.sessionStorage.getItem(REPORTER_BRIDGE_STORAGE_KEY)?.trim() ?? "";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTicketTime(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ticketUpdatedDate(ticket: ReporterTicket) {
  const dates = [ticket.updatedAt, ticket.createdAt, ...(ticket.comments ?? []).map((item) => item.createdAt), ...(ticket.statusHistory ?? []).map((item) => item.createdAt)].filter((value): value is string => Boolean(value));
  const latest = dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return latest ? new Date(latest).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
}

function statusLabel(status: string) {
  if (status === "open") return "New";
  return STATUS_META[status as FeedbackStatus]?.label ?? status.replaceAll("_", " ");
}

function statusHistoryText(entry: ReporterStatusHistoryEntry) {
  if (!entry.fromStatus) {
    return `Created as ${statusLabel(entry.toStatus)}`;
  }

  return `Moved from ${statusLabel(entry.fromStatus)} to ${statusLabel(entry.toStatus)}`;
}

function downloadReporterData(blob: Blob, fileName = `tracegenie-my-data-${new Date().toISOString().slice(0, 10)}.json`) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReporterPortalPage() {
  const [bridgeToken] = useState(initialReporterBridgeToken);
  const [bridgeState, setBridgeState] = useState<ReporterBridgeState>(() => bridgeToken
    ? { status: navigator.onLine ? "loading" : "offline" }
    : { status: "none" });
  const [email, setEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [code, setCode] = useState("");
  const [authStep, setAuthStep] = useState<ReporterAuthStep>("email");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [expirySeconds, setExpirySeconds] = useState(0);
  const [token, setToken] = useState("");
  const [selectedTicketId, setSelectedTicketId] = useState(() => new URLSearchParams(window.location.search).get("ticket"));
  const [listedTicketIds, setListedTicketIds] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const [showEarlier, setShowEarlier] = useState(false);
  const returnFocusRef = useRef<string | null>(null);
  const [tickets, setTickets] = useState<ReporterTicket[]>([]);
  const [ticketPagination, setTicketPagination] = useState<ReporterTicketPagination | null>(null);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [scopes, setScopes] = useState<ReporterScope[]>([]);
  const [scopeToken, setScopeToken] = useState("");
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentRecovery, setCommentRecovery] = useState<ReporterCommentRecovery | null>(null);
  const [attachmentRecovery, setAttachmentRecovery] = useState<ReporterAttachmentRecovery | null>(null);
  const [commentStatus, setCommentStatus] = useState<ReporterCommentStatus | null>(null);
  const [commentValidation, setCommentValidation] = useState<ReporterCommentValidation | null>(null);
  const [resolutionRecovery, setResolutionRecovery] = useState<ReporterResolutionRecovery | null>(null);
  const [submittingCommentId, setSubmittingCommentId] = useState<string | null>(null);
  const [uploadingAttachmentId, setUploadingAttachmentId] = useState<string | null>(null);
  const [markingStillHappeningId, setMarkingStillHappeningId] = useState<string | null>(null);
  const [confirmingFixedId, setConfirmingFixedId] = useState<string | null>(null);
  const [requestingCode, setRequestingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authErrorField, setAuthErrorField] = useState<ReporterAuthErrorField | null>(null);
  const ticketActionLockRef = useRef(false);

  function ticketHref(ticketId: string | null) {
    const url = new URL(window.location.href);
    if (ticketId) url.searchParams.set("ticket", ticketId);
    else url.searchParams.delete("ticket");
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function navigateTicket(ticketId: string | null, replace = false) {
    returnFocusRef.current = selectedTicketId;
    window.history[replace ? "replaceState" : "pushState"]({}, "", ticketHref(ticketId));
    setSelectedTicketId(ticketId);
    setShowEarlier(false);
    setDetailError(null);
    setMessage(null);
    setError(null);
  }

  useEffect(() => {
    const onPopState = () => {
      setSelectedTicketId(new URLSearchParams(window.location.search).get("ticket"));
      setShowEarlier(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const selectedTicket = tickets.find((ticket) => ticket.id === selectedTicketId);
  useEffect(() => {
    if (!token || !selectedTicketId || selectedTicket || loadingTickets) return;
    let current = true;
    setDetailLoading(true);
    setDetailError(null);
    void api.getReporterTicket(token, selectedTicketId).then((result) => {
      if (current) setTickets((items) => [...items.filter((item) => item.id !== result.ticket.id), result.ticket]);
    }).catch((caught) => {
      if (current) setDetailError(caught instanceof Error ? caught.message : "Could not open this ticket.");
    }).finally(() => {
      if (current) setDetailLoading(false);
    });
    return () => { current = false; };
  }, [token, selectedTicketId, Boolean(selectedTicket), loadingTickets, detailRetry]);

  useEffect(() => {
    if (authStep !== "authenticated") return;
    const target = selectedTicketId
      ? document.getElementById("reporter-ticket-title")
      : document.getElementById(`reporter-ticket-link-${returnFocusRef.current}`) ?? document.getElementById("reporter-list-title");
    target?.focus({ preventScroll: true });
  }, [authStep, selectedTicketId, Boolean(selectedTicket)]);

  useEffect(() => {
    if (authErrorField === "email" && authStep === "email" && !requestingCode) {
      document.getElementById("reporter-email")?.focus();
    } else if (authErrorField === "code" && authStep === "code" && !verifyingCode) {
      document.getElementById("reporter-code")?.focus();
    } else if (authErrorField === "summary" && authStep === "email") {
      document.getElementById("reporter-auth-error-summary")?.focus();
    }
  }, [authErrorField, authStep, requestingCode, verifyingCode]);

  useEffect(() => {
    if (!bridgeToken) return;
    const controller = new AbortController();
    const loadBridge = async () => {
      if (!navigator.onLine) {
        setBridgeState({ status: "offline" });
        return;
      }
      setBridgeState({ status: "loading" });
      try {
        const result = await api.getReporterBridge(bridgeToken, controller.signal);
        setBridgeState({ status: "ready", ...result.bridge });
      } catch (caught) {
        if (controller.signal.aborted) return;
        setBridgeState({
          status: "invalid",
          message: caught instanceof Error ? caught.message : "This report link is not available.",
        });
      }
    };
    const handleOnline = () => void loadBridge();
    const handleOffline = () => setBridgeState({ status: "offline" });
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    void loadBridge();
    return () => {
      controller.abort();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [bridgeToken]);

  useEffect(() => {
    if (authStep !== "code" || (resendSeconds <= 0 && expirySeconds <= 0)) return;
    const timer = window.setInterval(() => {
      setResendSeconds((current) => Math.max(0, current - 1));
      setExpirySeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [authStep, resendSeconds, expirySeconds]);

  function beginTicketAction(preserveCommentRecovery = false, preserveResolutionRecovery = false) {
    if (ticketActionLockRef.current) return false;
    ticketActionLockRef.current = true;
    if (!preserveCommentRecovery) {
      setCommentRecovery(null);
    }
    if (!preserveResolutionRecovery) {
      setResolutionRecovery(null);
    }
    setAttachmentRecovery(null);
    setCommentStatus(null);
    setCommentValidation(null);
    setMessage(null);
    setError(null);
    return true;
  }

  function finishTicketAction() {
    ticketActionLockRef.current = false;
  }

  function authErrorMessage(caught: unknown, fallback: string) {
    if (caught instanceof ApiError && caught.status === 429) {
      return "Too many attempts. Wait a minute, then try again.";
    }
    return caught instanceof Error ? caught.message : fallback;
  }

  async function sendOtp(targetEmail: string) {
    setRequestingCode(true);
    setMessage(null);
    setError(null);
    setAuthErrorField(null);
    try {
      const normalizedEmail = targetEmail.trim().toLowerCase();
      const result = await api.requestReporterOtp(
        normalizedEmail,
        bridgeState.status === "ready" ? bridgeToken : undefined,
      ) as { ok: true; retryAfterSeconds?: number; expiresInSeconds?: number };
      setSubmittedEmail(normalizedEmail);
      setCode("");
      setScopes([]);
      setScopeToken("");
      setSelectedOrganizationId("");
      setResendSeconds(positiveDuration(result.retryAfterSeconds, REPORTER_OTP_RESEND_SECONDS));
      setExpirySeconds(positiveDuration(result.expiresInSeconds, REPORTER_OTP_EXPIRY_SECONDS));
      setAuthStep("code");
      setMessage("If this email has reports, a six-digit code is on its way.");
      window.setTimeout(() => document.getElementById("reporter-code")?.focus(), 0);
    } catch (caught) {
      setError(authErrorMessage(caught, "We couldn't send a code right now. Try again."));
      setAuthErrorField("email");
    } finally {
      setRequestingCode(false);
    }
  }

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    const emailInput = event.currentTarget.querySelector<HTMLInputElement>("#reporter-email");
    if (!emailInput?.validity.valid) {
      setMessage(null);
      setError("Enter a valid report email.");
      setAuthErrorField("email");
      return;
    }
    await sendOtp(email);
  }

  function changeEmail() {
    setAuthStep("email");
    setSubmittedEmail("");
    setCode("");
    setScopes([]);
    setScopeToken("");
    setSelectedOrganizationId("");
    setResendSeconds(0);
    setExpirySeconds(0);
    setMessage(null);
    setError(null);
    setAuthErrorField(null);
    window.setTimeout(() => document.getElementById("reporter-email")?.focus(), 0);
  }

  async function loadTickets(sessionToken: string, page = 1, append = false) {
    setLoadingTickets(true);
    setTicketsError(null);
    try {
      const list = await api.getReporterTickets(sessionToken, page);
      setTickets((current) => append
        ? [...current.filter((item) => !list.tickets.some((next) => next.id === item.id)), ...list.tickets]
        : list.tickets);
      setListedTicketIds((current) => append ? [...new Set([...current, ...list.tickets.map((item) => item.id)])] : list.tickets.map((item) => item.id));
      if (!append && bridgeState.status === "ready" && list.tickets[0]) navigateTicket(list.tickets[0].id, true);
      setTicketPagination(list.pagination);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setToken("");
        setTickets([]);
        setTicketPagination(null);
        setAuthStep("email");
        setSubmittedEmail("");
        setError("Your secure session expired. Request a new code to continue.");
        setAuthErrorField("summary");
        return;
      }
      setTicketsError(caught instanceof Error ? caught.message : "Could not load your reports.");
    } finally {
      setLoadingTickets(false);
    }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    setVerifyingCode(true);
    setMessage(null);
    setError(null);
    setAuthErrorField(null);
    try {
      const result = await api.verifyReporterOtp(
        submittedEmail,
        code,
        bridgeState.status === "ready"
          ? { bridgeToken }
          : selectedOrganizationId
          ? {
              organizationId: selectedOrganizationId,
              scopeToken: scopeToken || undefined,
            }
          : undefined,
      );
      setToken(result.token);
      setAuthStep("authenticated");
      setMessage(null);
      if (bridgeState.status === "ready") {
        window.sessionStorage.removeItem(REPORTER_BRIDGE_STORAGE_KEY);
      }
      setScopes([]);
      setScopeToken("");
      await loadTickets(result.token);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "reporter.scope_required") {
        const details = caught.details as { scopes?: ReporterScope[]; scopeToken?: string } | undefined;
        const availableScopes = details?.scopes ?? [];
        setScopes(availableScopes);
        setScopeToken(details?.scopeToken ?? "");
        setSelectedOrganizationId(availableScopes[0]?.organizationId ?? "");
        setMessage("Choose which product team should open these updates.");
        setAuthErrorField(null);
        return;
      }
      setError(authErrorMessage(caught, "Could not verify that access code."));
      setAuthErrorField("code");
    } finally {
      setVerifyingCode(false);
    }
  }

  function logout() {
    navigateTicket(null, true);
    setCommentDrafts({});
    setCommentRecovery(null);
    setResolutionRecovery(null);
    setAttachmentRecovery(null);
    setCommentStatus(null);
    setCommentValidation(null);
    setListedTicketIds([]);
    setTicketPagination(null);
    setToken("");
    setTickets([]);
    setTicketsError(null);
    setLoadingTickets(false);
    setAuthStep("email");
    setEmail("");
    setSubmittedEmail("");
    setCode("");
    setScopes([]);
    setScopeToken("");
    setSelectedOrganizationId("");
    setResendSeconds(0);
    setExpirySeconds(0);
    setMessage("You have signed out on this device.");
    setError(null);
    setAuthErrorField(null);
    window.setTimeout(() => document.getElementById("reporter-email")?.focus(), 0);
  }

  async function addReporterUpdate(ticketId: string, body: string, isRetry = false, retryClientRequestId?: string) {
    if (!beginTicketAction(isRetry)) return;

    const clientRequestId = isRetry && retryClientRequestId
      ? retryClientRequestId
      : `reporter-comment:${window.crypto.randomUUID()}`;
    setSubmittingCommentId(ticketId);
    try {
      const result = await reporterSelfServiceApi.addComment(token, ticketId, body, clientRequestId);
      setTickets((currentTickets) =>
        currentTickets.map((ticket) =>
          ticket.id === ticketId
            ? {
                ...ticket,
                comments: (ticket.comments ?? []).some((comment) => comment.id === result.comment.id)
                  ? ticket.comments
                  : [...(ticket.comments ?? []), { ...result.comment, author: "reporter" as const }],
                updatedAt: result.comment.createdAt,
              }
            : ticket,
        ),
      );
      setCommentDrafts((currentDrafts) => currentDrafts[ticketId]?.trim() === body
        ? { ...currentDrafts, [ticketId]: "" }
        : currentDrafts);
      setCommentRecovery(null);
      setCommentStatus({ ticketId, message: "Your update was added." });
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "The request did not complete.";
      setCommentRecovery({
        ticketId,
        body,
        clientRequestId,
        error: `Could not add your update. ${reason}`,
      });
    } finally {
      setSubmittingCommentId(null);
      finishTicketAction();
    }
  }

  async function submitComment(ticketId: string, event: FormEvent) {
    event.preventDefault();
    const body = commentDrafts[ticketId]?.trim();
    if (!body) {
      if (!beginTicketAction()) return;
      setCommentValidation({ ticketId, message: "Enter an update before submitting." });
      finishTicketAction();
      return;
    }
    await addReporterUpdate(ticketId, body);
  }

  function retryComment(ticketId: string) {
    if (commentRecovery?.ticketId !== ticketId) return;
    void addReporterUpdate(ticketId, commentRecovery.body, true, commentRecovery.clientRequestId);
  }

  async function uploadAttachment(ticketId: string, event?: FormEvent<HTMLFormElement>, retry?: ReporterAttachmentRecovery) {
    event?.preventDefault();
    const form = event?.currentTarget;
    const file = retry?.file ?? (form ? new FormData(form).get("file") : null);
    if (!(file instanceof File) || file.size === 0) {
      setMessage("Choose an image before uploading.");
      return;
    }
    if (!beginTicketAction()) return;
    const clientRequestId = retry?.clientRequestId ?? `reporter-attachment:${window.crypto.randomUUID()}`;

    setUploadingAttachmentId(ticketId);
    setMessage(null);
    setError(null);
    try {
      const result = await reporterSelfServiceApi.uploadAttachment(token, ticketId, file, clientRequestId) as { attachment: ReporterAttachment };
      setTickets((currentTickets) =>
        currentTickets.map((ticket) =>
          ticket.id === ticketId
            ? {
                ...ticket,
                attachments: [...(ticket.attachments ?? []), result.attachment],
              }
            : ticket,
        ),
      );
      form?.reset();
      setMessage("Attachment added.");
    } catch (error) {
      setAttachmentRecovery({
        ticketId,
        file,
        clientRequestId,
        error: error instanceof Error ? error.message : "Could not add this attachment.",
      });
    } finally {
      setUploadingAttachmentId(null);
      finishTicketAction();
    }
  }

  async function markStillHappening(ticketId: string, retryBody?: string, isRetry = false, retryClientRequestId?: string) {
    if (!beginTicketAction(false, isRetry)) return;
    const body = isRetry ? retryBody : commentDrafts[ticketId]?.trim() || undefined;
    const clientRequestId = isRetry && retryClientRequestId
      ? retryClientRequestId
      : `reporter-reopen:${window.crypto.randomUUID()}`;
    setMarkingStillHappeningId(ticketId);
    setMessage(null);
    setError(null);
    try {
      const result = await api.markReporterStillHappening(token, ticketId, body, clientRequestId);
      setTickets((currentTickets) =>
        currentTickets.map((ticket) => (ticket.id === ticketId ? result.ticket : ticket)),
      );
      setCommentDrafts((currentDrafts) => currentDrafts[ticketId]?.trim() === body
        ? { ...currentDrafts, [ticketId]: "" }
        : currentDrafts);
      setResolutionRecovery(null);
    } catch (error) {
      setResolutionRecovery({
        ticketId,
        action: "still_happening",
        clientRequestId,
        body,
        error: error instanceof Error ? error.message : "Could not update this report.",
      });
    } finally {
      setMarkingStillHappeningId(null);
      finishTicketAction();
    }
  }

  async function confirmFixed(ticketId: string, retryBody?: string, isRetry = false, retryClientRequestId?: string) {
    if (!beginTicketAction(false, isRetry)) return;
    const body = isRetry ? retryBody : commentDrafts[ticketId]?.trim() || undefined;
    const clientRequestId = isRetry && retryClientRequestId
      ? retryClientRequestId
      : `reporter-confirm:${window.crypto.randomUUID()}`;
    setConfirmingFixedId(ticketId);
    setMessage(null);
    setError(null);
    try {
      const result = await api.confirmReporterFixed(token, ticketId, body, clientRequestId);
      setTickets((currentTickets) =>
        currentTickets.map((ticket) => (ticket.id === ticketId ? result.ticket : ticket)),
      );
      setCommentDrafts((currentDrafts) => currentDrafts[ticketId]?.trim() === body
        ? { ...currentDrafts, [ticketId]: "" }
        : currentDrafts);
      setResolutionRecovery(null);
    } catch (error) {
      setResolutionRecovery({
        ticketId,
        action: "confirm_fixed",
        clientRequestId,
        body,
        error: error instanceof Error ? error.message : "Could not update this report.",
      });
    } finally {
      setConfirmingFixedId(null);
      finishTicketAction();
    }
  }

  async function downloadAttachment(ticketId: string, attachment: ReporterAttachment) {
    if (attachment.downloadStatus === "expired") return;
    if (!beginTicketAction()) return;
    try {
      downloadReporterData(
        await reporterSelfServiceApi.downloadAttachment(token, ticketId, attachment.id),
        attachment.fileName,
      );
      setMessage("Attachment download started.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not download this attachment.");
    } finally {
      finishTicketAction();
    }
  }

  const ticketActionBusy = Boolean(
    submittingCommentId
    || uploadingAttachmentId
    || markingStillHappeningId
    || confirmingFixedId,
  );
  const codeExpired = authStep === "code" && expirySeconds === 0;
  const formattedExpiry = `${Math.floor(expirySeconds / 60)}:${String(expirySeconds % 60).padStart(2, "0")}`;

  if (authStep !== "authenticated") {
    const entryTitle = bridgeState.status === "ready"
      ? `Updates on issue #${bridgeState.ticketNumber}`
      : "My tickets";
    const entryDescription = authStep === "code"
      ? "Enter the six-digit code from your email to view your tickets."
      : "Enter the email you used to report the issue. We will send a one-time access code.";
    const entryBlocked = bridgeState.status === "loading" || bridgeState.status === "offline";
    const canResendCode = !requestingCode && resendSeconds === 0 && !entryBlocked;
    const codeDescriptionIds = [
      "reporter-code-help",
      canResendCode ? "reporter-code-expiry" : null,
      authErrorField === "code" ? "reporter-code-error" : null,
    ].filter(Boolean).join(" ");

    return (
      <AuthShell
        idPrefix="reporter-access"
        pageId="reporter-portal-page"
        cardId="reporter-auth-card"
        title={entryTitle}
        description={entryDescription}
        width="wide"
        showTrustDetails={false}
      >
        {bridgeState.status === "loading" ? (
          <div
            id="reporter-bridge-loading"
            className="mt-5 rounded-lg border border-border bg-surface-muted px-4 py-3"
            role="status"
          >
            <p className="text-label font-medium text-foreground">
              Checking your secure report link...
            </p>
            <p className="mt-1 text-caption text-muted">
              No report details are shown until the link is verified.
            </p>
          </div>
        ) : null}

        {bridgeState.status === "ready" ? (
          <div id="reporter-bridge-ready" className="mt-5 border-l-2 border-primary pl-4">
            <p className="break-words text-label font-semibold text-foreground">
              {bridgeState.projectName}
            </p>
            <p className="mt-1 break-words text-caption text-muted">
              {bridgeState.organizationName} · Verify your email to view this report.
            </p>
          </div>
        ) : null}

        {bridgeState.status === "offline" ? (
          <div
            id="reporter-bridge-offline"
            className="mt-5 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3"
            role="status"
          >
            <p className="text-label font-medium text-warning-700">
              You are offline.
            </p>
            <p className="mt-1 text-caption text-warning-700">
              Reconnect to verify this report link. This page will retry automatically.
            </p>
          </div>
        ) : null}

        {bridgeState.status === "invalid" ? (
          <div
            id="reporter-bridge-invalid"
            className="mt-5 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3"
            role="alert"
          >
            <p className="text-label font-medium text-danger-700">
              {bridgeState.message}
            </p>
            <p className="mt-1 text-caption text-danger-700">
              No report or organization details were exposed. You can still request access below.
            </p>
          </div>
        ) : null}

        {error ? (
          <div
            id="reporter-auth-error-summary"
            className="tg-message-banner mt-5 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2.5"
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
          >
            <p className="text-label font-semibold text-danger-700">
              {authErrorField === "email"
                ? "We could not send your access code."
                : authErrorField === "code"
                  ? "We could not verify your access code."
                  : "Your reporter session needs attention."}
            </p>
            <p className="mt-1 text-caption text-danger-700">
              {error}
            </p>
          </div>
        ) : null}

        {authStep === "email" ? (
          <form id="reporter-code-request-form" className="mt-6 space-y-4" noValidate onSubmit={requestOtp}>
            <div id="reporter-email-field">
              <label htmlFor="reporter-email" className="mb-1.5 block text-label font-medium text-foreground">
                Report email
              </label>
              <Input
                id="reporter-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                name="email"
                inputMode="email"
                autoComplete="email"
                required
                disabled={requestingCode}
                aria-invalid={authErrorField === "email" ? "true" : undefined}
                aria-describedby={authErrorField === "email"
                  ? "reporter-email-help reporter-email-error"
                  : "reporter-email-help"}
              />
              <p id="reporter-email-help" className="mt-1 text-caption text-muted">
                Use the address from your original report. Access stays limited to reports linked to that address.
              </p>
              {authErrorField === "email" && error ? (
                <p id="reporter-email-error" className="mt-1 text-caption text-danger-700">
                  {error}
                </p>
              ) : null}
            </div>
            <Button
              type="submit"
              className="h-11 w-full"
              disabled={requestingCode || entryBlocked}
            >
              {requestingCode ? "Sending access code..." : "Send access code"}
            </Button>
          </form>
        ) : null}

        {authStep === "code" ? (
          <div id="reporter-code-step" className="mt-6 space-y-5">
            <div id="reporter-code-recipient" className="border-b border-border/70 pb-4">
              <p className="text-label font-medium text-foreground">
                Code sent to
              </p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="min-w-0 break-all text-body text-muted">
                  {submittedEmail}
                </p>
                <button
                  type="button"
                  className="shrink-0 rounded-sm text-body text-primary underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
                  disabled={requestingCode || verifyingCode}
                  onClick={changeEmail}
                >
                  Change email
                </button>
              </div>
            </div>

            <form id="reporter-code-verify-form" className="space-y-4" noValidate onSubmit={verifyOtp}>
              {scopes.length > 1 ? (
                <div id="reporter-scope-picker">
                  <label htmlFor="reporter-organization" className="mb-1.5 block text-label font-medium text-foreground">
                    Organization
                  </label>
                  <select
                    id="reporter-organization"
                    className="tg-soft-input h-11 w-full rounded-lg border border-border bg-surface px-3 text-body text-foreground outline-none transition focus:border-primary focus:ring-3 focus:ring-primary/15"
                    value={selectedOrganizationId}
                    onChange={(event) => setSelectedOrganizationId(event.target.value)}
                    required
                  >
                    {scopes.map((scope) => (
                      <option key={scope.organizationId} value={scope.organizationId}>
                        {scope.organizationName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div id="reporter-code-field">
                <label htmlFor="reporter-code" className="mb-1.5 block text-label font-medium text-foreground">
                  Access code
                </label>
                <Input
                  id="reporter-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  disabled={verifyingCode}
                  aria-invalid={authErrorField === "code" ? "true" : undefined}
                  aria-describedby={codeDescriptionIds}
                />
                <p id="reporter-code-help" className="mt-1 text-caption text-muted">
                  Six digits. You can paste the code from your email.
                </p>
                {canResendCode ? (
                  <p
                    id="reporter-code-expiry"
                    className="mt-1 text-caption tabular-nums text-muted"
                    role={codeExpired ? "status" : "timer"}
                  >
                    {codeExpired ? "This code has expired. Request a new one." : `Code expires in ${formattedExpiry}.`}
                  </p>
                ) : null}
                {authErrorField === "code" && error ? (
                  <p id="reporter-code-error" className="mt-1 text-caption text-danger-700">
                    {error}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="submit"
                  className="h-11"
                  disabled={verifyingCode || code.length !== 6 || codeExpired || entryBlocked}
                >
                  {verifyingCode ? "Opening tickets..." : "Open tickets"}
                </Button>
                <Button
                  type="button"
                  tone="secondary"
                  className="h-11"
                  disabled={!canResendCode}
                  onClick={() => void sendOtp(submittedEmail)}
                >
                  <RefreshCw aria-hidden="true" className="size-4" />
                  {requestingCode ? "Sending..." : resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
                </Button>
              </div>
            </form>
          </div>
        ) : null}

        {message ? (
          <p id="reporter-status-message" className="tg-message-banner mt-4 text-label text-muted" role="status">
            {message}
          </p>
        ) : null}

      </AuthShell>
    );
  }

  const listedTickets = listedTicketIds.map((id) => tickets.find((item) => item.id === id)).filter((item): item is ReporterTicket => Boolean(item));

  return (
    <main id="reporter-portal-page" className={`mx-auto w-full px-4 pb-8 pt-4 sm:px-6 ${selectedTicketId ? "max-w-4xl" : "max-w-5xl"}`}>
      <header id="reporter-session-header" className="mb-3 flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <TraceLogo variant="full" size="sm" className="shrink-0" />
        <div id="reporter-session-account" className="flex min-w-0 flex-col items-end sm:flex-row sm:items-center sm:gap-3">
          <p id="reporter-session-email" className="min-w-0 break-all text-right text-caption text-muted" aria-label={`Signed in as ${submittedEmail}`}>
            {submittedEmail}
          </p>
          <button id="reporter-sign-out" type="button" className="min-h-10 shrink-0 rounded px-1 text-label text-muted underline-offset-4 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      {selectedTicketId ? (
        <a id="reporter-back-to-tickets" href={bridgeState.status === "ready" ? "/reporter?view=all" : ticketHref(null)} className="mb-3 inline-flex min-h-10 items-center gap-2 text-label text-muted hover:text-primary focus-visible:outline-primary" onClick={(event) => {
          if (bridgeState.status === "ready" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          navigateTicket(null);
        }}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          My tickets
        </a>
      ) : (
        <div id="reporter-list-heading" className="mb-4">
          <h1 id="reporter-list-title" tabIndex={-1} className="text-display text-foreground focus:outline-none">
            My tickets
          </h1>
          <p className="mt-1 text-body text-muted">
            View progress or open a ticket to reply to the team.
          </p>
        </div>
      )}
      {error ? <p id="reporter-error-message" role="alert" className="mb-4 text-body text-danger-700">
        {error}
      </p> : null}
      {message ? <p id="reporter-status-message" role="status" className="mb-4 text-body text-muted">
        {message}
      </p> : null}
      {(loadingTickets && tickets.length === 0) || (selectedTicketId && !selectedTicket && detailLoading) ? (
        <Card id="reporter-tickets-loading" role="status">
          <p className="text-body text-muted">
            Loading your tickets...
          </p>
        </Card>
      ) : null}
      {ticketsError || (selectedTicketId && detailError) ? (
        <Card id="reporter-tickets-error" role="alert">
          <p className="text-body text-danger-700">
            {ticketsError || detailError}
          </p>
          <Button className="mt-3" type="button" tone="secondary" onClick={() => ticketsError ? void loadTickets(token) : setDetailRetry((value) => value + 1)}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Try again
          </Button>
        </Card>
      ) : null}
      {!selectedTicketId && !loadingTickets && !ticketsError && listedTickets.length === 0 ? (
        <Card id="reporter-tickets-empty">
          <h2 className="text-title text-foreground">
            No tickets yet
          </h2>
          <p className="mt-2 text-body text-muted">
            Tickets reported with {submittedEmail} will appear here.
          </p>
        </Card>
      ) : null}
      {!selectedTicketId && listedTickets.length > 0 ? (
        <section id="reporter-ticket-list" aria-label="Your tickets" className="overflow-hidden rounded-2xl border border-border bg-surface">
          <table className="w-full table-fixed text-left">
            <caption className="sr-only">
              Your reported tickets. Open a ticket to read updates and reply.
            </caption>
            <thead className="border-b border-border/60 bg-surface-muted/40 text-caption text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium sm:px-5">
                  Ticket
                </th>
                <th scope="col" className="w-32 px-3 py-3 font-medium sm:w-44">
                  Status
                </th>
                <th scope="col" className="hidden w-32 px-5 py-3 font-medium md:table-cell">
                  Updated
                </th>
                <th scope="col" className="hidden w-12 sm:table-cell">
                  <span className="sr-only">
                  Open
                </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {listedTickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  className="group cursor-pointer hover:bg-primary-light/40 focus-within:bg-primary-light/40"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("a")) return;
                    navigateTicket(ticket.id);
                  }}
                >
                  <td className="break-words px-4 py-4 sm:px-5">
                    <a id={`reporter-ticket-link-${ticket.id}`} href={ticketHref(ticket.id)} className="block text-body font-semibold text-foreground decoration-primary underline-offset-4 hover:text-primary hover:underline focus-visible:outline-primary" onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      navigateTicket(ticket.id);
                    }}>
                      {ticket.title}
                    </a>
                    <p className="mt-1 text-caption text-muted">
                      #{ticket.ticketNumber} · {ticket.project.name}
                    </p>
                  </td>
                  <td className="px-3 py-4 align-top sm:align-middle">
                    <StatusChip status={ticket.status === "open" ? "new" : ticket.status} />
                    {ticket.resolutionFeedback?.state === "awaiting_confirmation" ? <p className="mt-1 text-caption text-primary">
                      Please confirm
                    </p> : null}
                  </td>
                  <td className="hidden px-5 py-4 text-caption text-muted md:table-cell">
                    {ticketUpdatedDate(ticket)}
                  </td>
                  <td className="hidden pr-5 text-muted sm:table-cell">
                    <ChevronRight aria-hidden="true" className="size-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {selectedTicket ? [selectedTicket].map((ticket) => (
        <article key={ticket.id} id={`reporter-ticket-${ticket.id}`}>
          <header id="reporter-ticket-heading" className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <h1 id="reporter-ticket-title" tabIndex={-1} className="break-words text-display text-foreground focus:outline-none">
              {ticket.title}
            </h1>
            <dl id="reporter-ticket-summary" className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/50 pt-4 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
              <div id="reporter-summary-number" className="order-1 min-w-0">
                <dt className="text-caption text-muted">
                  Ticket
                </dt>
                <dd className="mt-1 text-body text-foreground">
                  #{ticket.ticketNumber}
                </dd>
              </div>
              <div id="reporter-summary-product" className="order-3 col-span-2 min-w-0 sm:order-2 sm:col-span-1">
                <dt className="text-caption text-muted">
                  Product
                </dt>
                <dd className="mt-1 break-words text-body text-foreground">
                  {ticket.project.name}
                </dd>
              </div>
              <div id="reporter-summary-status" className="order-2 min-w-0 sm:order-3">
                <dt className="text-caption text-muted">
                  Status
                </dt>
                <dd className="mt-1 flex min-h-5 items-center">
                  <StatusChip status={ticket.status === "open" ? "new" : ticket.status} />
                </dd>
              </div>
            </dl>
          </header>
          {ticket.isOverageLocked ? (
            <section id={`reporter-ticket-capacity-lock-${ticket.id}`} role="status" className="mt-5 rounded-xl bg-warning-50 p-4">
              <h2 className="text-label font-semibold text-warning-700">
                Processing paused
              </h2>
              <p className="mt-1 text-body text-foreground">
                Your ticket is saved and no data was lost. The team needs to restore issue capacity before you can reply or respond to a fix.
              </p>
            </section>
          ) : null}
          {ticket.resolutionFeedback ? (
            <section id={`reporter-ticket-resolution-${ticket.id}`} className={`mt-5 rounded-xl px-4 py-4 ${ticket.status === "closed" ? "bg-success-50" : "bg-primary-light"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-xl">
                  <h2 className="text-label font-semibold text-foreground">
                    {ticket.resolutionFeedback.state === "awaiting_confirmation"
                      ? "Did this fix the problem?"
                      : ticket.resolutionFeedback.state === "confirmed_fixed"
                        ? "You confirmed this fix"
                        : ticket.resolutionFeedback.state === "still_happening"
                          ? "You told the team it is still happening"
                          : "This ticket is closed"}
                  </h2>
                  <p className="mt-1 text-caption text-muted">
                    {ticket.resolutionFeedback.state === "awaiting_confirmation"
                      ? "Try the fix, then let the team know. Confirming closes this ticket. Add a reply below if you need to explain more."
                      : ticket.resolutionFeedback.state === "confirmed_fixed"
                        ? "This ticket is closed. No further action is needed."
                        : ticket.resolutionFeedback.state === "still_happening"
                          ? "The report is back in progress and your public update is visible to the team."
                          : "If the problem is not resolved, send it back to the team."}
                  </p>
                  {ticket.resolutionFeedback.respondedAt ? (
                    <p className="mt-1 text-caption text-muted">
                      {formatTicketTime(ticket.resolutionFeedback.respondedAt)}
                    </p>
                  ) : null}
                </div>
                {ticket.resolutionFeedback.state !== "still_happening" ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    {ticket.resolutionFeedback.state === "awaiting_confirmation" ? (
                      <Button
                        type="button"
                        tone="primary"
                        className="h-11"
                        disabled={ticketActionBusy || ticket.isOverageLocked}
                        onClick={() => void confirmFixed(ticket.id)}
                      >
                        {confirmingFixedId === ticket.id ? "Confirming..." : "Confirm fixed"}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      tone={ticket.status === "closed" ? "ghost" : "secondary"}
                      className={ticket.status === "closed" ? "h-10 px-0 underline underline-offset-4" : "h-10"}
                      disabled={ticketActionBusy || ticket.isOverageLocked}
                      onClick={() => void markStillHappening(ticket.id)}
                    >
                      {markingStillHappeningId === ticket.id ? "Updating..." : "Still having this issue?"}
                    </Button>
                  </div>
                ) : null}
              </div>
              {resolutionRecovery?.ticketId === ticket.id ? (
                <div id={`reporter-ticket-resolution-recovery-${ticket.id}`} role="alert" className="mt-3 border-t border-danger-200 pt-3">
                  <p className="text-caption text-danger-700">
                    Your response was not saved. {resolutionRecovery.error}
                  </p>
                  <Button
                    type="button"
                    tone="secondary"
                    className="mt-2 h-11"
                    disabled={ticketActionBusy || ticket.isOverageLocked}
                    onClick={() => resolutionRecovery.action === "confirm_fixed"
                      ? void confirmFixed(ticket.id, resolutionRecovery.body, true, resolutionRecovery.clientRequestId)
                      : void markStillHappening(ticket.id, resolutionRecovery.body, true, resolutionRecovery.clientRequestId)}
                  >
                    {confirmingFixedId === ticket.id || markingStillHappeningId === ticket.id
                      ? "Retrying response..."
                      : "Retry response"}
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}

          {!ticket.resolutionFeedback && !ticket.isOverageLocked ? (
            <p id="reporter-ticket-next-step" className="mt-3 text-body text-muted">
              {ticket.status === "triaged" ? "The team is reviewing your issue." : ticket.status === "in_progress" ? "The team is working on your issue." : ticket.status === "new" || ticket.status === "open" ? "Your issue has been received." : "Check the conversation below for the latest update."}
            </p>
          ) : null}
          <section id={`reporter-ticket-comments-${ticket.id}`} className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-4 sm:px-5">
              <h2 className="text-title text-foreground">
                Conversation
              </h2>
              {ticket.comments && ticket.comments.length > 4 ? (
                <button type="button" className="text-caption text-primary hover:underline" onClick={() => setShowEarlier((value) => !value)}>
                  {showEarlier ? "Show latest updates" : `Show ${ticket.comments.length - 4} earlier updates`}
                </button>
              ) : null}
            </div>
            {ticket.comments?.length ? (
              <div id="reporter-conversation-messages" className="divide-y divide-border/40">
                {(showEarlier ? ticket.comments : ticket.comments.slice(-4)).map((comment) => (
                  <article key={comment.id} className={`px-4 py-4 sm:px-5 ${comment.author === "reporter" ? "bg-surface-muted/35" : ""}`}>
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <p className={`text-label font-semibold ${comment.author === "team" ? "text-primary" : "text-foreground"}`}>
                        {comment.author === "reporter" ? "You" : comment.author === "team" ? `${ticket.project.name} team` : "Update"}
                      </p>
                      <time dateTime={comment.createdAt} className="text-caption text-muted">
                        {formatTicketTime(comment.createdAt)}
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-body text-foreground">
                      {comment.body}
                    </p>
                  </article>
                ))}
              </div>
            ) : <p className="px-4 py-5 text-body text-muted sm:px-5">
              No replies yet. You can add a detail or ask the team a question below.
            </p>}
            <div id="reporter-reply-composer" className="border-t border-border/50 px-4 pb-5 sm:px-5">
              <details key={`${ticket.id}-${ticket.status === "closed"}`} open={ticket.status !== "closed"}>
                <summary className={ticket.status === "closed" ? "cursor-pointer pt-4 text-label font-medium text-muted hover:text-foreground" : "hidden"}>
                  Add a reply
                </summary>
          <form
            id={`reporter-ticket-comment-form-${ticket.id}`}
            className="mt-4 grid gap-3"
            onSubmit={(event) => submitComment(ticket.id, event)}
          >
            <label htmlFor={`reporter-ticket-comment-${ticket.id}`} className="text-label font-medium text-foreground">
              Reply to the team
            </label>
            <textarea
              id={`reporter-ticket-comment-${ticket.id}`}
              placeholder="Add a detail or ask a question."
              maxLength={3000}
              aria-describedby={commentValidation?.ticketId === ticket.id ? `reporter-ticket-comment-validation-${ticket.id}` : undefined}
              aria-invalid={commentValidation?.ticketId === ticket.id || undefined}
              className="tg-soft-input min-h-24 rounded-xl border border-border bg-surface px-3 py-2 text-body text-foreground shadow-panel outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              value={commentDrafts[ticket.id] ?? ""}
              disabled={ticket.isOverageLocked}
              onChange={(event) => setCommentDrafts((currentDrafts) => ({ ...currentDrafts, [ticket.id]: event.target.value }))}
            />
            {commentRecovery?.ticketId === ticket.id ? (
              <div
                id={`reporter-ticket-comment-recovery-${ticket.id}`}
                className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2"
                role="alert"
                aria-live="assertive"
              >
                <p className="text-label text-danger-700">
                  {commentRecovery.error}
                </p>
                <Button
                  className="mt-2"
                  type="button"
                  tone="secondary"
                  disabled={ticketActionBusy || ticket.isOverageLocked}
                  onClick={() => retryComment(ticket.id)}
                >
                  {submittingCommentId === ticket.id ? "Retrying update..." : "Retry adding update"}
                </Button>
              </div>
            ) : null}
            {commentValidation?.ticketId === ticket.id ? (
              <p
                id={`reporter-ticket-comment-validation-${ticket.id}`}
                className="text-label text-danger-700"
                role="alert"
              >
                {commentValidation.message}
              </p>
            ) : null}
            {commentStatus?.ticketId === ticket.id ? (
              <p
                id={`reporter-ticket-comment-status-${ticket.id}`}
                className="text-label text-success-700"
                role="status"
                aria-live="polite"
              >
                {commentStatus.message}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" className="h-11" disabled={ticketActionBusy || ticket.isOverageLocked}>
                {submittingCommentId === ticket.id ? "Sending..." : "Send reply"}
              </Button>
            </div>
          </form>
          <details id={`reporter-ticket-attachments-${ticket.id}`} className="mt-4 border-t border-border/50 pt-4">
            <summary className="cursor-pointer text-label font-medium text-muted hover:text-foreground">
              Attachments ({ticket.attachments?.length ?? 0}) · Add an image
            </summary>
            {ticket.attachments?.length ? (
              <div className="mt-3 grid gap-2">
                {ticket.attachments.map((attachment) => (
                  <article key={attachment.id} className="rounded-lg bg-surface-muted/45 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-body text-foreground">
                          {attachment.fileName}
                        </p>
                        <p className="mt-1 text-caption text-muted">
                          {formatBytes(attachment.byteSize)} · {new Date(attachment.createdAt).toLocaleString()}
                        </p>
                        {attachment.expiresAt ? (
                          <p className="mt-1 text-caption text-muted">
                            {attachment.downloadStatus === "expired" ? "Expired under the retention policy" : `Available until ${new Date(attachment.expiresAt).toLocaleString()}`}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        tone="secondary"
                        disabled={ticketActionBusy || attachment.downloadStatus === "expired"}
                        onClick={() => void downloadAttachment(ticket.id, attachment)}
                      >
                        <Download aria-hidden="true" className="h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-caption text-muted">
                No attachments yet.
              </p>
            )}
            <form
              id={`reporter-ticket-attachment-form-${ticket.id}`}
              className="mt-3 flex flex-wrap items-center gap-2"
              onSubmit={(event) => uploadAttachment(ticket.id, event)}
            >
              <label htmlFor={`reporter-ticket-attachment-${ticket.id}`} className="sr-only">
                Add image attachment
              </label>
              <input
                id={`reporter-ticket-attachment-${ticket.id}`}
                className="tg-soft-input min-h-10 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-label text-foreground shadow-panel outline-none transition file:mr-3 file:rounded-lg file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-label file:font-medium file:text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                name="file"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                disabled={ticketActionBusy || ticket.isOverageLocked}
              />
              <Button type="submit" tone="secondary" disabled={ticketActionBusy || ticket.isOverageLocked}>
                {uploadingAttachmentId === ticket.id ? "Uploading..." : "Add image"}
              </Button>
            </form>
            {attachmentRecovery?.ticketId === ticket.id ? (
              <div className="mt-3 border-l-2 border-danger-600 pl-3" role="alert">
                <p className="text-caption text-danger-700">
                  {attachmentRecovery.error}
                </p>
                <Button
                  className="mt-2"
                  type="button"
                  tone="secondary"
                  disabled={ticketActionBusy || ticket.isOverageLocked}
                  onClick={() => void uploadAttachment(ticket.id, undefined, attachmentRecovery)}
                >
                  Retry attachment
                </Button>
              </div>
            ) : null}
          </details>

              </details>
            </div>
          </section>
          <section id="reporter-ticket-context" className="mt-5 rounded-2xl border border-border bg-surface px-4 pb-5 sm:px-5">
            <details id={`reporter-original-report-${ticket.id}`} className="pt-5">
              <summary className="cursor-pointer text-label font-medium text-foreground">
                Your original report
              </summary>
              <p className="mt-3 whitespace-pre-wrap break-words text-body text-foreground">
                {ticket.description}
              </p>
              <p className="mt-3 text-caption text-muted">
                {ticket.project.organizationName}{ticket.createdAt ? ` · Reported ${formatTicketTime(ticket.createdAt)}` : ""}
              </p>
            </details>
          <details id={`reporter-ticket-status-history-${ticket.id}`} className="mt-5 border-t border-border/40 pt-4">
            <summary className="cursor-pointer text-label font-medium text-muted hover:text-foreground">
              Status history
            </summary>
            {ticket.statusHistory?.length ? (
              <div className="mt-3 grid gap-2">
                {ticket.statusHistory.map((entry) => (
                  <article key={entry.id} className="rounded-lg bg-surface-muted/45 px-3 py-2">
                    <p className="text-body text-foreground">
                      {statusHistoryText(entry)}
                    </p>
                    <p className="mt-1 text-caption text-muted">
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-caption text-muted">
                No status updates yet.
              </p>
            )}
          </details>

          </section>
          <footer id="reporter-ticket-footer" className="mt-4 flex justify-end">
            <a
              id="reporter-close-view"
              href={bridgeState.status === "ready" ? "/reporter?view=all" : ticketHref(null)}
              className="tg-action-button inline-flex h-10 items-center justify-center rounded-full border border-border-strong bg-surface px-3.5 text-label font-semibold text-foreground transition hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onClick={(event) => {
                if (bridgeState.status === "ready" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                navigateTicket(null);
              }}
            >
              Close view
            </a>
          </footer>
        </article>
      )) : null}
      {!selectedTicketId && ticketPagination?.hasNextPage ? (
        <div id="reporter-ticket-pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-caption text-muted">
            Showing {listedTickets.length} of {ticketPagination.total} tickets
          </p>
          <Button type="button" tone="secondary" disabled={loadingTickets} onClick={() => void loadTickets(token, ticketPagination.page + 1, true)}>
            {loadingTickets ? "Loading..." : "Load more"}
          </Button>
        </div>
      ) : null}
    </main>
  );
}
