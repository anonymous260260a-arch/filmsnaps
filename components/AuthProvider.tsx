'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { auth } from '@/lib/firebase/client';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendEmailVerification,
  User as FirebaseUser,
} from 'firebase/auth';
import { DecodedIdToken } from 'firebase-admin/auth';

// Minimal type that works for server or client
export type AuthUser = {
  uid: string;
  email?: string | null;
  emailVerified?: boolean;
} & Partial<FirebaseUser>;

type AuthContextType = {
  user: AuthUser | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<any>;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<any>;
  sendMagicLink: (email: string) => Promise<any>;
  resendVerificationEmail: () => Promise<any>;
  emailVerified: boolean | null;
};

const AuthContext = createContext<AuthContextType | null>(null);

// Helper to map serverUser to minimal AuthUser
function mapServerUser(serverUser?: DecodedIdToken | null): AuthUser | null {
  if (!serverUser) return null;
  return {
    uid: serverUser.uid,
    email: serverUser.email ?? null,
    emailVerified: serverUser.email_verified ?? false,
  };
}

export function AuthProvider({
  children,
  serverUser,
}: {
  children: React.ReactNode;
  serverUser?: DecodedIdToken | null;
}) {
  const [user, setUser] = useState<AuthUser | null>(mapServerUser(serverUser));
  const [loading, setLoading] = useState(!serverUser);

  // ----------------- Sign Up -----------------
  const signUp = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const res = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(res.user);
      setUser({
        uid: res.user.uid,
        email: res.user.email,
        emailVerified: res.user.emailVerified,
      });
      return { success: true, user: res.user };
    } catch (error: any) {
      return { success: false, message: error.message };
    } finally {
      setLoading(false);
    }
  }, []);

  // ----------------- Sign In -----------------
  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const res = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await res.user.getIdToken();

      await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      setUser({
        uid: res.user.uid,
        email: res.user.email,
        emailVerified: res.user.emailVerified,
      });
      return { success: true, user: res.user };
    } catch (error: any) {
      return { success: false, message: error.message };
    } finally {
      setLoading(false);
    }
  }, []);

  // ----------------- Sign Out -----------------
  const signOut = useCallback(async () => {
    setLoading(true);
    await firebaseSignOut(auth);
    await fetch('/api/logout', { method: 'POST' });
    setUser(null);
    setLoading(false);
  }, []);

  // ----------------- Reset Password -----------------
  const resetPassword = useCallback(async (email: string) => {
    if (!email) return { success: false, message: 'Email is required' };
    try {
      await sendPasswordResetEmail(auth, email, {
        url: `${window.location.origin}/auth/callback?type=recovery`,
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }, []);

  // ----------------- Magic Link -----------------
  const sendMagicLink = useCallback(async (email: string) => {
    if (!email) return { success: false, message: 'Email is required' };
    try {
      await sendSignInLinkToEmail(auth, email, {
        url: `${window.location.origin}/auth/callback`,
        handleCodeInApp: true,
      });
      window.localStorage.setItem('emailForSignIn', email);
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }, []);

  // ----------------- Resend Verification -----------------
  const resendVerificationEmail = useCallback(async () => {
    if (!user?.email) return { success: false, message: 'No user signed in' };
    try {
      // Only works for FirebaseUser; safe guard
      if ('emailVerified' in user)
        await sendEmailVerification(auth.currentUser!);
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }, [user]);

  // ----------------- Hydrate client user -----------------
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser)
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          emailVerified: firebaseUser.emailVerified,
        });
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signUp,
        signIn,
        signOut,
        resetPassword,
        sendMagicLink,
        resendVerificationEmail,
        emailVerified: user?.emailVerified ?? null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
