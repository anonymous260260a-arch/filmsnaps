'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Film, Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { GlassButton } from '@/components/ui/glass-button';
import { Header } from '@/components/Header';

export default function AuthPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { signIn, signUp, sendMagicLink } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) {
      toast({
        title: 'Authentication error',
        description:
          error === 'invalid-request'
            ? 'Invalid authentication request. Please try again.'
            : 'An error occurred during authentication.',
        variant: 'destructive',
      });
    }
  }, [searchParams, router, toast]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);

      try {
        if (magicLinkSent) {
          return;
        }

        if (isLogin) {
          const { error, data } = await signIn(email, password);

          if (error) throw error;

          if (data?.user && !data.user.email_confirmed_at) {
            toast({
              title: 'Verify your email',
              description: 'Please check your inbox.',
            });
          } else {
            toast({
              title: 'Welcome back',
              description: 'Logged in successfully',
            });
            router.push('/');
          }
        } else {
          const { error, data } = await signUp(email, password);

          if (error) throw error;

          toast({
            title: 'Account created',
            description: 'Check your email to verify your account',
          });
        }
      } catch (err: any) {
        toast({
          title: 'Authentication failed',
          description: err.message,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    },
    [email, password, isLogin, magicLinkSent, signIn, signUp, router, toast]
  );

  const handleMagicLink = useCallback(async () => {
    if (!email) return;
    setLoading(true);

    try {
      const result = await sendMagicLink(email);
      if (!result.success) {
        throw new Error(result.message || 'Failed to send magic link');
      }

      toast({
        title: 'Magic link sent',
        description: 'Check your email to sign in without a password.',
      });
      setMagicLinkSent(true);
    } catch (err: any) {
      toast({
        title: 'Failed to send magic link',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [email, sendMagicLink, toast]);

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background overflow-hidden px-4">
      <Header />

      {/* Warm ambient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.08] via-transparent to-amber-accent/[0.04] pointer-events-none" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative w-full max-w-md rounded-2xl border border-white/[0.06] glass-light p-8 shadow-2xl">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10">
            <Film className="h-5 w-5 text-primary" />
          </div>
          <span className="text-2xl font-bold bg-gradient-to-r from-primary via-purple-400 to-amber-300/80 bg-clip-text text-transparent">
            FilmSnaps
          </span>
        </div>

        {/* Title */}
        <h1 className="text-xl font-bold text-center text-foreground">
          {isLogin ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="mt-1.5 text-center text-sm text-muted-foreground">
          {isLogin
            ? 'Sign in with your email and password'
            : 'Enter your details to get started'}
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          {/* Email */}
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="email"
              placeholder="name@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl bg-background/60 border border-border/50 px-11 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/20 transition-all"
            />
          </div>

          {/* Password */}
          {!magicLinkSent && (
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={isLogin}
                className="w-full rounded-xl bg-background/60 border border-border/50 px-11 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/20 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          )}

          {/* Forgot password / Magic link */}
          <div className="flex justify-between text-xs mt-2">
            {isLogin && !magicLinkSent && (
              <button
                type="button"
                onClick={() => router.push('/reset-password?forgot=true')}
                className="text-primary/70 hover:text-primary transition-colors"
              >
                Forgot password?
              </button>
            )}

            {isLogin && !magicLinkSent && (
              <button
                type="button"
                onClick={handleMagicLink}
                className="text-primary/70 hover:text-primary transition-colors ml-auto"
              >
                Send magic link
              </button>
            )}
          </div>

          <GlassButton
            className="w-full mt-4 font-bold"
            type="submit"
            disabled={loading}
          >
            {loading
              ? 'Please wait…'
              : magicLinkSent
              ? 'Check your email'
              : isLogin
              ? 'Sign In'
              : 'Sign Up'}
          </GlassButton>
        </form>

        {/* Switch mode */}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-primary hover:text-primary/80 font-medium transition-colors"
          >
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
