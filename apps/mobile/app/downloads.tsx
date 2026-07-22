/**
 * Downloads — Full-screen download manager.
 *
 * Shows all download tasks grouped by status (active, paused, completed,
 * failed) with real-time progress, pause/resume, and file management.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useDownloadList, useDownload, formatBytes, formatDate, serverLabel } from '../lib/download';
import type { DownloadTask } from '../lib/download';

// ── Empty State ──

function EmptyState({ onBrowse }: { onBrowse: () => void }) {
  return (
    <View className="flex-1 items-center justify-center px-8" style={{ paddingBottom: 80 }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: '#16161A',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <Ionicons name="download-outline" size={28} color="#52525B" />
      </View>
      <Text
        style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: '#F4F4F5', marginBottom: 8 }}
      >
        No downloads yet
      </Text>
      <Text className="text-zinc-500 text-sm text-center leading-5">
        Downloaded movies and shows will appear here.
      </Text>
      <TouchableOpacity
        onPress={onBrowse}
        className="bg-primary rounded-xl py-3 px-8 mt-6"
        activeOpacity={0.8}
      >
        <Text className="text-void font-bold text-sm">Browse Films</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Progress Bar ──

function ProgressBar({ fraction, color = '#D4A237' }: { fraction: number; color?: string }) {
  const w = Math.min(Math.max(fraction * 100, 0), 100);
  return (
    <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#222226' }}>
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
  if (bytesPerSec <= 0) return '';
  if (bytesPerSec >= 1_048_576) return `${(bytesPerSec / 1_048_576).toFixed(1)} MB/s`;
  return `${Math.round(bytesPerSec / 1024)} KB/s`;
}

function formatETA(remainingBytes: number, bytesPerSec: number): string {
  if (bytesPerSec <= 0 || remainingBytes <= 0) return '';
  const secs = remainingBytes / bytesPerSec;
  if (secs < 60) return `${Math.round(secs)}s remaining`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s remaining`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m remaining`;
}

// ── Task Row ──

function TaskRow({ taskId }: { taskId: string }) {
  const { task, progress, pause, resume, cancel, retry, remove } = useDownload(taskId);
  const speedSamples = useRef<SpeedSample[]>([]);

  if (!task) return null;

  const { status, fileName, quality, server, totalBytes, receivedBytes, error, fileUri, createdAt, title } = task;
  const pct = Math.round(progress * 100);

  // Track speed from receivedBytes changes over time
  const speedBytesPerSec = useMemo(() => {
    if (status !== 'downloading' || receivedBytes <= 0) return 0;

    const now = Date.now();
    // Remove samples older than 5 seconds
    speedSamples.current = speedSamples.current.filter((s) => now - s.ts < 5000);
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
  const etaLabel = (status === 'downloading' && totalBytes > 0)
    ? formatETA(totalBytes - receivedBytes, speedBytesPerSec)
    : '';

  return (
    <View
      className="rounded-xl mb-2 overflow-hidden"
      style={{ backgroundColor: '#141414', borderWidth: 0.5, borderColor: '#1f1f1f' }}
    >
      {/* Info row */}
      <View className="px-3 pt-3 pb-2">
        {/* Title + metadata */}
        <View className="flex-row items-start justify-between">
          <View className="flex-1 mr-3">
            <Text className="text-zinc-200 text-sm font-bold leading-tight" numberOfLines={2}>
              {title || fileName}
            </Text>
            <View className="flex-row items-center gap-2 mt-1">
              <View className="bg-zinc-800 rounded-sm px-1.5 py-0.5">
                <Text className="text-zinc-400 text-[9px] font-semibold">{serverLabel(server)}</Text>
              </View>
              {quality && (
                <Text className="text-zinc-500 text-[10px]">{quality}</Text>
              )}
              {fileName !== title && (
                <Text className="text-zinc-600 text-[9px]" numberOfLines={1}>{fileName}</Text>
              )}
            </View>
          </View>
        </View>

        {/* Active: progress bar */}
        {(status === 'downloading' || status === 'pending') && (
          <View className="mt-2">
            <ProgressBar fraction={status === 'pending' ? 0 : progress} color={status === 'pending' ? '#52525B' : '#D4A237'} />
            <View className="flex-row justify-between mt-1">
              <Text className="text-zinc-500 text-[10px]">
                {status === 'pending'
                  ? 'Starting...'
                  : `${formatBytes(receivedBytes)} / ${formatBytes(totalBytes || 1)}`}
              </Text>
              <Text className="text-zinc-500 text-[10px]">{pct}%</Text>
            </View>
            {/* Speed + ETA row */}
            {status === 'downloading' && (speedLabel || etaLabel) && (
              <View className="flex-row items-center mt-1">
                {speedLabel ? (
                  <View className="flex-row items-center mr-3">
                    <Ionicons name="speedometer-outline" size={10} color="#52525b" />
                    <Text className="text-zinc-500 text-[10px] ml-1">{speedLabel}</Text>
                  </View>
                ) : null}
                {etaLabel ? (
                  <View className="flex-row items-center">
                    <Ionicons name="time-outline" size={10} color="#52525b" />
                    <Text className="text-zinc-500 text-[10px] ml-1">{etaLabel}</Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>
        )}

        {/* Paused: progress bar + resume CTA */}
        {status === 'paused' && (
          <View className="mt-2">
            <ProgressBar fraction={progress} color="#52525B" />
            <View className="flex-row justify-between mt-1">
              <Text className="text-zinc-500 text-[10px]">
                Paused · {formatBytes(receivedBytes)} / {formatBytes(totalBytes || 1)}
              </Text>
              <Text className="text-amber-400 text-[10px] font-semibold">{pct}%</Text>
            </View>
          </View>
        )}

        {/* Completed */}
        {status === 'completed' && (
          <View className="flex-row items-center gap-1 mt-1">
            <Ionicons name="checkmark-circle" size={12} color="#22c55e" />
            <Text className="text-green-500 text-[10px] font-semibold">
              Saved · {fileUri ? formatBytes(totalBytes) : 'Unknown size'}
            </Text>
          </View>
        )}

        {/* Failed */}
        {status === 'failed' && (
          <View className="mt-1 flex-row items-center gap-1">
            <Ionicons name="alert-circle" size={12} color="#ef4444" />
            <Text className="text-red-400 text-[10px] flex-1" numberOfLines={2}>
              {error || 'Download failed'}
            </Text>
          </View>
        )}

        {/* Cancelled */}
        {status === 'cancelled' && (
          <View className="flex-row items-center gap-1 mt-1">
            <Ionicons name="close-circle" size={12} color="#a1a1aa" />
            <Text className="text-zinc-400 text-[10px]">Cancelled</Text>
          </View>
        )}

        {/* Date */}
        <Text className="text-zinc-600 text-[9px] mt-1">{formatDate(createdAt)}</Text>
      </View>

      {/* Action buttons */}
      <View
        className="flex-row border-t px-3 py-2"
        style={{ borderTopColor: '#1f1f1f', backgroundColor: '#111' }}
      >
        {/* Active / Pending */}
        {(status === 'downloading' || status === 'pending') && (
          <>
            <TaskAction icon="pause-circle-outline" label="Pause" color="#D4A237" onPress={pause} />
            <TaskAction icon="close-circle-outline" label="Cancel" color="#ef4444" onPress={cancel} />
          </>
        )}

        {/* Paused */}
        {status === 'paused' && (
          <>
            <TaskAction icon="play-circle-outline" label="Resume" color="#22c55e" onPress={resume} />
            <TaskAction icon="close-circle-outline" label="Cancel" color="#ef4444" onPress={cancel} />
          </>
        )}

        {/* Completed */}
        {status === 'completed' && (
          <>
            <TaskAction
              icon="play-circle-outline"
              label="VLC"
              color="#D4A237"
              onPress={() => openInVLC(fileUri)}
            />
            <TaskAction
              icon="share-outline"
              label="Share"
              color="#5b9cf6"
              onPress={() => handleShare(fileUri, fileName)}
            />
            <TaskAction icon="trash-outline" label="Delete" color="#ef4444" onPress={() => handleDelete(task, remove)} />
          </>
        )}

        {/* Failed */}
        {status === 'failed' && (
          <>
            <TaskAction icon="refresh-outline" label="Retry" color="#D4A237" onPress={retry} />
            <TaskAction icon="trash-outline" label="Remove" color="#a1a1aa" onPress={remove} />
          </>
        )}

        {/* Cancelled */}
        {status === 'cancelled' && (
          <>
            <TaskAction icon="refresh-outline" label="Retry" color="#D4A237" onPress={resume} />
            <TaskAction icon="trash-outline" label="Remove" color="#a1a1aa" onPress={remove} />
          </>
        )}
      </View>
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
      className="flex-row items-center mr-4 py-1 px-2 rounded-md"
      style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
    >
      <Ionicons name={icon} size={14} color={color} />
      <Text className="text-xs font-semibold ml-1.5" style={{ color }}>{label}</Text>
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
          style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
        >
          <Text className="text-zinc-500 text-[10px] font-bold">{count}</Text>
        </View>
      </View>
      {action && actionLabel && (
        <TouchableOpacity onPress={action} activeOpacity={0.7} className="flex-row items-center">
          <Ionicons name="play" size={10} color={actionColor || '#22c55e'} />
          <Text className="text-xs font-semibold ml-1" style={{ color: actionColor || '#22c55e' }}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Share / VLC / Delete handlers (unchanged from original) ──

async function handleShare(fileUri: string | null, fileName: string) {
  if (!fileUri) return;
  try {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
      return;
    }
    await Sharing.shareAsync(fileUri, {
      mimeType: 'video/mp4',
      dialogTitle: `Share ${fileName}`,
    });
  } catch (e: any) {
    Alert.alert('Share failed', e.message);
  }
}

function handleDelete(task: DownloadTask, onDelete: () => void) {
  Alert.alert(
    'Delete Download',
    `Remove "${task.title || task.fileName}" from your device?`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ],
  );
}

async function openInVLC(fileUri: string | null) {
  if (!fileUri) return;
  try {
    if (Platform.OS === 'android') {
      const path = fileUri.replace(/^file:\/\//, '');
      const intentUrl = `intent://${path}#Intent;package=org.videolan.vlc;action=android.intent.action.VIEW;type=video/*;end`;
      await Linking.openURL(intentUrl);
    } else {
      await Linking.openURL(`vlc://${fileUri}`);
    }
  } catch {
    Alert.alert(
      'VLC Not Installed',
      'VLC for Mobile is required. Would you like to install it?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Install',
          onPress: () =>
            Linking.openURL(
              Platform.select({
                android: 'https://play.google.com/store/apps/details?id=org.videolan.vlc',
                ios: 'https://apps.apple.com/app/vlc-for-mobile/id650377962',
                default: 'https://www.videolan.org/vlc/',
              })!,
            ),
        },
      ],
    );
  }
}

// ── Main Screen ──

export default function DownloadsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    all: downloads,
    active,
    paused,
    completed,
    failed,
    cancelled,
    loaded,
    control,
  } = useDownloadList();

  const renderTask = useCallback(({ item }: { item: string }) => {
    return <TaskRow taskId={item} />;
  }, []);

  const keyExtractor = useCallback((item: string) => item, []);

  // Build sectioned flatlist data with just IDs for efficient rendering
  const sections = useMemo(() => {
    const items: Array<{ type: 'header' | 'id'; key: string; section?: string }> = [];

    if (active.length > 0) {
      items.push({ type: 'header', key: 'active-header' });
      active.forEach((t) => items.push({ type: 'id', key: `a-${t.id}`, section: 'active' }));
    }
    if (paused.length > 0) {
      items.push({ type: 'header', key: 'paused-header' });
      paused.forEach((t) => items.push({ type: 'id', key: `p-${t.id}`, section: 'paused' }));
    }
    if (completed.length > 0) {
      items.push({ type: 'header', key: 'completed-header' });
      completed.forEach((t) => items.push({ type: 'id', key: `c-${t.id}`, section: 'completed' }));
    }
    if (failed.length > 0) {
      items.push({ type: 'header', key: 'failed-header' });
      failed.forEach((t) => items.push({ type: 'id', key: `f-${t.id}`, section: 'failed' }));
    }
    if (cancelled.length > 0) {
      items.push({ type: 'header', key: 'cancelled-header' });
      cancelled.forEach((t) => items.push({ type: 'id', key: `x-${t.id}`, section: 'cancelled' }));
    }

    return items;
  }, [active, paused, completed, failed, cancelled]);

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: '#070708', paddingTop: insets.top }}>
        <ActivityIndicator size="large" color="#D4A237" />
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: '#070708', paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-5 pt-4 pb-2 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={() => { try { if (router.canGoBack()) router.back(); else router.push('/'); } catch {} }}
            className="w-9 h-9 rounded-full bg-zinc-800/60 items-center justify-center mr-3"
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={20} color="#F4F4F5" />
          </TouchableOpacity>
          <Text style={{ fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: '#F4F4F5' }}>
            Downloads
          </Text>
        </View>
        {downloads.length > 0 && (
          <TouchableOpacity
            onPress={() =>
              Alert.alert('Clear Completed', 'Remove all completed and cancelled downloads from the list?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Clear', style: 'destructive', onPress: () => control('remove', { status: 'completed' }) },
              ])
            }
            activeOpacity={0.7}
            className="flex-row items-center"
          >
            <Ionicons name="trash-outline" size={16} color="#ef4444" />
            <Text className="text-red-400 text-xs ml-1.5 font-semibold">Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {downloads.length === 0 ? (
        <EmptyState onBrowse={() => router.push('/')} />
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(item) => item.key}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => {
            if (item.type === 'header') {
              const sectionKey = sections[index + 1]?.section;
              if (sectionKey === 'active') {
                return (
                  <SectionRow
                    title="Downloading"
                    count={active.length}
                    action={() => control('pause', { status: 'downloading' })}
                    actionLabel="Pause All"
                    actionColor="#D4A237"
                  />
                );
              }
              if (sectionKey === 'paused') {
                return (
                  <SectionRow
                    title="Paused"
                    count={paused.length}
                    action={() => control('resume', { status: 'paused' })}
                    actionLabel="Resume All"
                    actionColor="#22c55e"
                  />
                );
              }
              if (sectionKey === 'completed') {
                return (
                  <SectionRow
                    title="Completed"
                    count={completed.length}
                    action={() => control('remove', { status: 'completed' })}
                    actionLabel="Clear All"
                    actionColor="#ef4444"
                  />
                );
              }
              if (sectionKey === 'failed') {
                return (
                  <SectionRow
                    title="Failed"
                    count={failed.length}
                    action={() => control('retry', { status: 'failed' })}
                    actionLabel="Retry All"
                    actionColor="#D4A237"
                  />
                );
              }
              if (sectionKey === 'cancelled') {
                return <SectionRow title="Cancelled" count={cancelled.length} />;
              }
              return null;
            }

            const taskId = item.key.replace(/^(a-|p-|c-|f-|x-)/, '');
            return <TaskRow taskId={taskId} />;
          }}
        />
      )}
    </View>
  );
}
