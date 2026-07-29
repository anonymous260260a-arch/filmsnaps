/**
 * Home Layout — drag-to-reorder + up/down button reordering for home page sections.
 *
 * Hero is always first (excluded from this list). The remaining sections can be
 * rearranged by dragging or using the up/down buttons.
 *
 * Performance: uses local state + React.memo to avoid context re-renders during
 * drag operations. Persists via updateSetting only on drag end or button press.
 */

import React, { useCallback, useMemo, useState, memo } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSafeNavigation } from "@/lib/navigation";
import DraggableFlatList, {
  type RenderItemParams,
} from "react-native-draggable-flatlist";
import { useSettings } from "../lib/settings";
import { colors } from "../theme/colors";

const SECTION_META: Record<
  string,
  { label: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  "trending-movies": {
    label: "Trending Movies",
    subtitle: "Today's trending movies",
    icon: "flame",
  },
  "trending-tv": {
    label: "Trending TV",
    subtitle: "Today's trending TV shows",
    icon: "tv",
  },
  "more-like-this": {
    label: "More Like This",
    subtitle: "Genre-based recommendations",
    icon: "layers",
  },
  "continue-watching": {
    label: "Continue Watching",
    subtitle: "Your watch history",
    icon: "time",
  },
  "popular-movies": {
    label: "Popular Movies",
    subtitle: "Most popular movies",
    icon: "trending-up",
  },
};

const SECTION_IDS = Object.keys(SECTION_META);
const ROW_HEIGHT = 68;

// ── Row item — memoized to avoid re-renders during drag ──

interface RowProps {
  item: string;
  index: number;
  isActive: boolean;
  drag: () => void;
  listLength: number;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

const Row = memo(function Row({
  item,
  index,
  isActive,
  drag,
  listLength,
  onMoveUp,
  onMoveDown,
}: RowProps) {
  const meta = SECTION_META[item];
  if (!meta) return null;

  const isFirst = index === 0;
  const isLast = index === listLength - 1;

  return (
    <TouchableOpacity
      onLongPress={drag}
      delayLongPress={120}
      activeOpacity={0.8}
      disabled={isActive}
      style={{
        backgroundColor: isActive ? colors.bgActiveDrag : colors.bgSurface,
        height: ROW_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderZinc,
      }}
    >
      {/* Drag handle */}
      <View className="mr-3">
        <Ionicons name="menu" size={20} color={colors.textTertiary} />
      </View>

      {/* Section icon */}
      <View
        className="w-9 h-9 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: colors.zincBg }}
      >
        <Ionicons name={meta.icon} size={16} color={colors.gold} />
      </View>

      {/* Label + subtitle */}
      <View className="flex-1">
        <Text
          className="text-sm font-semibold"
          style={{ color: colors.textPrimary, fontFamily: "Inter_600SemiBold" }}
        >
          {meta.label}
        </Text>
        <Text className="text-xs mt-0.5" style={{ color: colors.textTertiary }}>
          {meta.subtitle}
        </Text>
      </View>

      {/* Up / Down buttons */}
      <View className="flex-row items-center ml-2" style={{ gap: 6 }}>
        <TouchableOpacity
          onPress={() => onMoveUp(index)}
          disabled={isFirst}
          activeOpacity={0.6}
          className="w-8 h-8 rounded-full items-center justify-center"
          style={{ backgroundColor: isFirst ? colors.bgSurface : colors.bgTop }}
        >
          <Ionicons
            name="chevron-up"
            size={16}
            color={isFirst ? colors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onMoveDown(index)}
          disabled={isLast}
          activeOpacity={0.6}
          className="w-8 h-8 rounded-full items-center justify-center"
          style={{ backgroundColor: isLast ? colors.bgSurface : colors.bgTop }}
        >
          <Ionicons
            name="chevron-down"
            size={16}
            color={isLast ? colors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
});

// ── Main screen ──

export default function HomeLayoutScreen() {
  const nav = useSafeNavigation();
  const insets = useSafeAreaInsets();
  const { settings, updateSetting } = useSettings();

  // Local state so drags + button presses feel instant
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);

  const order = localOrder ?? settings.homeRowOrder;
  const listLength = order.length;

  const persistOrder = useCallback(
    (next: string[]) => {
      setLocalOrder(next);
      updateSetting("homeRowOrder", next);
    },
    [updateSetting],
  );

  const moveUp = useCallback(
    (index: number) => {
      if (index === 0) return;
      const next = [...order];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      persistOrder(next);
    },
    [order, persistOrder],
  );

  const moveDown = useCallback(
    (index: number) => {
      if (index === listLength - 1) return;
      const next = [...order];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      persistOrder(next);
    },
    [order, listLength, persistOrder],
  );

  const onDragEnd = useCallback(
    ({ data }: { data: string[] }) => {
      persistOrder(data);
    },
    [persistOrder],
  );

  // Stable renderItem — only depends on stable callbacks + listLength
  const renderItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<string>) => {
      const index = getIndex() ?? 0;
      return (
        <Row
          item={item}
          index={index}
          isActive={isActive}
          drag={drag}
          listLength={listLength}
          onMoveUp={moveUp}
          onMoveDown={moveDown}
        />
      );
    },
    [listLength, moveUp, moveDown],
  );

  const keyExtractor = useCallback((item: string) => item, []);

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      {/* Header */}
      <View className="px-5 pt-4 pb-2 flex-row items-center">
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          className="w-9 h-9 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: colors.zincBg }}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 22,
            color: colors.textPrimary,
          }}
        >
          Home Layout
        </Text>
      </View>

      <View
        className="w-16 h-0.5 mb-2 ml-5"
        style={{ backgroundColor: colors.gold }}
      />

      <Text
        className="text-xs px-5 mb-4"
        style={{ color: colors.textTertiary }}
      >
        Long-press and drag to reorder, or use the up/down arrows
      </Text>

      <DraggableFlatList
        data={order}
        onDragEnd={onDragEnd}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        containerStyle={{
          marginHorizontal: 16,
          borderRadius: 12,
          overflow: "hidden",
          borderWidth: 0.5,
          borderColor: colors.border,
        }}
        removeClippedSubviews
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
      />
    </View>
  );
}
