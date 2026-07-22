import React from 'react';
import { View, useWindowDimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PULSE_DURATION = 1600;

function ShimmerBar({ width, height, borderRadius = 4, style }: { width: number | string; height: number; borderRadius?: number; style?: any }) {
  return (
    <View
      style={{
        width: width as any,
        height,
        borderRadius,
        backgroundColor: '#1C1C20',
        overflow: 'hidden',
        ...style,
      }}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(255,255,255,0.04)',
          opacity: 0.5,
        }}
      />
    </View>
  );
}

/**
 * Skeleton loading state for movie/TV detail screens.
 * Matches the actual layout: backdrop + poster + info + overview + buttons + cast.
 */
export function DetailSkeleton() {
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const BACKDROP_HEIGHT = SCREEN_HEIGHT * 0.45;
  const POSTER_WIDTH = 100;

  return (
    <View style={{ flex: 1, backgroundColor: '#070708', paddingTop: insets.top }}>
      {/* Backdrop skeleton */}
      <ShimmerBar
        width={SCREEN_WIDTH}
        height={BACKDROP_HEIGHT}
        borderRadius={0}
        style={{ backgroundColor: '#141414' }}
      />

      {/* Back button skeleton */}
      <View style={{ position: 'absolute', top: insets.top + 12, left: 16 }}>
        <ShimmerBar width={80} height={28} borderRadius={14} />
      </View>

      {/* Poster + Info */}
      <View style={{ paddingHorizontal: 16, marginTop: -40, flexDirection: 'row' }}>
        {/* Poster */}
        <ShimmerBar
          width={POSTER_WIDTH}
          height={POSTER_WIDTH * 1.5}
          borderRadius={8}
          style={{ backgroundColor: '#1C1C20' }}
        />

        {/* Info */}
        <View style={{ flex: 1, marginLeft: 12, justifyContent: 'flex-end', paddingBottom: 4 }}>
          <ShimmerBar width="80%" height={20} borderRadius={4} />
          <ShimmerBar width={50} height={14} borderRadius={4} style={{ marginTop: 6 }} />
          <View style={{ flexDirection: 'row', marginTop: 8, gap: 4 }}>
            <ShimmerBar width={50} height={20} borderRadius={4} />
            <ShimmerBar width={40} height={20} borderRadius={4} />
            <ShimmerBar width={55} height={20} borderRadius={4} />
          </View>
          <ShimmerBar width={60} height={22} borderRadius={4} style={{ marginTop: 8 }} />
        </View>
      </View>

      {/* Overview */}
      <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
        <ShimmerBar width={70} height={16} borderRadius={4} />
        <ShimmerBar width="100%" height={12} borderRadius={4} style={{ marginTop: 10 }} />
        <ShimmerBar width="95%" height={12} borderRadius={4} style={{ marginTop: 6 }} />
        <ShimmerBar width="70%" height={12} borderRadius={4} style={{ marginTop: 6 }} />
      </View>

      {/* Buttons */}
      <View style={{ paddingHorizontal: 16, marginTop: 24, flexDirection: 'row', gap: 10 }}>
        <ShimmerBar width="60%" height={48} borderRadius={10} style={{ backgroundColor: '#2A2520' }} />
        <ShimmerBar width={48} height={48} borderRadius={10} />
        <ShimmerBar width={48} height={48} borderRadius={10} />
      </View>

      {/* Cast */}
      <View style={{ paddingHorizontal: 16, marginTop: 28 }}>
        <ShimmerBar width={100} height={16} borderRadius={4} />
        <View style={{ flexDirection: 'row', marginTop: 12, gap: 16 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={{ alignItems: 'center' }}>
              <ShimmerBar width={56} height={56} borderRadius={28} />
              <ShimmerBar width={40} height={10} borderRadius={4} style={{ marginTop: 6 }} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * Skeleton loading state for person detail screen.
 */
export function PersonSkeleton() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: '#070708', paddingTop: insets.top }}>
      {/* Back button */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <ShimmerBar width={80} height={28} borderRadius={14} />
      </View>

      {/* Avatar + Name */}
      <View style={{ alignItems: 'center', paddingHorizontal: 24, paddingBottom: 24 }}>
        <ShimmerBar width={120} height={120} borderRadius={60} />
        <ShimmerBar width={140} height={22} borderRadius={4} style={{ marginTop: 16 }} />
        <ShimmerBar width={90} height={14} borderRadius={4} style={{ marginTop: 8 }} />
        <ShimmerBar width={100} height={12} borderRadius={4} style={{ marginTop: 8 }} />
        <ShimmerBar width={130} height={12} borderRadius={4} style={{ marginTop: 6 }} />
      </View>

      {/* Biography */}
      <View style={{ paddingHorizontal: 24, marginBottom: 32 }}>
        <ShimmerBar width={80} height={18} borderRadius={4} />
        <ShimmerBar width="100%" height={12} borderRadius={4} style={{ marginTop: 12 }} />
        <ShimmerBar width="95%" height={12} borderRadius={4} style={{ marginTop: 6 }} />
        <ShimmerBar width="80%" height={12} borderRadius={4} style={{ marginTop: 6 }} />
        <ShimmerBar width="90%" height={12} borderRadius={4} style={{ marginTop: 6 }} />
      </View>

      {/* Filmography */}
      <View style={{ paddingHorizontal: 24 }}>
        <ShimmerBar width={100} height={18} borderRadius={4} />
        <View style={{ flexDirection: 'row', marginTop: 12, gap: 10 }}>
          {[1, 2, 3, 4].map((i) => (
            <View key={i}>
              <ShimmerBar width={90} height={135} borderRadius={8} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * Skeleton loading state for search results grid.
 */
export function SearchSkeleton() {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const cardWidth = (SCREEN_WIDTH - 32 - 16) / 3;
  const cardHeight = cardWidth * 1.5;

  return (
    <View style={{ flex: 1, backgroundColor: '#070708', paddingTop: insets.top }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
        <ShimmerBar width={100} height={22} borderRadius={4} />
      </View>

      {/* Search bar */}
      <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
        <ShimmerBar width="100%" height={44} borderRadius={22} />
      </View>

      {/* Genre pills */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginTop: 12, gap: 8 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <ShimmerBar key={i} width={60} height={28} borderRadius={14} />
        ))}
      </View>

      {/* Grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 16, gap: 8 }}>
        {Array.from({ length: 9 }).map((_, i) => (
          <View key={i} style={{ width: cardWidth }}>
            <ShimmerBar width={cardWidth} height={cardHeight} borderRadius={12} />
            <ShimmerBar width="80%" height={10} borderRadius={4} style={{ marginTop: 6 }} />
          </View>
        ))}
      </View>
    </View>
  );
}
