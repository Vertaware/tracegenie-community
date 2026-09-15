import { useEffect,useMemo,useRef,useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle,Eye,EyeOff } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link,useNavigate,useSearchParams } from "react-router-dom";
import { z } from "zod";

import type { AdminSession } from "@tracegenie/shared";

import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { api } from "../../lib/api";
import { copy } from "../../lib/copy";
import { AuthShell } from "./AuthShell";

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmation: z.string().min(1, "Confirm your new password."),
  })
  .refine((values) => values.password === values.confirmation, {
    message: "Passwords do not match.",
    path: ["confirmation"],
  });

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

type ResetPasswordPageProps = {
  onReset: (session: AdminSession) => void;
};

export function ResetPasswordPage({ onReset }: ResetPasswordPageProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);
  const tokenIsValid = token.length >= 20;
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkFailure, setLinkFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: "",
      confirmation: "",
    },
  });
  const linkIsUsable = tokenIsValid && !linkFailure;

  useEffect(() => {
    if (linkFailure) {
      document.getElementById("reset-password-link-error")?.focus();
    } else if (error && !submitting) {
      document.getElementById("reset-password-new")?.focus();
    }
  }, [error, linkFailure, submitting]);

  async function submit(values: ResetPasswordFormValues) {
    if (!linkIsUsable || submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const session = await api.confirmPasswordReset(token, values.password);
      onReset(session);
      navigate("/", { replace: true });
    } catch (caught) {
      if (
        caught
        && typeof caught === "object"
        && "code" in caught
        && caught.code === "auth.invalid_password_reset"
      ) {
        setLinkFailure(caught instanceof Error
          ? caught.message
          : "This reset link is invalid or expired. Request a new link to continue.");
        form.reset();
      } else {
        setError(caught instanceof Error ? caught.message : "Could not reset this password.");
      }
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      idPrefix="reset-password"
      title={copy.login.newPasswordTitle}
      description={copy.login.newPasswordBody}
      footer={linkIsUsable ? (
        <p>
          Remembered your password?{" "}
          <Link className="tg-inline-link font-semibold text-foreground" to="/login">
            Sign in
          </Link>
        </p>
      ) : undefined}
    >
      {!linkIsUsable ? (
        <div id="reset-password-invalid-state" className="mt-6 space-y-4">
          <div
            id="reset-password-link-error"
            className="tg-message-banner flex items-start gap-2.5 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2.5 text-label text-danger-700"
            role="alert"
            tabIndex={-1}
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {linkFailure ?? "This reset link is invalid or incomplete. Request a new link to continue."}
            </span>
          </div>
          <Link
            to="/forgot-password"
            data-tg-primary-target="true"
            className="tg-action-button inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-4 text-label font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Request a new reset link
          </Link>
        </div>
      ) : (
        <form
          id="reset-password-form"
          className="mt-6 space-y-4"
          noValidate
          onSubmit={form.handleSubmit(submit)}
        >
          <div id="reset-password-field">
            <label htmlFor="reset-password-new" className="mb-1.5 block text-label font-medium text-foreground">
              New password
            </label>
            <div className="relative">
              <Input
                id="reset-password-new"
                {...form.register("password")}
                className="pr-11"
                type={passwordVisible ? "text" : "password"}
                autoComplete="new-password"
                aria-invalid={form.formState.errors.password ? "true" : undefined}
                aria-describedby={form.formState.errors.password
                  ? "reset-password-requirement reset-password-new-error"
                  : "reset-password-requirement"}
                disabled={submitting}
              />
              <Button
                type="button"
                tone="ghost"
                className="absolute right-0 top-0 w-11 px-0"
                aria-label={passwordVisible ? "Hide new password" : "Show new password"}
                aria-pressed={passwordVisible}
                title={passwordVisible ? "Hide new password" : "Show new password"}
                onClick={() => setPasswordVisible((visible) => !visible)}
                disabled={submitting}
              >
                {passwordVisible ? (
                  <EyeOff aria-hidden="true" size={17} />
                ) : (
                  <Eye aria-hidden="true" size={17} />
                )}
              </Button>
            </div>
            <p id="reset-password-requirement" className="mt-1 text-caption text-muted">
              Use at least 8 characters.
            </p>
            {form.formState.errors.password?.message ? (
              <p id="reset-password-new-error" className="mt-1 text-caption text-danger-700" role="alert">
                {form.formState.errors.password.message}
              </p>
            ) : null}
          </div>

          <div id="reset-password-confirmation-field">
            <label htmlFor="reset-password-confirmation" className="mb-1.5 block text-label font-medium text-foreground">
              Confirm new password
            </label>
            <div className="relative">
              <Input
                id="reset-password-confirmation"
                {...form.register("confirmation")}
                className="pr-11"
                type={confirmationVisible ? "text" : "password"}
                autoComplete="new-password"
                aria-invalid={form.formState.errors.confirmation ? "true" : undefined}
                aria-describedby={form.formState.errors.confirmation ? "reset-password-confirmation-error" : undefined}
                disabled={submitting}
              />
              <Button
                type="button"
                tone="ghost"
                className="absolute right-0 top-0 w-11 px-0"
                aria-label={confirmationVisible ? "Hide confirmed password" : "Show confirmed password"}
                aria-pressed={confirmationVisible}
                title={confirmationVisible ? "Hide confirmed password" : "Show confirmed password"}
                onClick={() => setConfirmationVisible((visible) => !visible)}
                disabled={submitting}
              >
                {confirmationVisible ? (
                  <EyeOff aria-hidden="true" size={17} />
                ) : (
                  <Eye aria-hidden="true" size={17} />
                )}
              </Button>
            </div>
            {form.formState.errors.confirmation?.message ? (
              <p id="reset-password-confirmation-error" className="mt-1 text-caption text-danger-700" role="alert">
                {form.formState.errors.confirmation.message}
              </p>
            ) : null}
          </div>

          {error ? (
            <div
              id="reset-password-error"
              className="tg-message-banner flex items-start gap-2.5 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2.5 text-label text-danger-700"
              role="alert"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <Button type="submit" className="h-11 w-full" disabled={submitting}>
            {submitting ? copy.login.newPasswordSubmitting : copy.login.newPasswordSubmit}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
