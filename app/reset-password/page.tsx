'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Lock, Film, Mail } from 'lucide-react';
import { canSendAuthEmail, markAuthEmailSent } from '@/lib/authCooldown';
import { useAuth } from '@/components/AuthProvider';
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { resetPassword } = useAuth();

  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeValid, setCodeValid] = useState(false);

  const forgotPass = searchParams.get('forgot');
  const oobCode = searchParams.get('oobCode');

  // -----------------------------
  // Verify reset link
  // -----------------------------
  useEffect(() => {
    if (forgotPass || !oobCode) return;

    const verifyCode = async () => {
      try {
        await verifyPasswordResetCode(auth, oobCode);
        setCodeValid(true);
        toast({
          title: 'Ready to reset password',
          description: 'Enter your new password below.',
        });
      } catch {
        toast({
          title: 'Invalid or expired link',
          description: 'Please request a new password reset email.',
          variant: 'destructive',
        });
        router.replace('/reset-password?forgot=true');
      }
    };

    verifyCode();
  }, [forgotPass, oobCode, router, toast]);

  // -----------------------------
  // Send reset email
  // -----------------------------
  const sendEmail = useCallback(async () => {
    if (!email) {
      toast({
        title: 'Email required',
        description: 'Please enter your email address.',
        variant: 'destructive',
      });
      return;
    }

    const key = `reset-password-${email}`;
    if (!canSendAuthEmail(key)) {
      toast({
        title: 'Please wait',
        description: 'You can request another reset in a few minutes.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    const res = await resetPassword(email);
    setLoading(false);

    if (!res.success) {
      toast({
        title: 'Error',
        description: res.message ?? 'Failed to send reset email',
        variant: 'destructive',
      });
      return;
    }

    markAuthEmailSent(key);
    toast({
      title: 'Password reset email sent',
      description: 'Check your inbox for the reset link.',
    });
  }, [email, resetPassword, toast]);

  // -----------------------------
  // Confirm password reset
  // -----------------------------
  const handleReset = useCallback(async () => {
    if (!oobCode || !codeValid) {
      toast({
        title: 'Invalid session',
        description: 'Please use the reset link from your email.',
        variant: 'destructive',
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: 'Weak password',
        description: 'Password must be at least 6 characters.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);
      await confirmPasswordReset(auth, oobCode, password);
      toast({
        title: 'Password updated',
        description: 'You can now sign in with your new password.',
      });
      router.push('/auth');
    } catch (err: any) {
      toast({
        title: 'Reset failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [password, oobCode, codeValid, router, toast]);

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-black">
      {/* Background */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.25),_transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,_rgba(147,51,234,0.25),_transparent_60%)]" />

      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl p-8">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <Film className="h-7 w-7 text-primary" />
          <span className="text-2xl font-bold bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
            FilmSnaps
          </span>
        </div>

        <h1 className="text-xl font-semibold text-center text-white">
          {forgotPass ? 'Reset your password' : 'Choose a new password'}
        </h1>

        <p className="mt-1 text-center text-sm text-muted-foreground">
          {forgotPass
            ? 'Enter your email to receive a reset link'
            : codeValid
            ? 'Enter your new password below'
            : 'Please use the link from your email'}
        </p>

        <div className="mt-6 space-y-4">
          {forgotPass ? (
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-lg bg-background/60 border border-border px-10 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          ) : (
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="password"
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!codeValid}
                className="w-full rounded-lg bg-background/60 border border-border px-10 py-2 text-sm text-white disabled:opacity-50"
              />
            </div>
          )}

          <button
            onClick={forgotPass ? sendEmail : handleReset}
            disabled={loading || (!forgotPass && !codeValid)}
            className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {loading
              ? forgotPass
                ? 'Sending...'
                : 'Updating...'
              : forgotPass
              ? 'Send Reset Link'
              : 'Update Password'}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          {forgotPass
            ? 'You will receive an email with a reset link.'
            : 'After updating, you can sign in with your new password.'}
        </p>
      </div>
    </div>
  );
}
