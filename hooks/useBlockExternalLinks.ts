'use client';

import { useEffect } from 'react';

export function useBlockExternalLinks() {
  useEffect(() => {
    const allowedOrigins = [
      window.location.origin,
      'https://app.yourdomain.com',
    ];

    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest('a') as HTMLAnchorElement | null;

      if (!anchor || !anchor.href) return;
      if (anchor.target) return;

      const url = new URL(anchor.href);

      if (!allowedOrigins.includes(url.origin)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);
}
