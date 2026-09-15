import { zodResolver } from "@hookform/resolvers/zod";
import { Eye,EyeOff } from "lucide-react";
import { useEffect,useRef,useState,type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";

import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { copy } from "../../lib/copy";
import { AuthShell } from "./AuthShell";

const loginSchema = z.object({
  email: z.string().email("Enter a valid work email."),
  password: z.string().min(1, "Enter your password."),
});

type LoginFormValues = z.infer<typeof loginSchema>;

type LoginPageProps = {
  onLogin: (values: LoginFormValues) => Promise<void>;
  feedback?: ReactNode;
  loading: boolean;
  sessionNotice?: string | null;
};

export function LoginPage({ onLogin, feedback, loading, sessionNotice }: LoginPageProps) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });
  const disabled = loading || submitting;

  useEffect(() => {
    if (feedback && !disabled) {
      document.getElementById("login-email")?.focus();
    }
  }, [disabled, feedback]);

  async function submit(values: LoginFormValues) {
    if (loading || submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      await onLogin(values);
    } catch {
      // The parent mutation renders recovery feedback; retain the credentials for retry.
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      idPrefix="admin-login"
      title={copy.login.title}
      description={copy.login.description}
      variant="simple"
      
    >
      <div id="login-content">
        {sessionNotice ? (
          <p
            id="login-session-recovery"
            className="mt-4 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-label text-warning-700"
            role="status"
          >
            {sessionNotice}
          </p>
        ) : null}

        {feedback ? (
          <div id="login-mutation-feedback" className="mt-4">
            {feedback}
          </div>
        ) : null}

        <form
          id="login-form"
          className="mt-6 space-y-4"
          noValidate
          onSubmit={form.handleSubmit(submit)}
        >
          <div id="login-email-field">
            <label htmlFor="login-email" className="mb-1.5 block text-label font-medium text-foreground">
              {copy.login.email}
            </label>
            <Input
              id="login-email"
              {...form.register("email")}
              placeholder="name@company.com"
              autoFocus
              autoComplete="email"
              inputMode="email"
              aria-invalid={form.formState.errors.email ? "true" : undefined}
              aria-describedby={form.formState.errors.email ? "login-email-error" : undefined}
              disabled={disabled}
            />
            {form.formState.errors.email?.message ? (
              <p id="login-email-error" className="mt-1 text-caption text-danger-700" role="alert">
                {form.formState.errors.email.message}
              </p>
            ) : null}
          </div>

          <div id="login-password-field">
            <div className="mb-1.5 flex items-center justify-between gap-4">
              <label htmlFor="login-password" className="text-label font-medium text-foreground">
                {copy.login.password}
              </label>
              <Link className="tg-inline-link text-caption font-semibold text-foreground" to="/forgot-password">
                {copy.login.forgotPassword}
              </Link>
            </div>
            <div className="relative">
              <Input
                id="login-password"
                {...form.register("password")}
                className="pr-11"
                type={passwordVisible ? "text" : "password"}
                autoComplete="current-password"
                aria-invalid={form.formState.errors.password ? "true" : undefined}
                aria-describedby={form.formState.errors.password ? "login-password-error" : undefined}
                disabled={disabled}
              />
              <Button
                type="button"
                tone="ghost"
                className="absolute right-0 top-0 w-11 px-0"
                aria-label={passwordVisible ? "Hide password" : "Show password"}
                aria-pressed={passwordVisible}
                title={passwordVisible ? "Hide password" : "Show password"}
                onClick={() => setPasswordVisible((visible) => !visible)}
                disabled={disabled}
              >
                {passwordVisible ? (
                  <EyeOff aria-hidden="true" size={17} />
                ) : (
                  <Eye aria-hidden="true" size={17} />
                )}
              </Button>
            </div>
            {form.formState.errors.password?.message ? (
              <p id="login-password-error" className="mt-1 text-caption text-danger-700" role="alert">
                {form.formState.errors.password.message}
              </p>
            ) : null}
          </div>

          <Button type="submit" className="h-11 w-full" disabled={disabled}>
            {disabled ? copy.login.submitting : copy.login.submit}
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}
