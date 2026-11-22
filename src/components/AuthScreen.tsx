import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  LogOut,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  cancelExternalGoogleLogin,
  reloadAndCheckVerified,
  resendVerificationEmail,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signOutUser,
  signUpWithEmail,
} from '../services/authService';
import { isTauriDesktop } from '../utils/tauriBridge';

interface AuthScreenProps {
  pendingUser: User | null;
  onVerifiedSuccess: () => void;
}

export function AuthScreen({ pendingUser, onVerifiedSuccess }: AuthScreenProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [externalBrowserPending, setExternalBrowserPending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (externalBrowserPending) {
        void cancelExternalGoogleLogin();
      }
    };
  }, [externalBrowserPending]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    if (mode === 'signup') {
      if (!fullName.trim()) {
        setErrorMsg('Enter your full name.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('Passwords do not match.');
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === 'signin') {
        const u = await signInWithEmail(email, password);
        if (u.emailVerified) {
          onVerifiedSuccess();
        }
      } else {
        const { sentVerification } = await signUpWithEmail(
          fullName,
          email,
          password,
        );
        setInfoMsg(
          sentVerification
            ? 'Account created. Please check your inbox and verify your email address.'
            : 'Account created. Request a verification link below before entering.',
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    const desktop = isTauriDesktop();
    if (desktop) {
      setExternalBrowserPending(true);
    }
    try {
      const u = await signInWithGoogle();
      if (u.emailVerified) {
        onVerifiedSuccess();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setExternalBrowserPending(false);
      setBusy(false);
    }
  };

  const handleCancelExternalGoogle = async () => {
    await cancelExternalGoogleLogin();
    setExternalBrowserPending(false);
    setBusy(false);
  };

  const handleForgotPassword = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    if (!email.trim()) {
      setErrorMsg('Enter your email address above to receive a reset link.');
      return;
    }
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setInfoMsg(`Password reset link sent to ${email.trim()}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCheckVerified = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const verified = await reloadAndCheckVerified();
      if (verified) {
        onVerifiedSuccess();
      } else {
        setErrorMsg(
          'Email address is not verified yet. Open the link sent to your inbox, then try again.',
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      await resendVerificationEmail();
      setInfoMsg(
        `Verification link resent to ${pendingUser?.email ?? 'your email'}.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col items-center px-4 py-6 sm:p-6 overflow-y-auto cadence-scroll">
      <div className="w-full max-w-md space-y-5 my-auto">
        <div className="flex items-center gap-3">
          <img
            src="/cadence-icon.png"
            alt="Cadence logo"
            className="w-11 h-11 rounded-xl border border-slate-200 bg-white object-cover"
          />
          <div>
            <h1 className="text-xl font-bold text-slate-900 leading-tight">
              Cadence
            </h1>
            <p className="text-xs text-slate-500">
              Verified shift reporting &amp; fairness scheduling
            </p>
          </div>
        </div>

        {pendingUser && !pendingUser.emailVerified ? (
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center shrink-0">
                <MailCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900">
                  Verify your email to continue
                </h2>
                <p className="text-xs text-slate-600 mt-1 break-words">
                  Signed in as{' '}
                  <span className="font-semibold text-slate-900">
                    {pendingUser.email ?? 'your account'}
                  </span>
                  . Cadence requires a verified email before syncing team
                  schedules and shift reports.
                </p>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {errorMsg}
              </div>
            )}
            {infoMsg && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
                {infoMsg}
              </div>
            )}

            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={handleCheckVerified}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>I&apos;ve Verified My Email</span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={handleResendVerification}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-800 text-sm font-semibold transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Resend Verification Email</span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => signOutUser()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 text-xs font-semibold transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Use another account</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-5">
            <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setErrorMsg(null);
                  setInfoMsg(null);
                }}
                className={`py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  mode === 'signin'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setErrorMsg(null);
                  setInfoMsg(null);
                }}
                className={`py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  mode === 'signup'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Create Account
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {errorMsg}
              </div>
            )}
            {infoMsg && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
                {infoMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {mode === 'signup' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jordan Taylor"
                    maxLength={80}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  required
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Password
                  </label>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    required
                    className="w-full px-3 py-2 pr-10 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {mode === 'signup' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Confirm Password
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    required
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-600"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                {busy
                  ? 'Please wait...'
                  : mode === 'signin'
                    ? 'Sign In'
                    : 'Create Verified Account'}
              </button>
            </form>

            <div className="relative flex items-center justify-center">
              <div className="border-t border-slate-200 w-full" />
              <span className="bg-white px-2.5 text-[11px] font-medium text-slate-400 uppercase tracking-wider shrink-0">
                or continue with
              </span>
              <div className="border-t border-slate-200 w-full" />
            </div>

            {externalBrowserPending ? (
              <div className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <ExternalLink className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900">
                      Browser Sign-In Opened
                    </div>
                    <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                      Finish signing in with Google in your browser, then click{' '}
                      <span className="font-semibold">Open Cadence</span> if
                      prompted to return.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCancelExternalGoogle}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancel Browser Sign-In</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={handleGoogleSignIn}
                className="w-full inline-flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 text-sm font-semibold transition-colors cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                <span>
                  {isTauriDesktop()
                    ? 'Google Account (External Browser)'
                    : 'Google Account'}
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
