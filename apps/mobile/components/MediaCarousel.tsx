import React, { useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  useWindowDimensions,
  type ListRenderItemInfo,
} from "react-native";
import { typography } from "../theme/typography";
import { colors } from "../theme/colors";
import { SeeAllButton } from "./SeeAllButton";
import type { Movie } from "@filmsnaps/shared";
import { MediaCard } from "./MediaCard";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSwipeTabNavigator } from "./SwipeTabNavigator";

const ITEM_GAP = 10;
const ITEM_PADDING = 16;
const itemWidth = (width: number) => (width - 48) / 3;

interface MediaCarouselProps {
  title: string;
  data: Movie[];
  onItemPress: (item: Movie) => void;
  onItemPressIn?: (item: Movie) => void;
  onSeeAll?: () => void;
}

/** D5: memoized row — skips re-render of offscreen posters on parent state. */
const MediaCarouselRow = React.memo(function MediaCarouselRow({
  item,
  width,
  onItemPress,
  onItemPressIn,
}: {
  item: Movie;
  width: number;
  onItemPress: (item: Movie) => void;
  onItemPressIn?: (item: Movie) => void;
}) {
  return (
    <View style={{ width: itemWidth(width), marginRight: ITEM_GAP }}>
      <MediaCard
        item={item}
        onPress={onItemPress}
        onPressIn={onItemPressIn}
      />
    </View>
  );
});

/**
 * Horizontal carousel with Playfair Display section heading
 * and gold "See All" link.
 *
 * Registers its horizontal FlatList's native scroll gesture with the root
 * SwipeTabNavigator, so a drag on this carousel scrolls it instead of cycling
 * tabs (and never dead-zones the scroll).
 *
 * D5: fixed item geometry + getItemLayout + memoized rows — kills the
 * VirtualizedList content-length recalcs seen on detail scroll (3.2s jank).
 */
export function MediaCarousel({
  title,
  data,
  onItemPress,
  onItemPressIn,
  onSeeAll,
}: MediaCarouselProps) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const swipeTab = useSwipeTabNavigator();

  // The native scroll gesture that must be exempted from tab navigation.
  // Created once per carousel instance.
  const nativeGesture = React.useMemo(() => Gesture.Native(), []);

  useEffect(() => {
    if (!swipeTab) return;
    return swipeTab.registerCarousel(nativeGesture);
  }, [swipeTab, nativeGesture]);

  const w = itemWidth(SCREEN_WIDTH);
  const step = w + ITEM_GAP;

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: w,
      offset: step * index,
      index,
    }),
    [w, step],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Movie>) => (
      <MediaCarouselRow
        item={item}
        width={SCREEN_WIDTH}
        onItemPress={onItemPress}
        onItemPressIn={onItemPressIn}
      />
    ),
    [SCREEN_WIDTH, onItemPress, onItemPressIn],
  );

  const keyExtractor = useCallback((item: Movie) => String(item.id), []);

  if (!data?.length) return null;

  return (
    <View className="mb-7">
      {/* Section header — Playfair heading + gold "See All" */}
      <View className="flex-row items-center justify-between px-4 mb-3">
        <Text style={typography.heading}>{title}</Text>
        {onSeeAll && <SeeAllButton onPress={onSeeAll} />}
      </View>

      <GestureDetector gesture={nativeGesture}>
        <FlatList
          data={data}
          keyExtractor={keyExtractor}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: ITEM_PADDING,
            paddingRight: ITEM_PADDING,
          }}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={5}
          removeClippedSubviews
        />
      </GestureDetector>
    </View>
  );
}
