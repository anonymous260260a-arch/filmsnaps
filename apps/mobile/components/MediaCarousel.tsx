import React, { useEffect } from "react";
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

const ITEM_WIDTH = (width: number) => (width - 48) / 3;

interface MediaCarouselProps {
  title: string;
  data: Movie[];
  onItemPress: (item: Movie) => void;
  onSeeAll?: () => void;
}

/**
 * Horizontal carousel with Playfair Display section heading
 * and gold "See All" link.
 *
 * Registers its horizontal FlatList's native scroll gesture with the root
 * SwipeTabNavigator, so a drag on this carousel scrolls it instead of cycling
 * tabs (and never dead-zones the scroll).
 */
export function MediaCarousel({
  title,
  data,
  onItemPress,
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
          keyExtractor={(item) => String(item.id)}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
          renderItem={({ item }: ListRenderItemInfo<Movie>) => (
            <View style={{ width: ITEM_WIDTH(SCREEN_WIDTH) }}>
              <MediaCard item={item} onPress={onItemPress} />
            </View>
          )}
        />
      </GestureDetector>
    </View>
  );
}
