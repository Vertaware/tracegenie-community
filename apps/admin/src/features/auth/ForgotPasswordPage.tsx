import { useEffect,useRef,useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle,CheckCircle2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";

import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { api } from "../../lib/api";
import { copy } from "../../lib/copy";
import { AuthShell } from "./AuthShell";

const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid work email."),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const successRef = useRef<HTMLDivElement>(null);
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });
  const disabled = submitting || sent;

  useEffect(() => {
    if (sent) successRef.current?.focus();
  }, [sent]);

  useEffect(() => {
    if (error && !submitting) {
      document.getElementById("forgot-password-email")?.focus();
    }
  }, [error, submitting]);

  async function submit(values: ForgotPasswordFormValues) {
    if (sent || submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await api.requestPasswordReset(values.email);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the reset link.");
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      idPrefix="forgot-password"
      title={copy.login.resetTitle}
      description={copy.login.resetBody}
      footer={(
        <p>
          Remembered it?{" "}
          <Link className="tg-inline-link font-semibold text-foreground" to="/login">
            Sign in
          </Link>
        </p>
      )}
    >
      <form
        id="forgot-password-form"
        className="mt-6 space-y-4"
        noValidate
        onSubmit={form.handleSubmit(submit)}
      >
        <div id="forgot-password-email-field">
          <label htmlFor="forgot-password-email" className="mb-1.5 block text-label font-medium text-foreground">
            {copy.login.email}
          </label>
          <Input
            id="forgot-password-email"
            {...form.register("email")}
            placeholder="name@company.com"
            autoComplete="email"
            inputMode="email"
            aria-invalid={form.formState.errors.email ? "true" : undefined}
            aria-describedby={form.formState.errors.email ? "forgot-password-email-error" : undefined}
            disabled={disabled}
          />
          {form.formState.errors.email?.message ? (
            <p id="forgot-password-email-error" className="mt-1 text-caption text-danger-700" role="alert">
              {form.formState.errors.email.message}
            </p>
          ) : null}
        </div>

        {sent ? (
          <div
            id="forgot-password-success"
            ref={successRef}
            className="tg-message-banner flex items-start gap-2.5 rounded-lg border border-success/20 bg-success-50 px-3 py-2.5 text-label text-success-700 outline-none focus-visible:ring-2 focus-visible:ring-primary"
            role="status"
            aria-live="polite"
            tabIndex={-1}
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{copy.login.resetSent}</span>
          </div>
        ) : null}

        {error ? (
          <div
            id="forgot-password-error"
            className="tg-message-banner flex items-start gap-2.5 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2.5 text-label text-danger-700"
            role="alert"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <Button type="submit" className="h-11 w-full" disabled={disabled}>
          {sent ? "Reset link sent" : submitting ? copy.login.resetSubmitting : copy.login.resetSubmit}
        </Button>
      </form>
    </AuthShell>
  );
}
