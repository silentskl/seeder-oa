"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { ArrowRight, CircleNotch, LockKey } from "@phosphor-icons/react";

import { BrandLogo } from "@/components/app/brand-logo";
import { authClient } from "@/lib/auth-client";

type PasswordResetPanelProps = {
  mode: "request" | "reset";
  systemName: string;
  logoDarkUrl: string | null;
  logoLightUrl: string | null;
  token?: string | null;
  invalidToken?: boolean;
};

export function PasswordResetPanel({
  mode,
  systemName,
  logoDarkUrl,
  logoLightUrl,
  token = null,
  invalidToken = false,
}: PasswordResetPanelProps) {
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Keep a valid reset token out of browser history/referrers once the page has
  // captured it from the server-rendered search params. The component never
  // re-derives the token from the URL, so stripping it cannot invalidate the form.
  useEffect(() => {
    if (mode === "reset" && token && typeof window !== "undefined") {
      window.history.replaceState({}, "", "/reset-password");
    }
  }, [mode, token]);

  const requestReset = async () => {
    setErrorMessage(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setErrorMessage("Enter your email address.");
      return;
    }

    const result = await authClient.requestPasswordReset({
      email: normalizedEmail,
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (result.error) {
      setErrorMessage(
        result.error.message ?? "Unable to process the reset request. Please try again.",
      );
      return;
    }

    setRequestSent(true);
  };

  const resetPassword = async () => {
    setErrorMessage(null);
    if (!token || invalidToken) {
      setErrorMessage("This reset link is invalid or has expired.");
      return;
    }
    if (newPassword.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }
    if (newPassword.length > 128) {
      setErrorMessage("Password must be 128 characters or fewer.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage("The passwords do not match.");
      return;
    }

    const result = await authClient.resetPassword({
      newPassword,
      token,
    });

    if (result.error) {
      setErrorMessage(
        result.error.message ?? "Unable to reset the password. Request a new reset link.",
      );
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setResetComplete(true);
  };

  const title = mode === "request" ? "Reset your password" : "Choose a new password";
  const subtitle =
    mode === "request"
      ? "Enter the email address used for your OA account."
      : "Set a new password for your OA account.";

  const unavailable = mode === "reset" && (!token || invalidToken);

  return (
    <section className="surface-shadow w-full max-w-[880px] overflow-hidden rounded-md border border-border bg-surface">
      <div className="grid min-h-112 grid-cols-1 md:grid-cols-[0.9fr_1.1fr]">
        <div className="flex flex-col justify-center border-b border-border bg-background p-8 md:border-b-0 md:border-r md:p-10">
          <BrandLogo
            systemName={systemName}
            darkUrl={logoDarkUrl}
            lightUrl={logoLightUrl}
            imgClassName="h-9"
          />
          <div className="mt-8 max-w-sm space-y-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-muted">
              Account recovery
            </p>
            <h1 className="text-3xl font-medium tracking-[-0.022em] text-foreground">
              {title}
            </h1>
            <p className="text-sm leading-7 text-muted">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center justify-center bg-surface p-6 sm:p-10">
          <div className="w-full max-w-md rounded-md border border-border bg-surface-strong p-6 sm:p-8">
            {mode === "request" && requestSent ? (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-medium text-foreground">Check your email</h2>
                  <p className="mt-2 text-[13px] leading-6 text-muted">
                    If an account exists for that email address, a password reset link has been sent.
                    The link expires after 30 minutes.
                  </p>
                </div>
                <div className="space-y-2">
                  <Link href="/sign-in" className="ui-button-primary w-full">
                    Back to sign in
                  </Link>
                  <button
                    type="button"
                    className="ui-button-secondary w-full"
                    onClick={() => {
                      setRequestSent(false);
                      setErrorMessage(null);
                    }}
                  >
                    Send another link
                  </button>
                </div>
              </div>
            ) : mode === "reset" && resetComplete ? (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-medium text-foreground">Password updated</h2>
                  <p className="mt-2 text-[13px] leading-6 text-muted">
                    Your password has been reset. For security, previous signed-in sessions have been revoked.
                  </p>
                </div>
                <Link href="/sign-in" className="ui-button-primary w-full">
                  Sign in with new password
                </Link>
              </div>
            ) : unavailable ? (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-medium text-foreground">Reset link unavailable</h2>
                  <p className="mt-2 text-[13px] leading-6 text-muted">
                    This password reset link is invalid, missing, or has expired. Request a new link to continue.
                  </p>
                </div>
                <Link href="/forgot-password" className="ui-button-primary w-full">
                  Request a new reset link
                </Link>
                <Link href="/sign-in" className="ui-button-secondary w-full">
                  Back to sign in
                </Link>
              </div>
            ) : (
              <form
                className="space-y-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (isPending) return;
                  startTransition(mode === "request" ? requestReset : resetPassword);
                }}
              >
                {mode === "request" ? (
                  <label className="flex flex-col gap-2">
                    <span className="text-[13px] font-medium text-foreground">Email</span>
                    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2.5">
                      <ArrowRight className="size-4 -rotate-45 text-muted" />
                      <input
                        required
                        type="email"
                        name="email"
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted"
                        placeholder="user@company.com"
                      />
                    </div>
                  </label>
                ) : (
                  <div className="space-y-3">
                    <label className="flex flex-col gap-2">
                      <span className="text-[13px] font-medium text-foreground">New password</span>
                      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2.5">
                        <LockKey className="size-4 text-muted" />
                        <input
                          required
                          type="password"
                          name="newPassword"
                          autoComplete="new-password"
                          minLength={8}
                          maxLength={128}
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted"
                          placeholder="Minimum 8 characters"
                        />
                      </div>
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-[13px] font-medium text-foreground">Confirm password</span>
                      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2.5">
                        <LockKey className="size-4 text-muted" />
                        <input
                          required
                          type="password"
                          name="confirmPassword"
                          autoComplete="new-password"
                          minLength={8}
                          maxLength={128}
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted"
                          placeholder="Repeat new password"
                        />
                      </div>
                    </label>
                  </div>
                )}

                {errorMessage ? (
                  <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-[13px] text-danger">
                    {errorMessage}
                  </div>
                ) : null}

                <div className="space-y-2">
                  <button
                    type="submit"
                    disabled={isPending}
                    className="ui-button-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isPending ? <CircleNotch className="size-4 animate-spin" /> : null}
                    {mode === "request" ? "Send reset link" : "Reset password"}
                  </button>
                  <Link href="/sign-in" className="ui-button-secondary w-full">
                    Back to sign in
                  </Link>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
