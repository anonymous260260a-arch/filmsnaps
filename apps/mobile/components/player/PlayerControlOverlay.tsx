/**
 * PlayerControlOverlay — glassmorphism overlay with player controls for mobile.
 *
 * Features: close/back, season/episode badge, server switcher, fullscreen toggle,
 * server info pill at bottom, loading state, tap-to-reveal in fullscreen.
 */

import React, { useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface PlayerControlOverlayProps {
  isFullscreen: boolean;
  isTV: boolean;
  loading: boolean;
  overlayVisible: boolean;
  showOverlay: () => void;
  overlayOpacity: Animated.Value;
  onClose: () => void;
  onToggleFullscreen: () => void;
  onServerPickerOpen: () => void;
  onEpisodePickerOpen: () => void;
  currentSeason: number;
  currentEpisode: number;
  providerDisplayName: string;
  providerId: string;
  auditMode: boolean;
}

// ── Component ──

export function PlayerControlOverlay({
  isFullscreen,
  isTV,
  loading,
  overlayVisible,
  showOverlay,
  overlayOpacity,
  onClose,
  onToggleFullscreen,
  onServerPickerOpen,
  onEpisodePickerOpen,
  currentSeason,
  currentEpisode,
  providerDisplayName,
  providerId,
  auditMode,
}: PlayerControlOverlayProps) {
  const insets = useSafeAreaInsets();
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

  return (
    <>
      {/* ── Animated overlay bar (fades in/out) ── */}
      <Animated.View
        className="absolute top-0 left-0 right-0 z-30"
        style={{ opacity: overlayOpacity, paddingTop: insets.top + 4 }}
        pointerEvents={overlayVisible ? 'box-none' : 'none'}
      >
        <View className="flex-row items-center justify-between px-4">
          {/* Close / Shrink button (top left) */}
          <TouchableOpacity
            onPress={isFullscreen ? onToggleFullscreen : onClose}
            className="w-9 h-9 rounded-full bg-black/40 items-center justify-center"
            activeOpacity={0.7}
            style={{ pointerEvents: 'auto' }}
          >
            <Ionicons
              name={isFullscreen ? 'contract' : 'chevron-down'}
              size={20}
              color="#fff"
            />
          </TouchableOpacity>

          {/* Center: Title or Season/Episode badge (for TV) */}
          {isTV && !isFullscreen && (
            <TouchableOpacity
              onPress={onEpisodePickerOpen}
              activeOpacity={0.7}
              style={{ pointerEvents: 'auto' }}
            >
              <View className="bg-black/60 rounded-full px-3 py-1.5 border border-amber-500/30 flex-row items-center">
                <Text className="text-white text-xs font-bold">
                  S{String(currentSeason).padStart(2, '0')}:E{String(currentEpisode).padStart(2, '0')}
                </Text>
                <Ionicons name="chevron-down" size={12} color="#a1a1aa" style={{ marginLeft: 4 }} />
              </View>
            </TouchableOpacity>
          )}

          {/* Right group: Server switcher + Fullscreen */}
          <View className="flex-row items-center gap-2" style={{ pointerEvents: 'auto' }}>
            <TouchableOpacity
              onPress={onServerPickerOpen}
              className="w-9 h-9 rounded-full bg-black/40 items-center justify-center"
              activeOpacity={0.7}
            >
              <Ionicons name="server" size={16} color="#D4A237" />
            </TouchableOpacity>
            {providerId !== 'nxsha' && providerId !== 'chillflix' && (
              <TouchableOpacity
                onPress={onToggleFullscreen}
                className="w-9 h-9 rounded-full bg-black/40 items-center justify-center"
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isFullscreen ? 'contract' : 'expand'}
                  size={20}
                  color="#fff"
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Animated.View>

      {/* ── Server pill (bottom) — also fades with overlay ── */}
      <Animated.View
        className="absolute bottom-0 left-0 right-0 z-30 px-4"
        style={{ opacity: overlayOpacity, paddingBottom: insets.bottom + 12 }}
        pointerEvents={overlayVisible ? 'box-none' : 'none'}
      >
        <TouchableOpacity
          onPress={onServerPickerOpen}
          activeOpacity={0.8}
          className="self-center bg-black/60 backdrop-blur-md rounded-full px-4 py-2.5 flex-row items-center border border-zinc-700/40"
          style={{ pointerEvents: 'auto' }}
        >
          <Ionicons name="server" size={13} color="#D4A237" />
          <Text className="text-white text-xs font-semibold ml-2 mr-1" numberOfLines={1}>
            {providerDisplayName}
          </Text>
          {auditMode && (
            <View className="bg-amber-500/20 rounded px-1.5 py-0.5 mr-1">
              <Text className="text-amber-400 text-[9px] font-bold tracking-wider">AUDIT</Text>
            </View>
          )}
          <Ionicons name="chevron-up" size={14} color="#71717a" />
        </TouchableOpacity>
      </Animated.View>

      {/* ── Loading overlay ── */}
      {loading && (
        <View className="absolute inset-0 z-20 items-center justify-center bg-black/80">
          <View className="items-center">
            <ActivityIndicator size="large" color="#D4A237" />
            <Text className="text-zinc-500 text-sm mt-4">Loading player...</Text>
          </View>
        </View>
      )}

      {/* ── Tap-to-reveal layer (only in fullscreen when overlay is hidden) ── */}
      {isFullscreen && !overlayVisible && (
        <TouchableOpacity
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 25,
          }}
          activeOpacity={1}
          onPress={showOverlay}
        />
      )}
    </>
  );
}
