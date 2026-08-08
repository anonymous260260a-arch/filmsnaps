/**
 * SwipeTabNavigator — swipe ANYWHERE on the tab screens to cycle the bottom
 * tabs, with horizontal carousels exempted (a swipe on a carousel scrolls it).
 *
 * Behaviour (Instagram-style drag-to-reveal):
 *   - The ACTIVE tab's content FOLLOWS YOUR FINGER while you drag (a Reanimated
 *     shared value drives a translateX on the whole <Tabs> scene container).
 *   - The ADJACENT tab is mounted live BEHIND it and slides in from the edge
 *     you're dragging toward, so you see the next page before you release.
 *   - Release past a distance/velocity threshold commits to that tab (it slides
 *     the rest of the way home); otherwise the page springs back.
 *   - swipe left  (right→left)  → next tab  (Home → Search → Library → Settings → Home)
 *   - swipe right (left→right)  → prev tab  (Home → Settings → Library → Search → Home)
 *
 * Architecture — ancestor, not overlay:
 *   This component wraps the <Tabs> navigator and renders its Pan gesture on
 *   an ANCESTOR view. RNGH delivers touches to every gesture handler whose
 *   view contains the touch point, so the Pan sees touches anywhere on any
 *   tab — but because it only ACTIVATES on a ≥12px horizontal swipe
 *   (.activeOffsetX) and FAILS on a vertical drag (.failOffsetY), taps and
 *   vertical scrolling pass through to the content untouched. There is no
 *   on-top overlay, so nothing is blocked.
 *
 * Carousel-safety (the hard requirement):
 *   Horizontal scrollables call `registerCarousel()` (via the
 *   `useSwipeTabNavigator()` context hook — see MediaCarousel). Each registers
 *   a `Gesture.Native()` that wraps its scroll view. The Pan then
 *   `.requireExternalGestureToFail(...natives)`, so it only activates when the
 *   touch was NOT claimed by a carousel. A drag that starts on a carousel
 *   scrolls it; a drag anywhere else drags the page.
 *
 * Reveal previews:
 *   The tab scenes live inside the <Tabs> navigator (passed as `children`), so
 *   routes/hooks/tab-state all work exactly as before. The tab bar is rendered
 *   here (fixed, outside the translated wrapper) so the bar never slides with
 *   the content. During a drag, the adjacent tab is mounted LIVE as a preview
 *   behind the translated container (pointerEvents disabled, so it's purely a
 *   peek — the real screen takes over when the drag commits). Screens are
 *   passed in via the `scenes` prop so this file never imports route files
 *   (avoids a circular import through SwipeExemptScroll).
 *
 * Mount ONCE at the root of the tab screens (in (tabs)/_layout.tsx). The tab
 * order is defined here — keep it in sync with the <Tabs.Screen> order there.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  type GestureType,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme/colors";

/** Ordered route names — one per <Tabs.Screen> in (tabs)/_layout.tsx. */
export const TAB_ROUTES = ["/", "/search", "/library", "/settings"] as const;
export type TabRoute = (typeof TAB_ROUTES)[number];

/** Horizontal travel (points) before the swipe activates and the page starts
 *  following the finger. Kept small so the reveal starts almost immediately. */
const SWIPE_ACTIVATION_X = 12;
/** Vertical travel (points) past which the gesture FAILS (vertical scroll /
 *  pull-to-refresh on the screens). */
const SWIPE_FAIL_Y = 40;
/** Fraction of the screen width that the drag must cover at release (or the
 *  release velocity) before the swipe commits instead of springing back. */
const COMMIT_FRACTION = 0.22;
const COMMIT_VELOCITY = 600;

export interface SwipeTabNavigatorContextValue {
  /** Register a horizontal scrollable so a swipe on it scrolls, not
   *  navigates. Returns an unsubscribe (call on unmount). */
  registerCarousel: (gesture: GestureType) => () => void;
}

const SwipeTabContext = createContext<SwipeTabNavigatorContextValue | null>(
  null,
);

/** Consume the navigator from a child screen to register a carousel. */
export function useSwipeTabNavigator(): SwipeTabNavigatorContextValue | null {
  return useContext(SwipeTabContext);
}

/** A tab screen made available for the drag-to-reveal preview. */
export interface TabScene {
  route: TabRoute;
  Component: React.ComponentType;
}

interface SwipeTabNavigatorProps {
  /** The <Tabs> navigator element (routes + screens). */
  children: React.ReactNode;
  /** The tab screens in TAB_ROUTES order, for the live reveal previews. */
  scenes: TabScene[];
  /** Fixed overlay that floats above the tab bar (e.g. DownloadBanner). */
  overlay?: React.ReactNode;
  /** Debounce (ms) between consecutive tab switches. Default 700. */
  debounceMs?: number;
}

/** Tab-bar metadata — keep in sync with TAB_ROUTES order. */
const TAB_META: {
  label: string;
  active: keyof typeof Ionicons.glyphMap;
  inactive: keyof typeof Ionicons.glyphMap;
}[] = [
  { label: "Home", active: "home", inactive: "home-outline" },
  { label: "Search", active: "search", inactive: "search-outline" },
  { label: "Library", active: "library", inactive: "library-outline" },
  { label: "Settings", active: "settings", inactive: "settings-outline" },
];

/**
 * A scene that follows the finger during a drag. `base` is its resting
 * position (offset by one screen width from the active tab) and `dragX` is the
 * finger delta — so the neighbor slides in/out 1:1 with the drag.
 */
function ScenePreview({
  scene,
  base,
  dragX,
}: {
  scene: TabScene;
  base: number;
  dragX: SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: base + dragX.value }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
      <scene.Component />
    </Animated.View>
  );
}

export function SwipeTabNavigator({
  children,
  scenes,
  overlay,
  debounceMs = 700,
}: SwipeTabNavigatorProps) {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // ── Finger-following drag ──
  // UI-thread shared value; drives BOTH the translated <Tabs> container (the
  // active page follows the finger) and the ScenePreview reveal (the neighbor
  // slides in from the opposite edge).
  const dragX = useSharedValue(0);

  // Current tab index, derived from the live pathname (covers deep links /
  // hard nav). Falls back to Home if the path isn't a tab route.
  const currentIndex = useMemo(() => {
    const i = TAB_ROUTES.indexOf(pathname as TabRoute);
    return i === -1 ? 0 : i;
  }, [pathname]);

  // Which neighbour is being revealed while dragging (1 = next, -1 = prev).
  // Non-null only while a drag is active; gates the reveal layer's mount.
  const [dragDir, setDragDir] = useState<1 | -1 | null>(null);

  // Registered horizontal scrollable gestures (carousels) that must be
  // exempted from tab navigation. `carouselVersion` forces a re-compose of
  // the Pan whenever one registers/unregisters.
  const nativesRef = useRef<GestureType[]>([]);
  const [carouselVersion, setCarouselVersion] = useState(0);

  const registerCarousel = useCallback((gesture: GestureType) => {
    if (!nativesRef.current.includes(gesture)) {
      nativesRef.current.push(gesture);
      setCarouselVersion((v) => v + 1);
    }
    return () => {
      const i = nativesRef.current.indexOf(gesture);
      if (i !== -1) {
        nativesRef.current.splice(i, 1);
        setCarouselVersion((v) => v + 1);
      }
    };
  }, []);

  const contextValue = useMemo(
    () => ({ registerCarousel }),
    [registerCarousel],
  );

  const lastNavAtRef = useRef(0);

  const goTo = useCallback((nextIndex: number) => {
    const route = TAB_ROUTES[nextIndex];
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(`[SwipeTab] → ${route}`);
    }
    router.push(route);
  }, []);

  // Commit the drag to the adjacent tab. Called from the gesture worklet via
  // runOnJS (the settle animation already ran on the UI thread).
  const commitNav = useCallback(
    (dir: 1 | -1) => {
      const n = TAB_ROUTES.length;
      const now = Date.now();
      if (now - lastNavAtRef.current < debounceMs) {
        dragX.value = withSpring(0, { damping: 22, stiffness: 240 });
        return;
      }
      lastNavAtRef.current = now;
      const next = (currentIndex + dir + n) % n;
      goTo(next);
    },
    [currentIndex, debounceMs, goTo, dragX],
  );

  const handleTabPress = useCallback(
    (i: number) => {
      if (i === currentIndex) return;
      lastNavAtRef.current = Date.now();
      goTo(i);
    },
    [currentIndex, goTo],
  );

  // ── Full-screen Pan gesture ──
  // Requires every registered native carousel gesture to fail — i.e. the
  // swipe only counts when the touch wasn't a carousel drag.
  const composed = useMemo(() => {
    const natives = nativesRef.current;
    return Gesture.Pan()
      .activeOffsetX([-SWIPE_ACTIVATION_X, SWIPE_ACTIVATION_X])
      .failOffsetY([-SWIPE_FAIL_Y, SWIPE_FAIL_Y])
      .requireExternalGestureToFail(...natives)
      .onStart((e) => {
        // Reveal the neighbour in the drag direction (1 = next, -1 = prev).
        runOnJS(setDragDir)(e.translationX < 0 ? 1 : -1);
      })
      .onUpdate((e) => {
        // Follow the finger 1:1, clamped to one screen width so the reveal
        // never overshoots past the neighbour fully filling the screen.
        dragX.value = Math.max(-width, Math.min(width, e.translationX));
      })
      .onEnd((e) => {
        const shouldCommit =
          e.translationX < -width * COMMIT_FRACTION ||
          e.translationX > width * COMMIT_FRACTION ||
          e.velocityX < -COMMIT_VELOCITY ||
          e.velocityX > COMMIT_VELOCITY;

        if (shouldCommit) {
          const dir = e.translationX < 0 ? 1 : -1;
          // Slide the incoming page the rest of the way home (the <Tabs>
          // container settles back to 0, now showing the new active scene).
          dragX.value = withTiming(0, {
            duration: 240,
            easing: Easing.out(Easing.cubic),
          });
          runOnJS(commitNav)(dir);
        } else {
          // Not far enough — spring the current page back.
          dragX.value = withSpring(0, { damping: 22, stiffness: 240 });
        }
      })
      .onFinalize(() => {
        runOnJS(setDragDir)(null);
      });
    // Rebuild whenever a carousel registers/unregisters or the screen size
    // changes (rotation) so the worklet sees fresh values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, carouselVersion, commitNav]);

  // Neighbours in the cycle for the reveal layer.
  const n = TAB_ROUTES.length;
  const next = (currentIndex + 1) % n;
  const prev = (currentIndex - 1 + n) % n;
  const bottomInset = insets.bottom;

  return (
    <SwipeTabContext.Provider value={contextValue}>
      <GestureDetector gesture={composed}>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {/* ── Reveal layer (behind the translated Tabs container) ── */}
          {dragDir !== null && (
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { zIndex: -1 }]}
            >
              {(() => {
                const target = dragDir === 1 ? next : prev;
                const base = dragDir === 1 ? width : -width;
                return (
                  <ScenePreview
                    key={scenes[target].route}
                    scene={scenes[target]}
                    base={base}
                    dragX={dragX}
                  />
                );
              })()}
            </View>
          )}

          {/* ── Tabs (the active page follows the finger) ── */}
          <Animated.View
            style={{ flex: 1, transform: [{ translateX: dragX }] }}
          >
            {children}
          </Animated.View>

          {/* ── Fixed tab bar (never slides with the content) ── */}
          <View
            style={[
              styles.tabBar,
              {
                backgroundColor: colors.bgSurface,
                borderTopColor: colors.progressTrack,
                paddingBottom: bottomInset + 4,
                height: 72 + bottomInset,
              },
            ]}
          >
            {TAB_ROUTES.map((route, i) => {
              const focused = i === currentIndex;
              const meta = TAB_META[i];
              return (
                <TouchableOpacity
                  key={route}
                  onPress={() => handleTabPress(i)}
                  activeOpacity={0.7}
                  style={styles.tabItem}
                  accessibilityRole="button"
                  accessibilityState={{ selected: focused }}
                  accessibilityLabel={meta.label}
                >
                  <Ionicons
                    name={focused ? meta.active : meta.inactive}
                    size={22}
                    color={focused ? colors.gold : colors.textTertiary}
                  />
                  <Text
                    style={[
                      styles.tabLabel,
                      { color: focused ? colors.gold : colors.textTertiary },
                    ]}
                  >
                    {meta.label}
                  </Text>
                  {/* Gold pill indicator */}
                  {focused && <View style={styles.tabPill} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Fixed overlay above the bar (DownloadBanner) ── */}
          {overlay}
        </View>
      </GestureDetector>
    </SwipeTabContext.Provider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    borderTopWidth: 0.5,
    paddingTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 48,
  },
  tabLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    marginTop: 3,
  },
  tabPill: {
    width: 20,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.gold,
    marginTop: 3,
  },
});

// Referenced so the hook is tree-shaken correctly when only the component is
// used; consumers use `useSwipeTabNavigator`.
export { SwipeTabContext };
