"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { useEffect, useRef, useState } from "react";
import { createWebPersister, isPersistableQuery } from "@/lib/queryPersister";

export function Providers({ children }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // 5 minutes — safety net, overridden per-query (matches mobile)
            gcTime: Infinity, // never GC mid-session; disk bounded by maxAge
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            retry: 2,
            retryDelay: 1000,
            structuralSharing: true,
          },
          mutations: {
            retry: 1,
          },
        },
      }),
  );

  const [cacheRestored, setCacheRestored] = useState(false);
  const persistedRef = useRef(false);

  // Hydrate the React Query cache from localStorage on cold launch — only
  // then render the app tree. Mirrors the mobile app's hydration gate: it
  // prevents the mount-time fetch race where query hooks fire on mount and
  // fetch from network BEFORE the persisted cache is read from disk.
  useEffect(() => {
    if (persistedRef.current) return;
    persistedRef.current = true;

    const [, persistPromise] = persistQueryClient({
      queryClient,
      persister: createWebPersister(),
      maxAge: 24 * 60 * 60 * 1000, // 24h disk backstop
      dehydrateOptions: {
        shouldDehydrateQuery: (q) => isPersistableQuery(q.queryKey),
      },
    });
    persistPromise.finally(() => setCacheRestored(true));
  }, [queryClient]);

  // Gate: wait for the cache to hydrate before mounting any query consumers,
  // so persisted data is available on first render (no network flash on cold
  // launch). The localStorage read is synchronous single-digit ms.
  if (!cacheRestored) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D4A237] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
