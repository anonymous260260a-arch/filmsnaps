/**
 * TrailerModal — glassmorphism modal with YouTube trailer embed.
 *
 * Feature parity with mobile. Uses YouTube iframe with privacy-enhanced mode.
 */

'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface TrailerModalProps {
  /** YouTube video key */
  videoKey: string | null | undefined;
  /** Whether the modal is open */
  open: boolean;
  /** Close handler */
  onClose: () => void;
}

export function TrailerModal({ videoKey, open, onClose }: TrailerModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open || !videoKey) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#070708]/90 backdrop-blur-md p-4"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="relative w-full max-w-4xl aspect-video rounded-2xl overflow-hidden shadow-2xl shadow-black/60">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-10 h-10 rounded-full bg-[#070708]/60 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white/80 hover:text-white hover:bg-[#070708]/80 transition-all"
          aria-label="Close trailer"
        >
          <X size={18} />
        </button>

        {/* YouTube iframe — privacy-enhanced mode (nocookie) */}
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoKey}?autoplay=1&rel=0&modestbranding=1`}
          className="absolute inset-0 w-full h-full"
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
          title="Trailer"
        />
      </div>
    </div>
  );
}
