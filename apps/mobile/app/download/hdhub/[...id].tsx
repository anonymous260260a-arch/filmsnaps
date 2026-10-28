/**
 * HDHub Download — direct-CDN file picker.
 *
 * HDHub is a `type: "direct"` provider whose stream payload already points at
 * real files (R2 presigned, pixeldrain /api/file, googleusercontent, plain
 * .mp4/.mkv paths). This screen resolves TMDB → IMDB → `/stream/{movie|series}`
 * and lists every link we can prove is a file.
 *
 * Deliberately NOT a WebView flow (unlike nxsha): HDHub is JSON-only, so the
 * whole page is one react-query fetch. It also stays independent of
 * fetchDirectStreams(), which merges falix links into the same pool for
 * playback ranking — a download screen must only offer the provider it
 * claims to offer.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  ScrollView,
  SafeAreaView,
  StyleSheet,
  Platform,
  Linking,
  Alert,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeNavigation } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  getImageUrl,
  rankDownloadLinks,
  passesDownloadFilter,
  describeDownloadFile,
  downloadMetaSegments,
  buildDownloadFileName,
  type DownloadFileDetails,
  type DownloadRankOptions,
  type MetaTone,
} from "@filmsnaps/shared";
import { colors } from "../../../theme/colors";
import { ProgressiveImage } from "../../../components/ProgressiveImage";
import { EpisodeRail } from "../../../components/player/EpisodeRail";
import { useDownloadList, useDownloadTrigger } from "../../../lib/download";
import { fetchHdHubLinks } from "../../../lib/directStreams";
import { useSettings } from "../../../lib/settings";
import {
  isDirectFileUrl,
  isGatewayUrl,
  extractFilename,
} from "../../../lib/nxshaLinks";
import { tmdbApi } from "../../../lib/api";
import { DETAIL_STALE_TIME } from "../../../lib/detailQuery";
import type { StreamLink } from "../../../components/player/streamTypes";

// ── Row ────────────────────────────────────────────────────────────

/** Colour per meta segment — gold quality, sky language, amber warnings. */
const META_TONE_COLOR: Record<MetaTone, string> = {
  quality: colors.gold,
  size: "#a1a1aa",
  language: "#7dd3fc",
  info: "#71717a",
  cam: "#f87171",
  warn: "#f59e0b",
};

type RowState = "completed" | "active" | "idle";

interface FileRow {
  link: StreamLink;
  /** Every field the row displays — derived once by the shared describe step. */
  details: DownloadFileDetails;
  /** Direct file we hand to the native downloader. */
  direct: boolean;
  /** Landing page (hubcloud/pixeldrain /u/) — only openable externally. */
  gateway: boolean;
}

type FilterKey = "q" | "sz" | "lg";

const QUALITY_OPTIONS: { label: string; value: string }[] = [
  { label: "All qualities", value: "" },
  { label: "4K", value: "4K" },
  { label: "1080p", value: "1080p" },
  { label: "720p", value: "720p" },
  { label: "480p", value: "480p" },
];

const SIZE_OPTIONS: { label: string; value: string }[] = [
  { label: "Any size", value: "" },
  { label: "≤ 1 GB", value: "1gb" },
  { label: "1–4 GB", value: "4gb" },
  { label: "4–8 GB", value: "8gb" },
  { label: "> 8 GB", value: "gt8gb" },
];

const LANGUAGE_OPTIONS: { label: string; value: string }[] = [
  { label: "Any language", value: "" },
  { label: "Multi / Dual", value: "multi" },
  { label: "Hindi", value: "hindi" },
  { label: "English", value: "english" },
];

function readParam(
  params: { [k: string]: unknown },
  key: FilterKey,
  fallbacks: string[],
  defaultWhenEmpty?: string,
): string {
  const k = params[key];
  if (k) return String(k);
  for (const fb of fallbacks) {
    const v = params[fb];
    if (v) return String(v);
  }
  return defaultWhenEmpty ?? "";
}

function writeParam(
  setParams: React.Dispatch<
    React.SetStateAction<{ [k: string]: string | undefined }>
  >,
  key: FilterKey,
  value: string,
) {
  setParams((prev) => {
    const next = { ...prev };
    if (value) next[key] = value;
    else delete next[key];
    return next;
  });
}

export default function HdHubDownloadScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const rawParams = useLocalSearchParams<{
    id: string[];
    poster?: string;
    backdrop?: string;
  }>();

  const params = useMemo(() => {
    const segs = rawParams.id ?? [];
    return {
      type: segs[0] as "movie" | "tv",
      id: segs[1],
      season: segs[2] ? Number(segs[2]) : undefined,
      episode: segs[3] ? Number(segs[3]) : undefined,
    };
  }, [(rawParams.id ?? []).join(",")]);

  const isTV = params.type === "tv";
  const [pickedSeason, setPickedSeason] = useState<number | null>(null);
  const [pickedEpisode, setPickedEpisode] = useState<number | null>(null);
  const [showEpPicker, setShowEpPicker] = useState(false);

  // Filters persist via URL params so they survive navigation and shareable links.
  const [filterParams, setFilterParams] = useState<{
    [k: string]: string | undefined;
  }>({
    q: readParam(rawParams, "q", ["quality"]) || "",
    sz: readParam(rawParams, "sz", ["size"]) || "",
    lg: readParam(rawParams, "lg", ["lang", "language"]) || "",
  });

  const effectiveSeason = pickedSeason ?? params.season ?? 1;
  const effectiveEpisode = pickedEpisode ?? params.episode ?? 1;

  const { trigger } = useDownloadTrigger();
  const { all: downloads } = useDownloadList();
  const { settings } = useSettings();

  // Title/artwork — same query keys as the detail screens ("movie"/"tv" + id),
  // so this renders instantly from cache instead of re-fetching TMDB. Each
  // query is gated so we never request /tv/<movieId> (or vice versa).
  const movieQuery = useQuery({
    queryKey: ["movie", params.id],
    queryFn: ({ signal }) => tmdbApi.getMovieDetails(params.id, signal),
    enabled: !!params.id && !isTV,
    staleTime: DETAIL_STALE_TIME,
  });
  const tvQuery = useQuery({
    queryKey: ["tv", params.id],
    queryFn: ({ signal }) => tmdbApi.getTVDetails(params.id, signal),
    enabled: !!params.id && isTV,
    staleTime: DETAIL_STALE_TIME,
  });
  const details = (isTV ? tvQuery.data : movieQuery.data) as
    | {
        title?: string;
        name?: string;
        poster_path?: string | null;
        backdrop_path?: string | null;
        genres?: { id: number; name: string }[];
        vote_average?: number;
        runtime?: number;
        first_air_date?: string;
        release_date?: string;
      }
    | undefined;

  const title = details?.title || details?.name || (isTV ? "Episode" : "Title");

  const posterPath = (rawParams.poster as string) || details?.poster_path || "";
  const backdropPath =
    (rawParams.backdrop as string) || details?.backdrop_path || "";
  const posterUrl = posterPath ? getImageUrl(posterPath, "w342") : null;
  const backdropUrl = backdropPath ? getImageUrl(backdropPath, "w780") : null;

  // ── HDHub lookup ──
  const {
    data: links,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<StreamLink[]>({
    queryKey: [
      "hdhub",
      "download-links",
      params.type,
      params.id,
      isTV ? effectiveSeason : 0,
      isTV ? effectiveEpisode : 0,
    ],
    queryFn: () =>
      fetchHdHubLinks(
        Number(params.id),
        params.type,
        isTV ? effectiveSeason : undefined,
        isTV ? effectiveEpisode : undefined,
      ),
    enabled: !!params.id && Number.isFinite(Number(params.id)),
    retry: 1,
    // Presigned URLs rotate — never serve a stale list from a previous session.
    staleTime: 5 * 60 * 1000,
  });

  // Episode title for the filename cleaner — same query key the detail/watch
  // screens use, so it is usually a cache hit, and gated on `links` so TMDB is
  // never called before there is anything to name.
  const seasonQuery = useQuery({
    queryKey: ["tv", params.id, "season", effectiveSeason],
    queryFn: ({ signal }) =>
      tmdbApi.getSeasonEpisodes(Number(params.id), effectiveSeason, signal),
    enabled: isTV && !!params.id && links !== undefined,
    staleTime: DETAIL_STALE_TIME,
  });
  const episodeName =
    seasonQuery.data?.episodes?.[effectiveEpisode - 1]?.name || undefined;

  const qualityFilter = filterParams.q ?? "";
  const sizeFilter = filterParams.sz ?? "";
  const languageFilter = filterParams.lg ?? "";
  const hasActiveFilters = !!(qualityFilter || sizeFilter || languageFilter);
  const clearFilters = () => setFilterParams({ q: "", sz: "", lg: "" });

  // Ranked by the shared download chain: the user's preferred audio language
  // first, then language → quality → audio format → clean print → size.
  const rows: FileRow[] = useMemo(() => {
    const ranked = rankDownloadLinks(links ?? [], {
      preferredLanguage: settings.preferredAudioLanguage,
      attachDimensions: true,
    } as DownloadRankOptions);
    const nameCtx = {
      title: details ? title : undefined,
      episodeName,
    };
    return ranked
      .map((link) => ({
        link,
        details: describeDownloadFile(link, nameCtx),
        direct: isDirectFileUrl(link.url) && !isGatewayUrl(link.url),
        gateway: isGatewayUrl(link.url),
      }))
      .filter((row) =>
        passesDownloadFilter(row.link, {
          quality: qualityFilter,
          size: sizeFilter,
          language: languageFilter,
        }),
      );
  }, [
    links,
    settings.preferredAudioLanguage,
    details,
    title,
    episodeName,
    qualityFilter,
    sizeFilter,
    languageFilter,
  ]);

  const directRows = rows.filter((r) => r.direct);
  const externalRows = rows.filter((r) => !r.direct);

  // ── Queue a direct file ──
  const downloadFile = useCallback(
    (row: FileRow) => {
      const { link, details: file } = row;
      const extension =
        file.name.match(/\.(mkv|mp4|m4v|avi|ts|m2ts|webm)$/i)?.[1] ??
        file.container ??
        "mp4";

      // Display badges persisted with the download record (download manager UI).
      const badges = [
        file.quality,
        file.sizeLabel,
        file.languages.length > 0 ? file.languages.join(" · ") : "",
        file.audio,
        file.source,
        file.codec,
      ]
        .filter(Boolean)
        .filter((b, i, a) => a.indexOf(b) === i)
        .slice(0, 5);

      // Stays on this screen — toast confirms, no navigation to /downloads.
      // Space-too-tight is a warn dialog with an override, not a hard block.
      void trigger(
        {
          url: link.url,
          fileName: buildDownloadFileName({
            details: file,
            title,
            mediaType: params.type,
            season: effectiveSeason,
            episode: effectiveEpisode,
          }),
          server: "hdhub",
          mediaType: params.type,
          tmdbId: params.id,
          quality: file.quality,
          title: isTV
            ? `${title} S${effectiveSeason}E${effectiveEpisode}`
            : title,
          posterPath: posterPath || undefined,
          season: isTV ? effectiveSeason : undefined,
          episode: isTV ? effectiveEpisode : undefined,
          extension: extension.toLowerCase(),
          sizeBytes: file.sizeBytes,
        },
        { badges },
      );
    },
    [
      trigger,
      params.id,
      params.type,
      title,
      isTV,
      effectiveSeason,
      effectiveEpisode,
      posterPath,
    ],
  );

  const openInBrowser = useCallback((url: string) => {
    Linking.openURL(url).catch(() =>
      Alert.alert("Could not open URL", "No app can handle this link."),
    );
  }, []);

  const getFileState = useCallback(
    (link: StreamLink): RowState => {
      const name = extractFilename(link.url);
      const task = downloads.find(
        (t) =>
          t.server === "hdhub" &&
          t.tmdbId === params.id &&
          (t.url === link.url || (!!name && t.fileName === name)),
      );
      if (!task) return "idle";
      if (task.status === "completed") return "completed";
      if (task.status === "downloading" || task.status === "pending")
        return "active";
      return "idle";
    },
    [downloads, params.id],
  );

  const handleEpisodeSelect = useCallback((season: number, episode: number) => {
    setPickedSeason(season);
    setPickedEpisode(episode);
    setShowEpPicker(false);
  }, []);

  // ── Early returns ──
  if (isLoading) {
    return (
      <SafeAreaView style={styles.center}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color={colors.gold} />
        <Text style={styles.muted}>Finding HDHub files…</Text>
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={[styles.center, { paddingHorizontal: 24 }]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.errorIcon}>
          <Ionicons
            name="alert-circle-outline"
            size={36}
            color={colors.error}
          />
        </View>
        <Text style={styles.errorTitle}>Couldn't reach HDHub</Text>
        <Text style={styles.errorBody}>
          {error instanceof Error ? error.message : String(error)}
        </Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <TouchableOpacity
            onPress={() => nav.goBack({ fallback: "/(tabs)" })}
            style={styles.btnGhost}
            activeOpacity={0.8}
          >
            <Text style={styles.btnGhostText}>Go Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => refetch()}
            style={styles.btnGold}
            activeOpacity={0.8}
          >
            <Text style={styles.btnGoldText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Genuine "HDHub returned nothing" — only when no filter is hiding rows.
  // With filters active we keep rendering the screen (chips included) so the
  // user can clear them instead of being stranded on an empty state.
  if (rows.length === 0 && !hasActiveFilters) {
    return (
      <SafeAreaView style={[styles.center, { paddingHorizontal: 24 }]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.emptyIcon}>
          <Ionicons
            name="folder-open-outline"
            size={34}
            color={colors.zinc500}
          />
        </View>
        <Text style={styles.errorTitle}>No files found</Text>
        <Text style={styles.errorBody}>
          HDHub has no download links for this title
          {isTV ? ` at S${effectiveSeason}E${effectiveEpisode}` : ""}.
        </Text>
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          style={styles.btnGhost}
          activeOpacity={0.8}
        >
          <Text style={styles.btnGhostText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />

      {backdropUrl && (
        <ProgressiveImage
          uri={backdropUrl}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          blurRadius={Platform.OS === "android" ? 10 : 20}
        />
      )}
      <View style={[StyleSheet.absoluteFill, styles.scrim]} />

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
      >
        {/* Header */}
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: insets.top + 12,
            paddingBottom: 16,
          }}
        >
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={() => nav.goBack({ fallback: "/(tabs)" })}
              style={styles.circleBtn}
              activeOpacity={0.7}
              accessibilityLabel="Close"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => nav.push("/downloads")}
              style={styles.downloadsPill}
              activeOpacity={0.7}
            >
              <Ionicons
                name="download-outline"
                size={15}
                color={colors.gold}
                style={{ marginRight: 5 }}
              />
              <Text style={styles.downloadsPillText}>Downloads</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.heroRow}>
            {posterUrl && (
              <ProgressiveImage
                uri={posterUrl}
                style={styles.poster}
                resizeMode="cover"
              />
            )}
            <View style={{ flex: 1, paddingTop: 4 }}>
              <Text style={styles.title}>{title}</Text>

              <View style={styles.badgeRow}>
                <View style={styles.badge}>
                  <Ionicons
                    name="server-outline"
                    size={12}
                    color={colors.gold}
                  />
                  <Text style={styles.badgeText}>HDHub</Text>
                </View>
                <View style={styles.badge}>
                  <Ionicons
                    name="document-text-outline"
                    size={12}
                    color="#a1a1aa"
                  />
                  <Text style={[styles.badgeText, { color: "#a1a1aa" }]}>
                    {rows.length} files
                  </Text>
                </View>
              </View>

              {isTV && (
                <TouchableOpacity
                  onPress={() => setShowEpPicker(true)}
                  style={styles.epBtn}
                  activeOpacity={0.7}
                >
                  <Ionicons name="tv-outline" size={14} color={colors.gold} />
                  <Text style={styles.epBtnText}>
                    S{effectiveSeason} · E{effectiveEpisode} — change
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Filters */}
        <View style={styles.filterRow}>
          <FilterChipSelect
            label="Quality"
            options={QUALITY_OPTIONS}
            value={qualityFilter}
            onChange={(v) => writeParam(setFilterParams, "q", v)}
          />
          <FilterChipSelect
            label="Size"
            options={SIZE_OPTIONS}
            value={sizeFilter}
            onChange={(v) => writeParam(setFilterParams, "sz", v)}
          />
          <FilterChipSelect
            label="Language"
            options={LANGUAGE_OPTIONS}
            value={languageFilter}
            onChange={(v) => writeParam(setFilterParams, "lg", v)}
          />
        </View>

        {/* Filters hid every file — chips above stay live so the user can
            change or clear them instead of getting stuck. */}
        {rows.length === 0 ? (
          <View style={styles.section}>
            <View style={styles.emptyFilteredCard}>
              <Ionicons name="filter-outline" size={30} color={colors.gold} />
              <Text style={[styles.errorTitle, { marginTop: 12 }]}>
                No files match your filters
              </Text>
              <Text style={[styles.errorBody, { marginBottom: 18 }]}>
                None of the available files match the selected quality, size and
                language.
              </Text>
              <TouchableOpacity
                onPress={clearFilters}
                style={styles.btnGold}
                activeOpacity={0.8}
              >
                <Text style={styles.btnGoldText}>Clear filters</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            {/* Direct files — enqueueable in-app */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Download Options</Text>

              {directRows.map((row, i) => {
                const state = getFileState(row.link);
                const progressTask = downloads.find(
                  (t) => t.server === "hdhub" && t.url === row.link.url,
                );
                const progress = progressTask?.totalBytes
                  ? progressTask.receivedBytes / progressTask.totalBytes
                  : 0;

                return (
                  <FileRowView
                    key={`d-${row.link.url}-${i}`}
                    row={row}
                    progress={state === "active" ? progress : undefined}
                    right={
                      <TouchableOpacity
                        onPress={() => downloadFile(row)}
                        disabled={state === "active"}
                        style={[
                          styles.actionBtn,
                          state === "completed" && styles.actionBtnDone,
                          state === "active" && { opacity: 0.6 },
                        ]}
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name={
                            state === "completed"
                              ? "checkmark-circle"
                              : state === "active"
                                ? "arrow-down-circle"
                                : "download-outline"
                          }
                          size={16}
                          color={state === "completed" ? "#22c55e" : "#000000"}
                        />
                        <Text style={styles.actionText}>
                          {state === "completed"
                            ? "Saved"
                            : state === "active"
                              ? `${Math.round(progress * 100)}%`
                              : "Download"}
                        </Text>
                      </TouchableOpacity>
                    }
                  />
                );
              })}
            </View>

            {/* Gateways / landing pages — not enqueueable, open externally */}
            {externalRows.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Open in Browser</Text>
                <Text style={styles.sectionNote}>
                  These hosts serve a web page instead of a direct file, so they
                  can't be downloaded in-app.
                </Text>
                {externalRows.map((row, i) => (
                  <FileRowView
                    key={`e-${row.link.url}-${i}`}
                    row={row}
                    right={
                      <TouchableOpacity
                        onPress={() => openInBrowser(row.link.url)}
                        style={styles.actionBtnGhost}
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name="open-outline"
                          size={16}
                          color={colors.gold}
                        />
                        <Text style={styles.actionGhostText}>Open</Text>
                      </TouchableOpacity>
                    }
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {isTV && (
        <EpisodeRail
          visible={showEpPicker}
          tvId={params.id}
          currentSeason={effectiveSeason}
          currentEpisode={effectiveEpisode}
          onSelect={handleEpisodeSelect}
          onClose={() => setShowEpPicker(false)}
        />
      )}
    </SafeAreaView>
  );
}

/**
 * One file row — two lines of text and a button, nothing more.
 *   1. the FULL file name (wraps; never clipped)
 *   2. one quiet meta line: quality · size · languages · audio (+ flags)
 * The release name already carries codec/container/source, so those are not
 * repeated — that repetition is what made the first pass feel noisy.
 */
function FileRowView({
  row,
  right,
  progress,
}: {
  row: FileRow;
  right: React.ReactNode;
  progress?: number;
}) {
  const segments = downloadMetaSegments(row.details);

  return (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text selectable style={styles.fileName}>
          {row.details.name}
        </Text>

        <Text style={styles.metaLine}>
          {segments.map((seg, i) => (
            <React.Fragment key={`${seg.tone}-${seg.label}`}>
              {i > 0 && <Text style={styles.metaText}>{" · "}</Text>}
              <Text
                style={[
                  styles.metaText,
                  seg.tone === "size" && styles.metaSize,
                  { color: META_TONE_COLOR[seg.tone] },
                ]}
              >
                {seg.label}
              </Text>
            </React.Fragment>
          ))}
        </Text>

        {progress !== undefined && (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round(progress * 100)}%` },
              ]}
            />
          </View>
        )}
      </View>

      {right}
    </View>
  );
}

/**
 * A compact segmented picker for one filter dimension (quality / size / language).
 * Tapping an active chip clears it; tapping inactive selects it.
 */
function FilterChipSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((o) => {
          const active = value === String(o.value);
          return (
            <TouchableOpacity
              key={o.value}
              onPress={() => onChange(active ? "" : String(o.value))}
              style={[
                styles.chip,
                active && [styles.chipActive, { backgroundColor: colors.gold }],
              ]}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.voidBlack },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.voidBlack,
  },
  muted: { color: "#a1a1aa", fontSize: 14, marginTop: 16 },
  scrim: { backgroundColor: "rgba(0,0,0,0.7)" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  circleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  downloadsPill: {
    height: 38,
    borderRadius: 19,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    backgroundColor: "rgba(212,162,55,0.12)",
  },
  downloadsPillText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "700",
  },
  heroRow: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  poster: {
    width: 115,
    height: 172,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(63, 63, 70, 0.6)",
  },
  title: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 20,
    lineHeight: 26,
    fontFamily: "PlayfairDisplay_700Bold",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    flexWrap: "wrap",
    gap: 8,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(39, 39, 42, 0.6)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 4,
  },
  badgeText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "700",
  },
  epBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    alignSelf: "flex-start",
    gap: 6,
    backgroundColor: "rgba(212,162,55,0.1)",
    borderWidth: 1,
    borderColor: "rgba(212,162,55,0.25)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  epBtnText: { color: colors.gold, fontSize: 12, fontWeight: "700" },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  filterGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  filterLabel: {
    color: "#a1a1aa",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  chipActive: {
    borderColor: colors.gold,
  },
  chipText: {
    color: "#e4e4e7",
    fontSize: 12,
    fontWeight: "700",
  },
  chipTextActive: {
    color: "#000000",
  },
  section: { paddingHorizontal: 16, marginBottom: 24 },
  sectionTitle: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
    marginBottom: 6,
    fontFamily: "PlayfairDisplay_700Bold",
  },
  sectionNote: {
    color: "#71717a",
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12,
  },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "rgba(24, 24, 27, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(63, 63, 70, 0.5)",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  fileName: {
    color: "#e4e4e7",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  metaLine: { marginTop: 5 },
  metaText: { fontSize: 11, lineHeight: 16, color: "#71717a" },
  metaSize: { fontVariant: ["tabular-nums"], fontWeight: "700" },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(63, 63, 70, 0.8)",
    marginTop: 8,
    overflow: "hidden",
  },
  progressFill: { height: 4, backgroundColor: colors.gold, borderRadius: 2 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    minWidth: 96,
    justifyContent: "center",
  },
  actionBtnDone: { backgroundColor: "rgba(34, 197, 94, 0.15)" },
  actionText: { color: "#000000", fontWeight: "800", fontSize: 12 },
  actionBtnGhost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "rgba(212,162,55,0.4)",
    backgroundColor: "rgba(212,162,55,0.08)",
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    minWidth: 96,
    justifyContent: "center",
  },
  actionGhostText: { color: colors.gold, fontWeight: "800", fontSize: 12 },
  errorIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(82, 82, 91, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyFilteredCard: {
    alignItems: "center",
    backgroundColor: "rgba(24, 24, 27, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(63, 63, 70, 0.5)",
    borderRadius: 14,
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  errorTitle: {
    color: "#d4d4d8",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  errorBody: {
    color: "#71717a",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  btnGhost: {
    backgroundColor: "rgba(39, 39, 42, 0.8)",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  btnGhostText: { color: "#d4d4d8", fontWeight: "700", fontSize: 15 },
  btnGold: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  btnGoldText: { color: "#000000", fontWeight: "700", fontSize: 15 },
});
