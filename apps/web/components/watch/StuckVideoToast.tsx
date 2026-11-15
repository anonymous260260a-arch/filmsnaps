/**
 * StuckVideoToast — contextual toast for video playback issues.
 *
 * Sits in page flow (not overlaid on the video).
 * Appears when player hasn't loaded after 15s.
 * Auto-hides after 8s or when dismissed.
 */

"use client";

import React, { useState, useEffect, useRef } from "react";
import { AlertCircle, X } from "lucide-react";
import { usePlayer } from "@/components/player/PlayerProvider";

export function StuckVideoToast() {
  const { playerReady, iframeLoadError } = usePlayer();
  const [dismissed, setDismissed] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // If player becomes ready or there's an error, don't show
    if (playerReady || iframeLoadError) {
      setShouldShow(false);
      setDismissed(false);
      return;
    }

    // Start 15s timer to show the toast
    showTimerRef.current = setTimeout(() => {
      if (!dismissed) setShouldShow(true);
    }, 15000);

    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
    };
  }, [playerReady, iframeLoadError, dismissed]);

  // Auto-hide after 8s once shown
  useEffect(() => {
    if (!shouldShow) return;
    hideTimerRef.current = setTimeout(() => setShouldShow(false), 8000);
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [shouldShow]);

  if (!shouldShow) return null;

  const handleDismiss = () => {
    setDismissed(true);
    setShouldShow(false);
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 bg-surface border border-subtle border-l-4 border-l-primary
        rounded-lg shadow-xl max-w-sm transition-all duration-200 mx-auto my-1"
      role="alert"
    >
      <AlertCircle size={16} className="text-primary shrink-0" />
      <p className="text-xs text-muted-foreground flex-1">
        Video not loading?{" "}
        <span className="text-faint">Try switching the server below.</span>
      </p>
      <button
        onClick={handleDismiss}
        className="text-faint hover:text-muted-foreground transition-colors shrink-0 p-0.5"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
