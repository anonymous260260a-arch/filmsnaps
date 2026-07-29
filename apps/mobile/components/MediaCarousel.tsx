import React from "react";
import { View, Text, FlatList, useWindowDimensions } from "react-native";
import { typography } from "../theme/typography";
import { colors } from "../theme/colors";
import { SeeAllButton } from "./SeeAllButton";
import type { Movie } from "@filmsnaps/shared";
import { MediaCard } from "./MediaCard";

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
 */
export function MediaCarousel({
  title,
  data,
  onItemPress,
  onSeeAll,
}: MediaCarouselProps) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();

  if (!data?.length) return null;

  return (
    <View className="mb-7">
      {/* Section header â€” Playfair heading + gold "See All" */}
      <View className="flex-row items-center justify-between px-4 mb-3">
        <Text style={typography.heading}>{title}</Text>
        {onSeeAll && <SeeAllButton onPress={onSeeAll} />}
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => String(item.id)}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
        renderItem={({ item }) => (
          <View style={{ width: ITEM_WIDTH(SCREEN_WIDTH) }}>
            <MediaCard item={item} onPress={onItemPress} />
          </View>
        )}
      />
    </View>
  );
}
