/**
 * SwipeExemptScroll — wrap any horizontal scroll view so that swiping on it
 * scrolls the content instead of triggering the SwipeTabNavigator's tab cycle.
 *
 * Every horizontal carousel / pill-row must be wrapped (directly or via the
 * built-in `SwipeExemptFlatList` / `SwipeExemptScrollView` below) so the root
 * navigator's Pan gesture `.requireExternalGestureToFail(...)`s it — otherwise
 * a swipe on a carousel would switch tabs instead of scrolling.
 *
 * Usage:
 *   <SwipeExemptFlatList horizontal ... />          // FlatList/FlashList
 *   <SwipeExemptScrollView horizontal ... />        // ScrollView
 *   <SwipeExemptScroll style={{flex:1}}>            // arbitrary children
 *     <ScrollView horizontal>...</ScrollView>
 *   </SwipeExemptScroll>
 */
import React, { useEffect, useMemo } from "react";
import { View, ScrollView, FlatList } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSwipeTabNavigator } from "./SwipeTabNavigator";

/** Inner component that owns the GestureDetector + native-gesture registration. */
function SwipeExempt({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.ComponentProps<typeof View>["style"];
}) {
  const swipeTab = useSwipeTabNavigator();
  const nativeGesture = useMemo(() => Gesture.Native(), []);

  useEffect(() => {
    if (!swipeTab) return;
    return swipeTab.registerCarousel(nativeGesture);
  }, [swipeTab, nativeGesture]);

  return (
    <GestureDetector gesture={nativeGesture}>
      <View style={style} collapsable={false}>
        {children}
      </View>
    </GestureDetector>
  );
}

/** Horizontal FlatList exempted from tab-swiping. */
export function SwipeExemptFlatList<ItemT>({
  horizontal = true,
  style,
  ...flatListProps
}: React.ComponentProps<typeof FlatList<ItemT>>) {
  if (!horizontal) {
    // Not a horizontal carousel — no exemption needed; render as-is.
    return (
      <FlatList<ItemT> horizontal={false} style={style} {...flatListProps} />
    );
  }
  return (
    <SwipeExempt>
      <FlatList<ItemT> horizontal style={style} {...flatListProps} />
    </SwipeExempt>
  );
}

/** Horizontal ScrollView exempted from tab-swiping. */
export function SwipeExemptScrollView({
  horizontal = true,
  style,
  children,
  ...scrollViewProps
}: React.ComponentProps<typeof ScrollView>) {
  if (!horizontal) {
    return (
      <ScrollView horizontal={false} style={style} {...scrollViewProps}>
        {children}
      </ScrollView>
    );
  }
  return (
    <SwipeExempt>
      <ScrollView horizontal style={style} {...scrollViewProps}>
        {children}
      </ScrollView>
    </SwipeExempt>
  );
}
