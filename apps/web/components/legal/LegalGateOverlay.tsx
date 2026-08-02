/**
 * LegalGateOverlay — full-screen Legal & DMCA acceptance screen.
 *
 * Ported from the mobile app's first-launch LegalGate
 * (apps/mobile/components/LegalGate.tsx). Renders as a fixed, opaque,
 * non-dismissable overlay above everything (z-[100], portaled to body) so it
 * covers the desktop shell, the title bar, and even immersive fullscreen.
 *
 * Flow: accordion of legal sections → "I Understand" (accept) | "Decline"
 * (confirmation alert → dead-end screen with "Review Terms Again").
 */

"use client";

import React, { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { LEGAL_GATE_SECTIONS } from "./legal-sections";

interface LegalGateOverlayProps {
  open: boolean;
  /** Called when the user accepts the terms (persistence handled by caller). */
  onAccept: () => void;
  /** Optional — called from the dead-end screen (e.g. quit the desktop app). */
  onExit?: () => void;
}

export function LegalGateOverlay({
  open,
  onAccept,
  onExit,
}: LegalGateOverlayProps) {
  const [showDecline, setShowDecline] = useState(false);

  // Reset the decline dead-end whenever the gate is reopened.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setShowDecline(false);
  }

  const handleDecline = useCallback(() => {
    setShowDecline(true);
  }, []);

  const handleReviewTerms = useCallback(() => {
    setShowDecline(false);
  }, []);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#070708]">
      {/* ── Decline dead-end screen ── */}
      {showDecline ? (
        <div className="flex min-h-full flex-col items-center justify-center px-8 py-16">
          <img
            src="/icon.png"
            alt="FilmSnaps logo"
            className="mb-6 h-[72px] w-[72px] rounded-[18px]"
          />
          <h1
            className="mb-3 text-center text-[22px] font-bold text-[#F4F4F5]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            You&apos;ve declined the terms of use
          </h1>
          <p className="mb-8 max-w-sm text-center text-sm leading-6 text-zinc-400">
            You can stop using FilmSnaps, or review the terms again below.
          </p>
          <button
            onClick={handleReviewTerms}
            className="w-full max-w-sm rounded-xl bg-[#D4A237] py-3.5 text-sm font-bold text-[#070708] transition-colors hover:bg-[#B88B2A]"
          >
            Review Terms Again
          </button>
          {onExit && (
            <button
              onClick={onExit}
              className="mt-3 w-full max-w-sm rounded-xl bg-zinc-800 py-3 text-sm text-zinc-500 transition-colors hover:bg-zinc-800/60"
            >
              Exit App
            </button>
          )}
        </div>
      ) : (
        <>
          {/* ── Scrollable content ── */}
          <div className="mx-auto w-full max-w-xl px-6 pb-52">
            {/* Centered brand area */}
            <div className="flex flex-col items-center pb-6 pt-8">
              <img
                src="/icon.png"
                alt="FilmSnaps logo"
                className="mb-4 h-14 w-14 rounded-[14px]"
              />
              <p
                className="text-center text-[18px] font-bold leading-[26px] text-[#D4A237]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Your personal cinema, anywhere.
              </p>
            </div>

            {/* Gold accent divider */}
            <div className="mx-auto mb-6 h-0.5 w-12 bg-[#D4A237]" />

            {/* Accordion sections */}
            <Accordion type="single" collapsible className="w-full">
              {LEGAL_GATE_SECTIONS.map((section) => (
                <AccordionItem
                  key={section.key}
                  value={section.key}
                  className="mb-2 overflow-hidden rounded-xl border border-zinc-800 bg-[#121218] px-4"
                >
                  <AccordionTrigger className="text-sm font-semibold text-[#D4A237]">
                    {section.title}
                  </AccordionTrigger>
                  <AccordionContent className="pb-3 text-zinc-300">
                    {section.body}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>

            {/* Summary line */}
            <p className="mt-6 text-center text-xs leading-[18px] text-zinc-400">
              By continuing, you acknowledge and accept the above terms.
            </p>
          </div>

          {/* ── Fixed bottom: Accept + Decline ── */}
          <div className="fixed inset-x-0 bottom-0 border-t border-white/[0.04] bg-[#070708]/95 px-5 py-4 backdrop-blur">
            <div className="mx-auto w-full max-w-xl">
              <button
                onClick={onAccept}
                className="w-full rounded-xl bg-[#D4A237] py-3.5 text-sm font-bold text-[#070708] transition-all hover:bg-[#B88B2A] active:scale-[0.99]"
              >
                I Understand
              </button>
              <button
                onClick={handleDecline}
                className="w-full py-3 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Decline
              </button>
            </div>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
