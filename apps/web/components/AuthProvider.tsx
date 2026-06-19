'use client';

import { createContext, useContext, useState, useCallback } from 'react';

export type AuthUser = {
  uid: string;
  email?: string | null;
  emailVerified?: boolean;
};

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user] = useState<AuthUser | null>(null);
  const [loading] = useState(false);

  const noop = useCallback(async () => {}, []);
  const noopResult = useCallback(async () => ({}), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signUp: noopResult,
        signIn: noopResult,
        signOut: noop,
        resetPassword: noopResult,
        sendMagicLink: noopResult,
        resendVerificationEmail: noopResult,
        emailVerified: null,
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
