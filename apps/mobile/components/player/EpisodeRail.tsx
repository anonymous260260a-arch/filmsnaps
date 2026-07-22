/**
 * EpisodeRail â€” Season/Episode picker bottom sheet modal for TV shows on mobile.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { getImageUrl } from '@filmsnaps/shared';
import { ProgressiveImage } from '../ProgressiveImage';
import { useSeasonEpisodes, useTVSeasonsOnly } from '../../hooks/useTMDB';
import { getProgress } from '../../lib/watchHistory';
import type { WatchProgress } from '../../lib/watchHistory';

interface EpisodeRailProps {
  visible: boolean;
  tvId: string | null;
  currentSeason: number;
  currentEpisode: number;
  onSelect: (season: number, episode: number) => void;
  onClose: () => void;
}

export function EpisodeRail({
  visible,
  tvId,
  currentSeason,
  currentEpisode,
  onSelect,
  onClose,
}: EpisodeRailProps) {
  const { height: SCREEN_HEIGHT } = Dimensions.get('window');
  const [pickerSeason, setPickerSeason] = useState(currentSeason);
  const nextUpFound = useRef(false);
  // Reset nextUp tracker when season changes
  useEffect(() => { nextUpFound.current = false; }, [pickerSeason]);

  const {
    data: seasonData,
    isLoading,
    isError,
  } = useSeasonEpisodes(tvId!, pickerSeason);
  const { data: tvData } = useTVSeasonsOnly(tvId!);

  const episodes = (seasonData?.episodes as any[]) ?? [];
  const seasons =
    (tvData?.seasons as any[])
      ?.filter((s: any) => s.season_number > 0 && s.episode_count > 0)
      ?.map((s: any) => s.season_number) ?? [];

  // Reset picker season when modal opens
  useEffect(() => {
    if (visible) {
      setPickerSeason(currentSeason);
    }
  }, [visible, currentSeason]);

  // â”€â”€ Load watch history for resume indicators â”€â”€
  const [episodeProgress, setEpisodeProgress] = useState<Record<string, WatchProgress>>({});
  useEffect(() => {
    if (!tvId || !visible) return;
    getProgress(tvId, 'tv', pickerSeason, 0).then(() => {
      (async () => {
        const map: Record<string, WatchProgress> = {};
        const eps = episodes;
        const results = await Promise.all(
          eps.map((ep: any) => {
            const epNum = ep.episode_number;
            if (!epNum) return Promise.resolve(null);
            return getProgress(tvId, 'tv', pickerSeason, epNum)
              .then(p => ({ epNum, p }));
          })
        );
        for (const r of results) {
          if (r && r.p) {
            map[`${pickerSeason}:${r.epNum}`] = r.p;
          }
        }
        setEpisodeProgress(map);
      })();
    }).catch(() => {});
  }, [tvId, pickerSeason, visible]);

  const SHEET_HEIGHT = SCREEN_HEIGHT * 0.4;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View className="flex-1 justify-end bg-black/60">
        <TouchableOpacity className="flex-1" activeOpacity={1} onPress={onClose} />

        <View
          className="bg-zinc-900 rounded-t-2xl"
          style={{ height: SHEET_HEIGHT, paddingBottom: 8 }}
        >
          {/* Handle */}
          <View className="items-center py-2">
            <View className="w-8 h-0.5 rounded-full bg-zinc-600" />
          </View>

          {/* Season pills */}
          {seasons.length > 0 && (
            <View className="pb-2 border-b border-zinc-800/50">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}
              >
                {seasons.map((s: number) => (
                  <TouchableOpacity
                    key={s}
                    onPress={() => setPickerSeason(s)}
                    activeOpacity={0.7}
                    className={`px-3.5 py-1.5 rounded-full ${
                      s === pickerSeason
                        ? 'bg-primary'
                        : 'bg-zinc-800 border border-zinc-700/40'
                    }`}
                  >
                    <Text
                      className={`text-[11px] font-bold ${
                        s === pickerSeason ? 'text-black' : 'text-zinc-300'
                      }`}
                    >
                      Season {s}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Episode list */}
          {isLoading ? (
            <View className="items-center justify-center py-6">
              <ActivityIndicator size="small" color="#D4A237" />
              <Text className="text-zinc-500 text-xs mt-2">Loading episodes...</Text>
            </View>
          ) : isError ? (
            <View className="items-center justify-center py-8 px-6">
              <Ionicons name="alert-circle-outline" size={24} color="#ef4444" />
              <Text className="text-zinc-400 text-xs mt-2 text-center">
                Failed to load episodes
              </Text>
            </View>
          ) : episodes.length === 0 ? (
            <View className="items-center justify-center py-8">
              <Ionicons name="tv-outline" size={24} color="#52525b" />
              <Text className="text-zinc-600 text-xs mt-2">No episodes for this season</Text>
            </View>
          ) : (
            <ScrollView
              className="flex-1 px-3 pt-1.5"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              {episodes.map((ep: any, index: number) => {
                const epNum = ep.episode_number;
                const isActive = pickerSeason === currentSeason && epNum === currentEpisode;
                const progKey = `${pickerSeason}:${epNum}`;
                const epProg = episodeProgress[progKey];
                const hasProgress = epProg && !epProg.completed && epProg.percent > 0.05;
                const isCompleted = epProg?.completed;
                const isNextUp = !isActive && !isCompleted && !hasProgress && !nextUpFound.current;
                if (isNextUp) nextUpFound.current = true;

                return (
                  <TouchableOpacity
                    key={ep.id ?? index}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelect(pickerSeason, epNum ?? 1); }}
                    activeOpacity={0.7}
                    className={`flex-row rounded-lg overflow-hidden mb-1.5 ${
                      isActive
                        ? 'bg-primary/10 border border-amber-500/20'
                        : isNextUp
                          ? 'bg-zinc-800/40 border-l-2 border-l-primary'
                          : 'bg-zinc-800/40'
                    }`}
                  >
                    {/* Thumbnail */}
                    <View className="w-[88px] bg-zinc-800">
                      <View className="aspect-[16/9]">
                        {ep.still_path ? (
                          <ProgressiveImage
                            uri={getImageUrl(ep.still_path, 'w300')}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View className="w-full h-full items-center justify-center">
                            <Ionicons name="tv-outline" size={16} color="#52525b" />
                          </View>
                        )}
                        {isActive && (
                          <View className="absolute inset-0 items-center justify-center">
                            <View className="w-5 h-5 rounded-full bg-primary items-center justify-center">
                              <Ionicons name="play" size={8} color="#000" />
                            </View>
                          </View>
                        )}
                        {hasProgress && !isActive && (
                          <View className="absolute bottom-0 left-0 right-0">
                            <View className="h-0.5 bg-zinc-700/80">
                              <View
                                className="h-full bg-primary"
                                style={{ width: `${Math.round(epProg.percent * 100)}%` }}
                              />
                            </View>
                            <View className="bg-black/70 px-1 py-0.5">
                              <Text className="text-primary text-[8px] font-bold">
                                {Math.round(epProg.percent * 100)}%
                              </Text>
                            </View>
                          </View>
                        )}
                        {isCompleted && !isActive && (
                          <View className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-green-600 items-center justify-center">
                            <Ionicons name="checkmark" size={10} color="#fff" />
                          </View>
                        )}
                      </View>
                    </View>

                    {/* Info */}
                    <View className="flex-1 px-2.5 py-1.5 justify-center">
                      <Text
                        className="text-white text-[13px] font-bold leading-tight"
                        numberOfLines={1}
                      >
                        {ep.name || `Episode ${epNum ?? index + 1}`}
                      </Text>
                      <View className="flex-row items-center gap-1 mt-0.5">
                        <Text className="text-zinc-400 text-[10px] font-semibold">
                          E{String(epNum ?? index + 1).padStart(2, '0')}
                        </Text>
                        {isNextUp && (
                          <View className="bg-primary/20 px-1.5 py-0.5 rounded-full">
                            <Text className="text-primary text-[8px] font-bold">Next Up</Text>
                          </View>
                        )}
                        {ep.runtime ? (
                          <>
                            <Text className="text-zinc-600 text-[10px]">Â·</Text>
                            <Text className="text-zinc-400 text-[10px]">{ep.runtime}m</Text>
                          </>
                        ) : null}
                        {ep.air_date ? (
                          <>
                            <Text className="text-zinc-600 text-[10px]">Â·</Text>
                            <Text className="text-zinc-500 text-[10px]">{ep.air_date}</Text>
                          </>
                        ) : null}
                      </View>
                      {ep.overview ? (
                        <Text
                          className="text-zinc-500 text-[10px] leading-tight mt-0.5"
                          numberOfLines={2}
                        >
                          {ep.overview}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
