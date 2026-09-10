/**
 * SettingsPanel — dropdown panel for quality, audio, subtitles, and playback speed.
 *
 * Triggered from the ControlBar settings button.
 */

"use client";

import React, { useState } from "react";
import { Check } from "lucide-react";
import type {
  QualityOption,
  AudioTrack,
  SubtitleTrack,
} from "./player-adapters";

interface SettingsPanelProps {
  qualities?: QualityOption[];
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
  currentRate: number;
  playbackRates: number[];
  onQualityChange?: (quality: QualityOption) => void;
  onAudioTrackChange?: (trackId: string) => void;
  onSubtitleChange?: (trackId: string | null) => void;
  onRateChange?: (rate: number) => void;
  onClose: () => void;
}

type Tab = "quality" | "audio" | "subtitles" | "speed";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function SettingsPanel({
  qualities,
  audioTracks,
  subtitleTracks,
  currentRate,
  playbackRates,
  onQualityChange,
  onAudioTrackChange,
  onSubtitleChange,
  onRateChange,
  onClose,
}: SettingsPanelProps) {
  const hasQuality = Boolean(qualities && qualities.length > 0);
  const hasAudio = Boolean(audioTracks && audioTracks.length > 1);
  const hasSubtitles = Boolean(subtitleTracks && subtitleTracks.length > 0);

  const tabs: { id: Tab; label: string; available: boolean }[] = [
    { id: "quality", label: "Quality", available: hasQuality },
    { id: "audio", label: "Audio", available: hasAudio },
    { id: "subtitles", label: "Subtitles", available: hasSubtitles },
    { id: "speed", label: "Speed", available: true },
  ];

  const availableTabs = tabs.filter((t) => t.available);
  const [activeTab, setActiveTab] = useState<Tab>(
    availableTabs[0]?.id ?? "speed",
  );

  const activeSubtitleId = subtitleTracks?.find((t) => t.active)?.id ?? null;

  return (
    <div className="absolute bottom-full right-0 mb-2 w-[280px] max-h-[420px] bg-[#1C1C1E] border border-white/[0.08] rounded-lg shadow-xl overflow-hidden z-50">
      <div className="flex border-b border-white/[0.08]">
        {availableTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-[#D4A237]/20 text-[#D4A237] border-b-2 border-[#D4A237]"
                : "text-white/60 hover:text-white hover:bg-white/[0.05]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-2 overflow-y-auto max-h-[320px]">
        {activeTab === "quality" && hasQuality && (
          <div className="space-y-1.5">
            {qualities!.map((q, i) => {
              const isDownloadOnly = q._meta?.isDownloadOnly ?? false;
              const isWebReady = q._meta?.isWebReady ?? false;
              const codec = q._meta?.codec;
              const sizeBytes = q._meta?.sizeBytes;

              return (
                <button
                  key={q.id || i}
                  onClick={() => {
                    if (isDownloadOnly) return;
                    onQualityChange?.(q);
                    onClose();
                  }}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    isDownloadOnly
                      ? "text-white/30 cursor-not-allowed opacity-60"
                      : "text-white hover:bg-white/[0.05] hover:text-white focus:outline-none focus:ring-1 focus:ring-[#D4A237]"
                  }`}
                  disabled={isDownloadOnly}
                  title={
                    isDownloadOnly
                      ? "Download only — not streamable"
                      : undefined
                  }
                >
                  <div className="flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className="font-medium">{q.quality}</span>
                      <div className="flex gap-2 mt-0.5 text-xs text-white/50">
                        {codec && <span>{codec.toUpperCase()}</span>}
                        {sizeBytes && <span>{formatBytes(sizeBytes)}</span>}
                        {isWebReady && (
                          <span className="text-[#D4A237]">✓ Web-ready</span>
                        )}
                      </div>
                    </div>
                    {isDownloadOnly && (
                      <span className="text-xs text-white/40">↓</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {activeTab === "audio" && hasAudio && (
          <div className="space-y-1.5">
            {audioTracks!.map((track) => (
              <button
                key={track.id}
                onClick={() => {
                  onAudioTrackChange?.(track.id);
                  onClose();
                }}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  track.active
                    ? "bg-[#D4A237]/20 text-[#D4A237]"
                    : "text-white/70 hover:text-white hover:bg-white/[0.05]"
                }`}
              >
                <div className="flex justify-between items-center">
                  <div className="flex flex-col">
                    <span>{track.label}</span>
                    <div className="flex gap-2 mt-0.5 text-xs text-white/40">
                      {track.language && <span>{track.language}</span>}
                      {track.codec && <span>{track.codec.toUpperCase()}</span>}
                    </div>
                  </div>
                  {track.active && <Check size={14} />}
                </div>
              </button>
            ))}
          </div>
        )}

        {activeTab === "subtitles" && hasSubtitles && (
          <div className="space-y-1.5">
            <button
              onClick={() => {
                onSubtitleChange?.(null);
                onClose();
              }}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                activeSubtitleId === null
                  ? "bg-[#D4A237]/20 text-[#D4A237]"
                  : "text-white/70 hover:text-white hover:bg-white/[0.05]"
              }`}
            >
              Off
            </button>
            {subtitleTracks!.map((track) => (
              <button
                key={track.id}
                onClick={() => {
                  onSubtitleChange?.(track.id);
                  onClose();
                }}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  track.active
                    ? "bg-[#D4A237]/20 text-[#D4A237]"
                    : "text-white/70 hover:text-white hover:bg-white/[0.05]"
                }`}
              >
                <div className="flex justify-between items-center">
                  <span>{track.label}</span>
                  {track.language && (
                    <span className="text-xs text-white/40">
                      ({track.language})
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {activeTab === "speed" && (
          <div className="space-y-1.5">
            {playbackRates.map((rate) => (
              <button
                key={rate}
                onClick={() => {
                  onRateChange?.(rate);
                  onClose();
                }}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  rate === currentRate
                    ? "bg-[#D4A237]/20 text-[#D4A237]"
                    : "text-white/70 hover:text-white hover:bg-white/[0.05]"
                }`}
              >
                {rate.toFixed(rate === 1 ? 0 : 2)}x
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
