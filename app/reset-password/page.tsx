'use client';

import { Film } from 'lucide-react';
import Link from 'next/link';

export default function ResetPasswordPage() {
  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-black">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.25),_transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,_rgba(147,51,234,0.25),_transparent_60%)]" />

      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl p-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-6">
          <Film className="h-7 w-7 text-primary" />
          <span className="text-2xl font-bold bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
            FilmSnaps
          </span>
        </div>

        <h1 className="text-xl font-semibold text-white">Password reset</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Auth is currently disabled. Please use the app without signing in.
        </p>

        <Link
          href="/"
          className="mt-6 inline-block w-full rounded-lg bg-primary py-2 text-sm font-medium text-white hover:bg-primary/90"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
