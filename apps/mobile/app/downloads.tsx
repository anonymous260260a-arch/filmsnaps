/**
 * Downloads — Full-screen download manager.
 *
 * Shows all download tasks grouped by status (active, paused, completed,
 * failed) with real-time progress, pause/resume, and file management.
 */

import { colors } from "../theme/colors";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
  Animated,
  NativeModules,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackIcon } from "../components/Icons";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import {
  useDownloadList,
  useDownload,
  formatBytes,
  formatDate,
  serverLabel,
  useDownloadInfra,
  groupDownloadsForSections,
} from "../lib/download";
import { EmptyState } from "../components/EmptyState";
import type { DownloadTask } from "../lib/download";

// ── Progress Bar ──

function ProgressBar({
  fraction,
  color = colors.gold,
}: {
  fraction: number;
  color?: string;
}) {
  const w = Math.min(Math.max(fraction * 100, 0), 100);
  return (
    <View
      className="h-1.5 rounded-full overflow-hidden"
      style={{ backgroundColor: colors.progressTrack }}
    >
      <View
        className="h-full rounded-full"
        style={{ width: `${w}%`, backgroundColor: color }}
      />
    </View>
  );
}

// ── Speed Tracker ──

type SpeedSample = { ts: number; bytes: number };

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "";
  if (bytesPerSec >= 1_048_576)
    return `${(bytesPerSec / 1_048_576).toFixed(1)} MB/s`;
  return `${Math.round(bytesPerSec / 1024)} KB/s`;
}

function formatETA(remainingBytes: number, bytesPerSec: number): string {
  if (bytesPerSec <= 0 || remainingBytes <= 0) return "";
  const secs = remainingBytes / bytesPerSec;
  if (secs < 60) return `${Math.round(secs)}s remaining`;
  if (secs < 3600)
    return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s remaining`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m remaining`;
}

// ── Task Row ──

/**
 * Route to the in-app HEVC player for a downloaded file. The watch route
 * plays `fileUri` straight through HevcPlayer (no streaming pipeline) and
 * `fs=1` opens it in fullscreen landscape. Tasks stored without a TMDB id
 * fall back to a "0" segment — the player skips history writes for it.
 */
function playPathFor(task: DownloadTask): string {
  const type = task.mediaType === "tv" ? "tv" : "movie";
  const tmdbId = task.tmdbId || "0";
  const base =
    type === "tv" && task.season != null && task.episode != null
      ? `/watch/tv/${tmdbId}/${task.season}/${task.episode}`
      : `/watch/${type}/${tmdbId}`;
  const qs = new URLSearchParams({
    fileUri: task.fileUri ?? "",
    title: task.title || task.fileName || "",
    fs: "1",
  }).toString();
  return `${base}?${qs}`;
}

function TaskRow({ taskId }: { taskId: string }) {
  const nav = useSafeNavigation();
  const { task, progress, pause, resume, cancel, retry, remove } =
    useDownload(taskId);
  const speedSamples = useRef<SpeedSample[]>([]);

  if (!task) return null;

  const {
    status,
    fileName,
    quality,
    server,
    totalBytes,
    receivedBytes,
    error,
    fileUri,
    createdAt,
    title,
  } = task;
  const pct = Math.round(progress * 100);

  // Track speed from receivedBytes changes over time
  const speedBytesPerSec = useMemo(() => {
    if (status !== "downloading" || receivedBytes <= 0) return 0;

    const now = Date.now();
    // Remove samples older than 5 seconds
    speedSamples.current = speedSamples.current.filter(
      (s) => now - s.ts < 5000,
    );
    speedSamples.current.push({ ts: now, bytes: receivedBytes });

    // Need at least 2 samples spanning >1 second for a meaningful reading
    if (speedSamples.current.length < 2) return 0;
    const first = speedSamples.current[0];
    const last = speedSamples.current[speedSamples.current.length - 1];
    const elapsedSec = (last.ts - first.ts) / 1000;
    if (elapsedSec < 1) return 0;

    return (last.bytes - first.bytes) / elapsedSec;
  }, [status, receivedBytes]);

  const speedLabel = formatSpeed(speedBytesPerSec);
  const etaLabel =
    status === "downloading" && totalBytes > 0
      ? formatETA(totalBytes - receivedBytes, speedBytesPerSec)
      : "";

  return (
    <View
      className="rounded-xl mb-2 overflow-hidden"
      style={{
        backgroundColor: colors.bgCard,
        borderWidth: 0.5,
        borderColor: colors.border,
      }}
    >
      {/* Info row */}
      <View className="px-3 pt-3 pb-2">
        {/* Title + metadata */}
        <View className="flex-row items-start justify-between">
          <View className="flex-1 mr-3">
            <Text
              className="text-zinc-200 text-sm font-bold leading-tight"
              numberOfLines={2}
            >
              {title || fileName}
            </Text>
            <View className="flex-row flex-wrap items-center gap-1.5 mt-1">
              <View className="bg-zinc-800 rounded-sm px-1.5 py-0.5">
                <Text className="text-zinc-400 text-[9px] font-semibold">
                  {serverLabel(server)}
                </Text>
              </View>
              {(task.badges ?? []).slice(0, 4).map((badge) => (
                <View
                  key={badge}
                  className="bg-zinc-800/70 rounded-sm px-1.5 py-0.5"
                >
                  <Text
                    className="text-zinc-400 text-[9px] font-semibold"
                    numberOfLines={1}
                  >
                    {badge}
                  </Text>
                </View>
              ))}
              {!task.badges?.length && quality && (
                <Text className="text-zinc-500 text-[10px]">{quality}</Text>
              )}
              {fileName !== title && (
                <Text className="text-zinc-600 text-[9px]" numberOfLines={1}>
                  {fileName}
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* Active: progress bar */}
        {(status === "downloading" || status === "pending") && (
          <View className="mt-2">
            <ProgressBar
              fraction={status === "pending" ? 0 : progress}
              color={status === "pending" ? colors.textTertiary : colors.gold}
            />
            <View className="flex-row justify-between mt-1">
              <Text className="text-zinc-500 text-[10px]">
                {status === "pending"
                  ? "Starting..."
                  : `${formatBytes(receivedBytes)} / ${formatBytes(totalBytes || 1)}`}
              </Text>
              <Text className="text-zinc-500 text-[10px]">{pct}%</Text>
            </View>
            {/* Speed + ETA row */}
            {status === "downloading" && (speedLabel || etaLabel) && (
              <View className="flex-row items-center mt-1">
                {speedLabel ? (
                  <View className="flex-row items-center mr-3">
                    <Ionicons
                      name="speedometer-outline"
                      size={10}
                      color={colors.textTertiary}
                    />
                    <Text className="text-zinc-500 text-[10px] ml-1">
                      {speedLabel}
                    </Text>
                  </View>
                ) : null}
                {etaLabel ? (
                  <View className="flex-row items-center">
                    <Ionicons
                      name="time-outline"
                      size={10}
                      color={colors.textTertiary}
                    />
                    <Text className="text-zinc-500 text-[10px] ml-1">
                      {etaLabel}
                    </Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>
        )}

        {/* Paused: progress bar + resume CTA */}
        {status === "paused" && (
          <View className="mt-2">
            <ProgressBar fraction={progress} color={colors.textTertiary} />
            <View className="flex-row justify-between mt-1">
              <Text className="text-zinc-500 text-[10px]">
                Paused · {formatBytes(receivedBytes)} /{" "}
                {formatBytes(totalBytes || 1)}
              </Text>
              <Text className="text-amber-400 text-[10px] font-semibold">
                {pct}%
              </Text>
            </View>
          </View>
        )}

        {/* Completed */}
        {status === "completed" && (
          <View className="flex-row items-center gap-1 mt-1">
            <Ionicons
              name="checkmark-circle"
              size={12}
              color={colors.successGreen}
            />
            <Text className="text-green-500 text-[10px] font-semibold">
              Saved · {fileUri ? formatBytes(totalBytes) : "Unknown size"}
            </Text>
          </View>
        )}

        {/* Failed */}
        {status === "failed" && (
          <View className="mt-1 flex-row items-center gap-1">
            <Ionicons name="alert-circle" size={12} color={colors.error} />
            <Text className="text-red-400 text-[10px] flex-1" numberOfLines={2}>
              {error || "Download failed"}
            </Text>
          </View>
        )}

        {/* Cancelled */}
        {status === "cancelled" && (
          <View className="flex-row items-center gap-1 mt-1">
            <Ionicons
              name="close-circle"
              size={12}
              color={colors.textSecondary}
            />
            <Text className="text-zinc-400 text-[10px]">Cancelled</Text>
          </View>
        )}

        {/* Retrying */}
        {status === "retrying" && (
          <View className="mt-1 flex-row items-center gap-1">
            <Ionicons name="refresh" size={12} color={colors.amber} />
            <Text
              className="text-amber-400 text-[10px] flex-1"
              numberOfLines={2}
            >
              {error ? `Retrying — ${error}` : "Waiting to retry…"}
            </Text>
          </View>
        )}

        {/* Date */}
        <Text className="text-zinc-600 text-[9px] mt-1">
          {formatDate(createdAt)}
        </Text>
      </View>

      {/* Action buttons */}
      <View
        className="flex-row border-t px-3 py-2"
        style={{
          borderTopColor: colors.border,
          backgroundColor: colors.bgOverlay,
        }}
      >
        {/* Active / Pending */}
        {(status === "downloading" || status === "pending") && (
          <>
            <TaskAction
              icon="pause-circle-outline"
              label="Pause"
              color={colors.gold}
              onPress={pause}
            />
            <TaskAction
              icon="close-circle-outline"
              label="Cancel"
              color={colors.error}
              onPress={cancel}
            />
          </>
        )}

        {/* Paused */}
        {status === "paused" && (
          <>
            <TaskAction
              icon="play-circle-outline"
              label="Resume"
              color={colors.successGreen}
              onPress={resume}
            />
            <TaskAction
              icon="close-circle-outline"
              label="Cancel"
              color={colors.error}
              onPress={cancel}
            />
          </>
        )}

        {/* Completed */}
        {status === "completed" && (
          <>
            {fileUri && (
              <TaskAction
                icon="play"
                label="Play"
                color={colors.gold}
                onPress={() => nav.push(playPathFor(task))}
              />
            )}
            <TaskAction
              icon="play-circle-outline"
              label="VLC"
              color={colors.textSecondary}
              onPress={() => openInVLC(fileUri, task.extension)}
            />
            <TaskAction
              icon="share-outline"
              label="Share"
              color={colors.info}
              onPress={() => handleShare(fileUri, fileName, task.extension)}
            />
            <TaskAction
              icon="trash-outline"
              label="Delete"
              color={colors.error}
              onPress={() => handleDelete(task, remove)}
            />
          </>
        )}

        {/* Failed */}
        {status === "failed" && (
          <>
            <TaskAction
              icon="refresh-outline"
              label="Retry"
              color={colors.gold}
              onPress={retry}
            />
            <TaskAction
              icon="trash-outline"
              label="Remove"
              color={colors.textSecondary}
              onPress={remove}
            />
          </>
        )}

        {/* Retrying */}
        {status === "retrying" && (
          <>
            <TaskAction
              icon="close-circle-outline"
              label="Cancel"
              color={colors.error}
              onPress={cancel}
            />
          </>
        )}

        {/* Cancelled */}
        {status === "cancelled" && (
          <>
            <TaskAction
              icon="refresh-outline"
              label="Retry"
              color={colors.gold}
              onPress={resume}
            />
            <TaskAction
              icon="trash-outline"
              label="Remove"
              color={colors.textSecondary}
              onPress={remove}
            />
          </>
        )}
      </View>
    </View>
  );
}

// ── Show Group Row — TV episodes grouped under their show ──

function showTitleFor(task: DownloadTask): string {
  const fromTitle = task.title?.replace(/\sS\d{1,3}E\d{1,3}.*$/, "");
  if (fromTitle) return fromTitle;
  return (
    task.fileName
      ?.replace(/-S\d{1,3}E\d{1,3}.*$/, "")
      .replace(/_+|\.(mkv|mp4|m4v|avi|ts|m2ts|webm)$/gi, " ")
      .trim() ?? "Show"
  );
}

/**
 * A TV show's episodes as ONE expandable entry — never 10 loose episode rows.
 * The header carries aggregate progress ("3/10 episodes · 2 downloading"),
 * the union of the episodes' badges, and the partially-downloaded state.
 * Expanding reveals the individual episode TaskRows with full controls.
 */
function ShowGroupRow({
  taskIds,
  defaultExpanded = false,
}: {
  taskIds: string[];
  defaultExpanded?: boolean;
}) {
  const { store } = useDownloadInfra();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const tasks = useSyncExternalStore(
    (cb: () => void) => store.subscribe(cb),
    () => store.getAll(),
  );

  const episodes = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return taskIds
      .map((id) => byId.get(id))
      .filter((t): t is DownloadTask => !!t)
      .sort(
        (a, b) =>
          (a.season ?? 0) - (b.season ?? 0) ||
          (a.episode ?? 0) - (b.episode ?? 0),
      );
  }, [tasks, taskIds]);

  if (episodes.length === 0) return null;

  const title = showTitleFor(episodes[0]);
  const completedCount = episodes.filter(
    (t) => t.status === "completed",
  ).length;
  const activeCount = episodes.filter((t) =>
    ["downloading", "pending", "retrying"].includes(t.status),
  ).length;
  const pausedCount = episodes.filter((t) => t.status === "paused").length;
  const failedCount = episodes.filter((t) => t.status === "failed").length;

  const totalBytes = episodes.reduce((s, t) => s + (t.totalBytes || 0), 0);
  const receivedBytes = episodes.reduce(
    (s, t) => s + (t.receivedBytes || 0),
    0,
  );
  const fraction = totalBytes > 0 ? Math.min(receivedBytes / totalBytes, 1) : 0;

  const badges = episodes
    .flatMap((t) => t.badges ?? [])
    .filter((b, i, a) => a.indexOf(b) === i)
    .slice(0, 4);

  const statusBits: string[] = [];
  if (activeCount > 0) statusBits.push(`${activeCount} downloading`);
  if (pausedCount > 0) statusBits.push(`${pausedCount} paused`);
  if (failedCount > 0) statusBits.push(`${failedCount} failed`);

  return (
    <View
      className="rounded-xl mb-2 overflow-hidden"
      style={{
        backgroundColor: colors.bgCard,
        borderWidth: 0.5,
        borderColor: colors.border,
      }}
    >
      <TouchableOpacity
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
        className="px-3 pt-3 pb-2"
      >
        <View className="flex-row items-start">
          <View className="flex-1 mr-2">
            <Text
              className="text-zinc-100 text-sm font-bold leading-tight"
              numberOfLines={2}
            >
              {title}
            </Text>
            <View className="flex-row flex-wrap items-center gap-1.5 mt-1">
              <View className="bg-zinc-800 rounded-sm px-1.5 py-0.5">
                <Text className="text-zinc-400 text-[9px] font-semibold">
                  {completedCount}/{episodes.length} episodes
                </Text>
              </View>
              {badges.map((badge) => (
                <View
                  key={badge}
                  className="bg-zinc-800/70 rounded-sm px-1.5 py-0.5"
                >
                  <Text
                    className="text-zinc-400 text-[9px] font-semibold"
                    numberOfLines={1}
                  >
                    {badge}
                  </Text>
                </View>
              ))}
            </View>
          </View>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.textTertiary}
            style={{ marginTop: 2 }}
          />
        </View>

        <View className="mt-2">
          <ProgressBar
            fraction={fraction}
            color={activeCount > 0 ? colors.gold : colors.textTertiary}
          />
          <Text className="text-zinc-500 text-[10px] mt-1">
            {statusBits.length > 0
              ? statusBits.join(" · ")
              : completedCount === episodes.length
                ? "All episodes saved"
                : `${Math.round(fraction * 100)}% downloaded`}
          </Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View
          className="px-2 pb-2 border-t"
          style={{ borderTopColor: colors.border }}
        >
          {episodes.map((t) => (
            <TaskRow key={t.id} taskId={t.id} />
          ))}
        </View>
      )}
    </View>
  );
}

// ── Action Button ──

function TaskAction({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className="flex-row items-center mr-3 py-1 px-2 rounded-md"
      style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
    >
      <Ionicons name={icon} size={14} color={color} />
      <Text className="text-xs font-semibold ml-1.5" style={{ color }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Section Row ──

function SectionRow({
  title,
  count,
  action,
  actionLabel,
  actionColor,
}: {
  title: string;
  count: number;
  action?: () => void;
  actionLabel?: string;
  actionColor?: string;
}) {
  if (count === 0) return null;
  return (
    <View className="mt-4 mb-2 flex-row items-center justify-between">
      <View className="flex-row items-center gap-2">
        <Text className="text-zinc-400 text-xs font-semibold uppercase tracking-wider">
          {title}
        </Text>
        <View
          className="rounded-full px-2 py-0.5"
          style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
        >
          <Text className="text-zinc-500 text-[10px] font-bold">{count}</Text>
        </View>
      </View>
      {action && actionLabel && (
        <TouchableOpacity
          onPress={action}
          activeOpacity={0.7}
          className="flex-row items-center"
        >
          <Ionicons
            name="play"
            size={10}
            color={actionColor || colors.successGreen}
          />
          <Text
            className="text-xs font-semibold ml-1"
            style={{ color: actionColor || colors.successGreen }}
          >
            {actionLabel}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Share / VLC / Delete handlers ──

// Map a download extension to a concrete MIME type so the system chooser
// resolves the right players (VLC, MX Player, etc.). "video/*" is too vague
// and occasionally yields no matches; being specific makes the chooser reliable.
function mimeForExtension(ext?: string): string {
  switch ((ext || "").toLowerCase()) {
    case "mkv":
      return "video/x-matroska";
    case "webm":
      return "video/webm";
    case "m4v":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "avi":
      return "video/x-msvideo";
    case "flv":
      return "video/x-flv";
    case "3gp":
      return "video/3gpp";
    case "ts":
      return "video/mp2t";
    default:
      return "video/mp4";
  }
}

const FilmsnapsDownloader = NativeModules.FilmsnapsDownloader;

async function handleShare(
  fileUri: string | null,
  fileName: string,
  extension?: string,
) {
  if (!fileUri || !FilmsnapsDownloader) return;
  try {
    // The file lives in the system Downloads collection as a real MediaStore
    // `content://media/external/downloads/...` URI that our app owns. We hand
    // that RAW URI to a native intent + FLAG_GRANT_READ_URI_PERMISSION — no copy,
    // no expo-sharing (which only accepts file:// and falsely reported
    // "VLC not installed" for every content:// URI).
    await FilmsnapsDownloader.shareWithChooser(
      fileUri,
      mimeForExtension(extension),
      `Share ${fileName}`,
    );
  } catch (e: any) {
    if (e?.code === "NO_APP_FOUND") {
      Alert.alert("No app found", "No application can share this file type.");
    } else {
      Alert.alert("Share failed", e?.message ?? "Unknown error");
    }
  }
}

function handleDelete(task: DownloadTask, onDelete: () => void) {
  Alert.alert(
    "Delete Download",
    `Remove "${task.title || task.fileName}" from your device?`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: onDelete },
    ],
  );
}

async function openInVLC(fileUri: string | null, extension?: string) {
  if (!fileUri || !FilmsnapsDownloader) return;
  try {
    // Open the RAW MediaStore content:// URI in a player via the system chooser.
    // Our app inserted the MediaStore row, so it owns it and can grant read
    // access (FLAG_GRANT_READ_URI_PERMISSION) to whichever player the user picks.
    // This replaces expo-sharing, which rejected content:// and misreported the
    // failure as "VLC Not Installed".
    await FilmsnapsDownloader.openWithChooser(
      fileUri,
      mimeForExtension(extension),
      "Open with",
    );
  } catch (e: any) {
    if (e?.code === "NO_APP_FOUND") {
      const installUrl = Platform.select({
        android:
          "https://play.google.com/store/apps/details?id=org.videolan.vlc",
        ios: "https://apps.apple.com/app/vlc-for-mobile/id650377962",
        default: "https://www.videolan.org/vlc/",
      });
      Alert.alert(
        "VLC Not Installed",
        "VLC for Mobile is required. Would you like to install it?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Install",
            onPress: () => Linking.openURL(installUrl!),
          },
        ],
      );
    } else {
      Alert.alert("Could not open", e?.message ?? "Unknown error");
    }
  }
}

// ── Main Screen ──

export default function DownloadsScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const { manager } = useDownloadInfra();
  const {
    all: downloads,
    active,
    paused,
    completed,
    failed,
    cancelled,
    retrying,
    loaded,
    control,
  } = useDownloadList();

  // Storage meter
  const [storageInfo, setStorageInfo] = useState<{
    free: number;
    total: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const storage = manager.getStorageManager();
        const info = await storage.getStorageInfo();
        if (!cancelled) setStorageInfo({ free: info.free, total: info.total });
      } catch {}
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [manager]);

  const renderTask = useCallback(({ item }: { item: string }) => {
    return <TaskRow taskId={item} />;
  }, []);

  const keyExtractor = useCallback((item: string) => item, []);

  // Sectioned flatlist data — TV episodes grouped under their show as one
  // expandable entry (pure module, see lib/download/grouping.ts).
  const sections = useMemo(
    () => groupDownloadsForSections(downloads),
    [downloads],
  );

  if (!loaded) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
      >
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      {/* Header */}
      <View className="px-5 pt-4 pb-2 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={() => nav.goBack({ fallback: "/(tabs)" })}
            className="w-9 h-9 rounded-full bg-zinc-800/60 items-center justify-center mr-3"
            activeOpacity={0.7}
          >
            <BackIcon width={20} height={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text
            style={{
              fontFamily: "PlayfairDisplay_700Bold",
              fontSize: 22,
              color: colors.textPrimary,
            }}
          >
            Downloads
          </Text>
        </View>
        {downloads.length > 0 && (
          <TouchableOpacity
            onPress={() =>
              Alert.alert(
                "Clear Completed",
                "Remove all completed and cancelled downloads from the list?",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Clear",
                    style: "destructive",
                    onPress: () => {
                      control("remove", { status: "completed" });
                      control("remove", { status: "cancelled" });
                    },
                  },
                ],
              )
            }
            activeOpacity={0.7}
            className="flex-row items-center"
          >
            <Ionicons name="trash-outline" size={16} color={colors.error} />
            <Text className="text-red-400 text-xs ml-1.5 font-semibold">
              Clear
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Storage meter */}
      {storageInfo && storageInfo.total > 0 && (
        <View className="mx-5 mb-2">
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-zinc-500 text-[10px]">
              {formatBytes(storageInfo.free)} free of{" "}
              {formatBytes(storageInfo.total)}
            </Text>
            {(() => {
              const usedPct =
                storageInfo.total > 0
                  ? (storageInfo.total - storageInfo.free) / storageInfo.total
                  : 0;
              const color =
                usedPct > 0.9
                  ? colors.error
                  : usedPct > 0.8
                    ? colors.amber
                    : colors.successGreen;
              return (
                <Text
                  style={{
                    color,
                    fontSize: 9,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  {Math.round((storageInfo.free / storageInfo.total) * 100)}%
                  free
                </Text>
              );
            })()}
          </View>
          <View
            className="h-1 rounded-full overflow-hidden"
            style={{ backgroundColor: colors.progressTrack }}
          >
            <View
              className="h-full rounded-full"
              style={{
                width: `${Math.min(
                  ((storageInfo.total - storageInfo.free) /
                    Math.max(storageInfo.total, 1)) *
                    100,
                  100,
                )}%`,
                backgroundColor: (() => {
                  const usedPct =
                    (storageInfo.total - storageInfo.free) /
                    Math.max(storageInfo.total, 1);
                  return usedPct > 0.9
                    ? colors.error
                    : usedPct > 0.8
                      ? colors.amber
                      : colors.successGreen;
                })(),
              }}
            />
          </View>
        </View>
      )}

      {downloads.length === 0 ? (
        <EmptyState
          icon="download-outline"
          title="No downloads yet"
          message="Downloaded movies and shows will appear here."
          actionLabel="Browse Films"
          onAction={() => nav.push("/(tabs)")}
        />
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(item) => item.key}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => {
            if (item.type === "header") {
              const sectionKey = item.section;
              const count = item.count ?? 0;
              if (sectionKey === "active") {
                return (
                  <SectionRow
                    title="Downloading"
                    count={count}
                    action={() => control("pause", { status: "downloading" })}
                    actionLabel="Pause All"
                    actionColor={colors.gold}
                  />
                );
              }
              if (sectionKey === "paused") {
                return (
                  <SectionRow
                    title="Paused"
                    count={count}
                    action={() => control("resume", { status: "paused" })}
                    actionLabel="Resume All"
                    actionColor={colors.successGreen}
                  />
                );
              }
              if (sectionKey === "completed") {
                return (
                  <SectionRow
                    title="Completed"
                    count={count}
                    action={() => control("remove", { status: "completed" })}
                    actionLabel="Clear All"
                    actionColor={colors.error}
                  />
                );
              }
              if (sectionKey === "failed") {
                return (
                  <SectionRow
                    title="Failed"
                    count={count}
                    action={() => control("retry", { status: "failed" })}
                    actionLabel="Retry All"
                    actionColor={colors.gold}
                  />
                );
              }
              if (sectionKey === "cancelled") {
                return (
                  <SectionRow
                    title="Cancelled"
                    count={count}
                    action={() => control("remove", { status: "cancelled" })}
                    actionLabel="Clear All"
                    actionColor={colors.error}
                  />
                );
              }
              if (sectionKey === "retrying") {
                return (
                  <SectionRow
                    title="Retrying"
                    count={count}
                    action={() => control("cancel", { status: "retrying" })}
                    actionLabel="Cancel All"
                    actionColor={colors.error}
                  />
                );
              }
              return null;
            }

            if (item.type === "show") {
              return (
                <ShowGroupRow taskIds={item.ids} defaultExpanded={false} />
              );
            }

            return <TaskRow taskId={item.id} />;
          }}
        />
      )}
    </View>
  );
}
