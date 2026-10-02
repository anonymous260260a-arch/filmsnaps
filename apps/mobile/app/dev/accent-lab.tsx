/**
 * Accent Lab — dev-only tuning harness for the movie-accent pipeline.
 *
 * Renders the REAL production path (native/fallback engine → pickFromSwatchBag
 * → normalizeAccent → buildPalette) across the curated dev corpus, with
 * per-title readouts: winning swatch + tier + score, gate labels, OKLCH
 * (L/C/H) pre-clamp and post-clamp, palette bar, mock CTA. Toggles compare
 * poster vs backdrop sources (and whether the 60° refine gate would fire),
 * strict-only vs strict+relaxed, and diff vs persisted swatches.
 * "Run bench" captures p50/p95/stall on-device.
 *
 * NOT wired into any production surface; route exists only in dev builds.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { getImageUrl } from "@filmsnaps/shared";
import { oklch } from "culori";
import { tmdbApi } from "../../lib/api";
import { colors } from "../../theme/colors";
import { ProgressiveImage } from "../../components/ProgressiveImage";
import { DEV_CORPUS } from "../../data/devCorpus";
import {
  accentGateLabels,
  buildPalette,
  getSwatchSync,
  hueDistance,
  peekSwatch,
  pickAccentWithMeta,
  resolveSwatch,
  type AccentPickMeta,
} from "../../lib/movieAccent";
import { runAccentBench } from "../../lib/bench/accentBench";

interface LabEntry {
  label: string;
  tags: string[];
  posterPath: string | null;
  backdropPath: string | null;
  posterHex: string | null;
  backdropHex: string | null;
  posterMeta: AccentPickMeta | null;
  backdropMeta: AccentPickMeta | null;
  persistedPosterHex: string | null | undefined;
  persistedBackdropHex: string | null | undefined;
}

const PENDING = Symbol("lab.pending");

/** "L0.62 C0.12 H30" — OKLCH readout (h defaults 0 for pure greys). */
function oklchText(hex: string): string {
  const o = oklch(hex);
  if (!o) return "—";
  return `L${o.l.toFixed(2)} C${(o.c ?? 0).toFixed(3)} H${(o.h ?? 0).toFixed(0)}`;
}

async function fetchPaths(entry: (typeof DEV_CORPUS)[number]): Promise<{
  posterPath: string | null;
  backdropPath: string | null;
}> {
  try {
    const details =
      entry.type === "tv"
        ? await tmdbApi.getTVDetails(entry.id)
        : await tmdbApi.getMovieDetails(entry.id);
    const d = details as {
      poster_path?: string | null;
      backdrop_path?: string | null;
    };
    return {
      posterPath: d.poster_path ?? null,
      backdropPath: d.backdrop_path ?? null,
    };
  } catch {
    return { posterPath: null, backdropPath: null };
  }
}

/** Warm the corpus with bounded concurrency (≤4), resolve paths first. */
async function warmCorpus(
  onProgress: (done: number, total: number) => void,
): Promise<LabEntry[]> {
  const total = DEV_CORPUS.length;
  const out: LabEntry[] = new Array(total);
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < total) {
      const index = cursor++;
      const entry = DEV_CORPUS[index];
      const paths = await fetchPaths(entry);
      let posterHex: string | null = null;
      let backdropHex: string | null = null;
      let posterMeta: AccentPickMeta | null = null;
      let backdropMeta: AccentPickMeta | null = null;
      if (paths.posterPath) {
        posterHex = await resolveSwatch(paths.posterPath, "w342");
        if (posterHex) {
          // resolveSwatch already warmed the native cache — this is a hit.
          posterMeta = pickAccentWithMeta(
            (await getBagFor(paths.posterPath, "w342")) as never,
          );
        }
      }
      if (paths.backdropPath) {
        backdropHex = await resolveSwatch(paths.backdropPath);
        if (backdropHex) {
          backdropMeta = pickAccentWithMeta(
            (await getBagFor(paths.backdropPath, "w1280")) as never,
          );
        }
      }
      out[index] = {
        label: entry.label,
        tags: entry.tags,
        posterPath: paths.posterPath,
        backdropPath: paths.backdropPath,
        posterHex,
        backdropHex,
        posterMeta,
        backdropMeta,
        // Same versioned keys the production cache uses (v4 prefix on ALL
        // paths — poster and backdrop alike).
        persistedPosterHex: paths.posterPath
          ? peekSwatch(paths.posterPath)
          : undefined,
        persistedBackdropHex: paths.backdropPath
          ? peekSwatch(paths.backdropPath)
          : undefined,
      };
      done += 1;
      onProgress(done, total);
    }
  }

  await Promise.all([worker(), worker(), worker(), worker()]);
  return out.filter(Boolean) as LabEntry[];
}

/**
 * Re-fetch the native swatch bag for readouts. Uses the native engine
 * (peek after resolve ⇒ warm cache) or an empty bag on the fallback path.
 */
async function getBagFor(
  path: string,
  size: string,
): Promise<Record<string, { hex: string; population: number }>> {
  const { MovieAccent, DECODE_WIDTH } =
    await import("../../modules/movie-accent");
  if (!MovieAccent) return {};
  const url =
    size === "w342"
      ? `https://image.tmdb.org/t/p/w92/${path.replace(/^\//, "")}`
      : `https://image.tmdb.org/t/p/w300/${path.replace(/^\//, "")}`;
  const bag = await MovieAccent.getSwatches(url, DECODE_WIDTH);
  return (bag as never) ?? {};
}

/** expo-router requires a DEFAULT export on route files. */
export default function AccentLabScreen() {
  const [entries, setEntries] = useState<LabEntry[] | typeof PENDING>(PENDING);
  const [progress, setProgress] = useState({
    done: 0,
    total: DEV_CORPUS.length,
  });
  const [strictOnly, setStrictOnly] = useState(false);
  const [sourceMode, setSourceMode] = useState<"poster" | "backdrop" | "both">(
    "poster",
  );
  const [showDiff, setShowDiff] = useState(false);
  const [bench, setBench] = useState<string | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);
  const [selected, setSelected] = useState<LabEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    warmCorpus((done, total) => {
      if (!cancelled) setProgress({ done, total });
    }).then((list) => {
      if (!cancelled) setEntries(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const runBench = useCallback(async () => {
    if (entries === PENDING) return;
    setBenchRunning(true);
    try {
      const posters = entries
        .map((e: LabEntry) => e.posterPath)
        .filter((p): p is string => !!p)
        .slice(0, 10);
      const backdrops = entries
        .map((e: LabEntry) => e.backdropPath)
        .filter((p): p is string => !!p)
        .slice(0, 10);
      const result = await runAccentBench(posters, backdrops, 1);
      setBench(JSON.stringify(result, null, 1));
    } finally {
      setBenchRunning(false);
    }
  }, [entries]);

  if (selected) {
    return <LabMockup entry={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 10, paddingBottom: 40 }}
    >
      <Text style={styles.h1}>Accent Lab (dev)</Text>
      {entries === PENDING ? (
        <View style={styles.progressRow}>
          <ActivityIndicator color={colors.gold} />
          <Text style={styles.note}>
            Warming corpus… {progress.done}/{progress.total}
          </Text>
        </View>
      ) : null}

      <View style={styles.controls}>
        <View style={styles.controlRow}>
          <Text style={styles.controlLabel}>Strict-only</Text>
          <Switch
            value={strictOnly}
            onValueChange={setStrictOnly}
            thumbColor={strictOnly ? colors.gold : colors.textTertiary}
          />
          <Text style={styles.controlLabel}>Diff vs persisted</Text>
          <Switch
            value={showDiff}
            onValueChange={setShowDiff}
            thumbColor={showDiff ? colors.gold : colors.textTertiary}
          />
        </View>
        <View style={styles.controlRow}>
          {(["poster", "backdrop", "both"] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => setSourceMode(m)}
              style={[styles.seg, sourceMode === m && styles.segActive]}
            >
              <Text
                style={[
                  styles.segText,
                  sourceMode === m && styles.segTextActive,
                ]}
              >
                {m}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={runBench}
            disabled={benchRunning || entries === PENDING}
            style={[styles.seg, styles.benchBtn]}
          >
            <Text style={styles.segText}>
              {benchRunning ? "benching…" : "Run bench"}
            </Text>
          </Pressable>
        </View>
        {bench ? <Text style={styles.benchText}>{bench}</Text> : null}
      </View>

      {entries !== PENDING && (
        <View style={{ gap: 8 }}>
          {entries.map((e) => (
            <LabCard
              key={e.label}
              entry={e}
              strictOnly={strictOnly}
              sourceMode={sourceMode}
              showDiff={showDiff}
              onOpen={() => setSelected(e)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function effectivePick(
  entry: LabEntry,
  sourceMode: "poster" | "backdrop" | "both",
  strictOnly: boolean,
): {
  hex: string | null;
  meta: AccentPickMeta | null;
  from: "poster" | "backdrop" | null;
} {
  const meta = (m: AccentPickMeta | null): AccentPickMeta | null =>
    m && strictOnly && m.tier === "relaxed" ? null : m;
  const poster = meta(entry.posterMeta);
  const backdrop = meta(entry.backdropMeta);
  if (sourceMode === "poster")
    return { hex: poster?.hex ?? null, meta: poster, from: "poster" };
  if (sourceMode === "backdrop")
    return { hex: backdrop?.hex ?? null, meta: backdrop, from: "backdrop" };
  // both: strict poster wins; else strict backdrop; else relaxed poster; else relaxed backdrop.
  if (poster?.tier === "strict")
    return { hex: poster.hex, meta: poster, from: "poster" };
  if (backdrop?.tier === "strict")
    return { hex: backdrop.hex, meta: backdrop, from: "backdrop" };
  if (poster) return { hex: poster.hex, meta: poster, from: "poster" };
  if (backdrop) return { hex: backdrop.hex, meta: backdrop, from: "backdrop" };
  return { hex: null, meta: null, from: null };
}

function LabCard({
  entry,
  strictOnly,
  sourceMode,
  showDiff,
  onOpen,
}: {
  entry: LabEntry;
  strictOnly: boolean;
  sourceMode: "poster" | "backdrop" | "both";
  showDiff: boolean;
  onOpen: () => void;
}) {
  const pick = effectivePick(entry, sourceMode, strictOnly);
  const palette = pick.hex ? buildPalette(pick.hex) : null;

  // Small-source drift: hue gap between poster- and backdrop-derived accents
  // (measured on NORMALIZED accents — the same rule the refine gate uses).
  const drift =
    entry.posterHex && entry.backdropHex
      ? hueDistance(entry.posterHex, entry.backdropHex)
      : null;

  const persistedHex =
    sourceMode === "backdrop"
      ? entry.persistedBackdropHex
      : entry.persistedPosterHex;
  const diffHex =
    showDiff && persistedHex && pick.hex
      ? hueDistance(persistedHex, pick.hex)
      : null;

  const gateLabels = pick.hex ? accentGateLabels(pick.hex) : [];
  // Would the 60° refine gate fire between sources?
  const refineWouldFire = drift != null && drift >= 60;

  return (
    <Pressable onPress={onOpen} style={styles.card}>
      <View style={styles.thumbs}>
        {entry.posterPath ? (
          <ProgressiveImage
            uri={getImageUrl(entry.posterPath, "w92")}
            style={styles.thumbPoster}
          />
        ) : null}
        {entry.backdropPath ? (
          <ProgressiveImage
            uri={getImageUrl(entry.backdropPath, "w300")}
            style={styles.thumbBackdrop}
          />
        ) : null}
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.title} numberOfLines={1}>
            {entry.label}
          </Text>
          <Text style={styles.tags} numberOfLines={1}>
            {entry.tags.join(" · ")}
          </Text>
          {pick.hex ? (
            <>
              <Text style={styles.readout} numberOfLines={1}>
                {pick.from}: {pick.meta?.name} ({pick.meta?.tier})
                {pick.meta?.score != null
                  ? ` score ${pick.meta.score.toFixed(0)}`
                  : ""}{" "}
                · {oklchText(pick.hex)}
              </Text>
              {palette ? (
                <Text style={styles.readout} numberOfLines={1}>
                  accent: {oklchText(palette.accent)}
                </Text>
              ) : null}
              <Text style={styles.gateText}>{gateLabels.join(" · ")}</Text>
              {drift != null ? (
                <Text style={styles.readout}>
                  poster↔backdrop Δhue {Math.round(drift)}°
                  {refineWouldFire ? " → refine WOULD fire" : ""}
                </Text>
              ) : null}
              {diffHex != null ? (
                <Text style={styles.readout}>
                  persisted Δhue {Math.round(diffHex)}°
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={[styles.gateText, { color: colors.error }]}>
              fallback (no usable swatch)
            </Text>
          )}
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {palette ? (
            <>
              <View
                style={[styles.chip, { backgroundColor: palette.accent }]}
              />
              <View
                style={{
                  width: 56,
                  height: 10,
                  borderRadius: 5,
                  overflow: "hidden",
                  flexDirection: "row",
                }}
              >
                <View style={{ flex: 38, backgroundColor: palette.glow }} />
                <View style={{ flex: 42, backgroundColor: palette.mid }} />
                <View style={{ flex: 62, backgroundColor: palette.faded }} />
              </View>
              <View
                style={[
                  styles.chip,
                  { backgroundColor: palette.accent, width: 56, height: 18 },
                ]}
              >
                <Text
                  style={{
                    color: palette.accentText,
                    fontSize: 8,
                    fontWeight: "800",
                  }}
                >
                  Watch
                </Text>
              </View>
            </>
          ) : (
            <View style={[styles.chip, { backgroundColor: colors.goldDim }]} />
          )}
        </View>
      </View>
    </Pressable>
  );
}

function LabMockup({ entry, onBack }: { entry: LabEntry; onBack: () => void }) {
  const pick = effectivePick(entry, "both", false);
  const palette = pick.hex ? buildPalette(pick.hex) : null;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ height: 300 }}>
        {entry.backdropPath ? (
          <ProgressiveImage
            uri={getImageUrl(entry.backdropPath, "w300")}
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <View style={{ flex: 1, backgroundColor: colors.bgSubtle }} />
        )}
        {palette ? (
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 160,
            }}
          >
            <View
              style={{
                position: "absolute",
                inset: 0,
                backgroundColor: palette.mid,
                opacity: 0.6,
              }}
            />
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: 90,
                backgroundColor: palette.faded,
                opacity: 0.94,
              }}
            />
          </View>
        ) : null}
      </View>
      <View style={{ padding: 16, gap: 10 }}>
        <Text style={styles.h2}>{entry.label}</Text>
        <Text style={styles.note}>
          Mock hero: backdrop (w300) + wash stops at real opacities.
        </Text>
        {palette ? (
          <View
            style={{
              backgroundColor: palette.accent,
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center",
            }}
          >
            <Text style={{ color: palette.accentText, fontWeight: "800" }}>
              Watch Now
            </Text>
          </View>
        ) : (
          <View
            style={{
              backgroundColor: colors.goldDim,
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center",
            }}
          >
            <Text style={{ color: colors.bg, fontWeight: "800" }}>
              Watch Now
            </Text>
          </View>
        )}
        <Pressable
          onPress={onBack}
          style={[styles.seg, { alignSelf: "flex-start" }]}
        >
          <Text style={styles.segText}>← back to grid</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  h1: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8,
  },
  h2: { color: colors.textPrimary, fontSize: 16, fontWeight: "800" },
  note: { color: colors.textSecondary, fontSize: 11 },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  controls: { marginBottom: 10, gap: 6 },
  controlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  controlLabel: { color: colors.textSecondary, fontSize: 11 },
  seg: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.bgSurface,
  },
  segActive: { backgroundColor: colors.goldBadge, borderColor: colors.gold },
  segText: { color: colors.textSecondary, fontSize: 11, fontWeight: "700" },
  segTextActive: { color: colors.gold },
  benchBtn: { marginLeft: "auto" },
  benchText: {
    color: colors.textTertiary,
    fontSize: 10,
    fontFamily: "monospace",
  },
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 8,
  },
  thumbs: { flexDirection: "row", gap: 8, alignItems: "center" },
  thumbPoster: { width: 40, height: 60, borderRadius: 6, overflow: "hidden" },
  thumbBackdrop: { width: 80, height: 45, borderRadius: 6, overflow: "hidden" },
  title: { color: colors.textPrimary, fontSize: 13, fontWeight: "700" },
  tags: { color: colors.textTertiary, fontSize: 10 },
  readout: { color: colors.textTertiary, fontSize: 10 },
  gateText: { color: colors.amber, fontSize: 10, fontWeight: "700" },
  chip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
