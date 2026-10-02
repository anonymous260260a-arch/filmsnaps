import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  Animated,
  Easing,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { getImageUrl } from "@filmsnaps/shared";
import { ProgressiveImage } from "./ProgressiveImage";
import { typography } from "../theme/typography";
import { colors } from "../theme/colors";
import { FilmGrain } from "./FilmGrain";
import { heroHeightForWidth, HERO_BACKDROP_SIZE } from "./heroLayout";
import { useMovieTheme } from "../hooks/useMovieTheme";
import { useReduceMotion } from "../hooks/useReduceMotion";
import { setHomeAccent, resolveSwatch } from "../lib/movieAccent";
import type { Movie } from "@filmsnaps/shared";

/** CTA label color while the hero is neutral (dark text on brand gold). */
const FALLBACK_CTA_TEXT = "#070708";

interface HeroProps {
  item: Movie;
  onWatchPress: (item: Movie) => void;
  onDetailsPress?: (item: Movie) => void;
}

/** CTA animates backgroundColor → must be an animated component (JS driver). */
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);
const AnimatedText = Animated.createAnimatedComponent(Text);

export function Hero({ item, onWatchPress, onDetailsPress }: HeroProps) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const HERO_HEIGHT = heroHeightForWidth(SCREEN_WIDTH);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const loggedLayoutRef = useRef(false);
  // ── "Extract color first, then flow" — the invisible swap ──
  // The hero PAINTS `shownItem` (image + accent wash + text stay locked
  // together); the live `item` prop only drives staging. When a new item
  // flows in, its backdrop is prefetched and its swatch resolved BEHIND the
  // current hero; only when both gates open does the swap happen in a single
  // frame — followed by the hook's normal accent crossfade. The user never
  // sees a stock-color hero or a half-staged state.
  const [shownItem, setShownItem] = useState<Movie>(item);
  const [pendingItem, setPendingItem] = useState<Movie | null>(null);
  const [stagedImageReady, setStagedImageReady] = useState(false);
  const [swatchSettled, setSwatchSettled] = useState(true);
  // Phase 2: the OS asks for reduced motion → every accent surface SNAPS
  // instead of running its 450ms fades (image crossfade + CTA tint here;
  // the accent wash itself is driven by useMovieTheme's progress value).
  const reduceMotion = useReduceMotion();

  const shownTheme = useMovieTheme(shownItem.backdrop_path);
  const shownUrl = getImageUrl(shownItem.backdrop_path, HERO_BACKDROP_SIZE);
  const pendingUrl = pendingItem
    ? getImageUrl(pendingItem.backdrop_path, HERO_BACKDROP_SIZE)
    : null;

  // Backdrop crossfade: the outgoing image stays mounted underneath while
  // the incoming one fades over it — same rhythm as the wash crossfade.
  const imgFade = useRef(new Animated.Value(1));
  const [prevShown, setPrevShown] = useState<Movie | null>(null);

  // The hidden prep layer's image finished loading (decode is warm) — the
  // image half of the swap gate is open.
  const commitStagedImage = useCallback(() => {
    setStagedImageReady(true);
  }, []);

  // Publish the hero palette to the whole home surface (rows, headings, the
  // ambient glow). One image decode, one source of truth — decor subscribes
  // instead of extracting, so every tint always agrees with the hero.
  React.useEffect(() => {
    setHomeAccent(shownTheme.hasAccent ? shownTheme.palette : null);
  }, [shownTheme.hasAccent, shownTheme.palette]);

  useEffect(() => {
    const same =
      item.id === shownItem.id &&
      item.backdrop_path === shownItem.backdrop_path;
    if (same) {
      if (pendingItem) {
        setPendingItem(null);
        setStagedImageReady(false);
        setSwatchSettled(true);
      }
      return;
    }
    if (!pendingItem || pendingItem.id !== item.id) {
      setPendingItem(item);
      setStagedImageReady(!item.backdrop_path);
      setSwatchSettled(!item.backdrop_path);
      if (item.backdrop_path) {
        // Warm the decode so the staged layer's onLoad lands within a frame
        // or two — home already prefetches this exact URL.
        Image.prefetch(
          getImageUrl(item.backdrop_path, HERO_BACKDROP_SIZE),
        ).catch(() => {});
      }
    }
  }, [item, shownItem.id, shownItem.backdrop_path, pendingItem]);

  // Swatch gate: resolveSwatch settles on success, unusable result, OR the
  // 3s timeout — so this never stalls the swap; a late extraction still
  // commits through the cache and crossfades in afterwards. The 6s timer is
  // a hard backstop for a never-loading image (worst case: the swap runs
  // with the placeholder — strictly better than a stuck hero).
  useEffect(() => {
    const path = pendingItem?.backdrop_path;
    if (!pendingItem || !path) return;
    let cancelled = false;
    const backstop = setTimeout(() => setStagedImageReady(true), 6000);
    void resolveSwatch(path).finally(() => {
      if (!cancelled) setSwatchSettled(true);
    });
    return () => {
      cancelled = true;
      clearTimeout(backstop);
    };
  }, [pendingItem]);

  // Both gates open → flow the new hero in: image crossfades over the old
  // one while the accent wash crossfades in step. The staged image is
  // already decoded (hidden prep layer), so the fade starts on real pixels.
  useEffect(() => {
    if (pendingItem && stagedImageReady && swatchSettled) {
      setPrevShown(shownItem);
      setShownItem(pendingItem);
      setPendingItem(null);
      setStagedImageReady(false);
      setSwatchSettled(true);
      imgFade.current.setValue(reduceMotion ? 1 : 0);
      if (reduceMotion) {
        // Accessibility: no crossfade — the new backdrop simply IS.
        const t = setTimeout(() => setPrevShown(null), 500);
        return () => clearTimeout(t);
      }
      Animated.timing(imgFade.current, {
        toValue: 1,
        duration: 450,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }).start();
      // Unmount the outgoing image layer once the fade is done.
      const t = setTimeout(() => setPrevShown(null), 500);
      return () => clearTimeout(t);
    }
  }, [pendingItem, stagedImageReady, swatchSettled, shownItem, reduceMotion]);

  // ── CTA tint fade — never a hard gold→accent jump ──
  // The CTA paints brand gold while the hero is neutral; when the accent
  // arrives (or changes on a hero swap) it EASES to the new color over the
  // same 450ms as the wash, so button and backdrop move as one scene.
  // (Color lerp between two solid fills — not alpha-blending — so no mud.)
  const ctaTint = useRef(new Animated.Value(0));
  const prevCtaAccentRef = useRef<string>(colors.goldDim);
  const prevCtaTextRef = useRef<string>(FALLBACK_CTA_TEXT);
  const [ctaColors, setCtaColors] = useState<[string, string]>([
    colors.goldDim,
    colors.goldDim,
  ]);
  const [ctaTexts, setCtaTexts] = useState<[string, string]>([
    FALLBACK_CTA_TEXT,
    FALLBACK_CTA_TEXT,
  ]);

  useEffect(() => {
    const next = shownTheme.hasAccent
      ? shownTheme.palette.accent
      : colors.goldDim;
    const nextText = shownTheme.hasAccent
      ? shownTheme.palette.accentText
      : FALLBACK_CTA_TEXT;
    if (next === prevCtaAccentRef.current) return;
    const from = prevCtaAccentRef.current;
    const fromText = prevCtaTextRef.current;
    prevCtaAccentRef.current = next;
    prevCtaTextRef.current = nextText;
    setCtaColors([from, next]);
    setCtaTexts([fromText, nextText]);
    if (reduceMotion) {
      // Accessibility: snap the CTA to its final tint — no color animation.
      ctaTint.current.setValue(1);
      return;
    }
    ctaTint.current.setValue(0);
    Animated.timing(ctaTint.current, {
      toValue: 1,
      duration: 450,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: false, // backgroundColor/color are JS-driven only
    }).start();
  }, [shownTheme.hasAccent, shownTheme.palette, reduceMotion]);

  const ctaBg = ctaTint.current.interpolate({
    inputRange: [0, 1],
    outputRange: ctaColors,
  });
  const ctaFg = ctaTint.current.interpolate({
    inputRange: [0, 1],
    outputRange: ctaTexts,
  });

  const backdropUrl = shownUrl;
  const title = shownItem.title || shownItem.name || "";
  const overview = shownItem.overview || "";
  const rating = shownItem.vote_average ?? 0;
  const year =
    shownItem.release_date?.split("-")[0] ??
    shownItem.first_air_date?.split("-")[0] ??
    "";

  return (
    <View
      onLayout={(e) => {
        // Phase 1C FIX 3: prove the real rendered box matches HERO_ASPECT_RATIO.
        if (loggedLayoutRef.current) return;
        loggedLayoutRef.current = true;
        const { height, width } = e.nativeEvent.layout;
        console.log(
          `[hero] height=${height} ratio=${(height / (width || 1)).toFixed(4)} width=${width} expected=${HERO_HEIGHT}`,
        );
      }}
      style={{
        height: HERO_HEIGHT,
        position: "relative",
        overflow: "hidden",
        borderBottomLeftRadius: 28,
        borderBottomRightRadius: 28,
      }}
    >
      {/* ── Backdrop — two stacked layers: the outgoing image stays mounted
             underneath while the incoming one fades over it (450 ms, in step
             with the accent wash). No stock-color gap, no placeholder pop. ── */}
      {prevShown?.backdrop_path ? (
        <ProgressiveImage
          uri={getImageUrl(prevShown.backdrop_path, HERO_BACKDROP_SIZE)}
          style={{
            width: SCREEN_WIDTH,
            height: HERO_HEIGHT,
            position: "absolute",
            top: 0,
            left: 0,
          }}
          resizeMode="cover"
        />
      ) : !shownItem.backdrop_path ? (
        <View
          style={{
            width: SCREEN_WIDTH,
            height: HERO_HEIGHT,
            position: "absolute",
            backgroundColor: colors.bg,
          }}
        />
      ) : null}
      {shownItem.backdrop_path && (
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: SCREEN_WIDTH,
            height: HERO_HEIGHT,
            opacity: imgFade.current,
          }}
        >
          <ProgressiveImage
            uri={backdropUrl}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
          />
        </Animated.View>
      )}
      {/* Hidden prep layer: decodes the incoming backdrop OFFSCREEN and
          opens the image gate on onLoad. Same URL the fade layer renders,
          so the crossfade starts on real pixels, not a placeholder. */}
      {pendingItem?.backdrop_path && !stagedImageReady && (
        <View
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            opacity: 0,
            top: -100,
            left: -100,
          }}
          pointerEvents="none"
        >
          <ProgressiveImage
            uri={pendingUrl ?? ""}
            style={{ width: 1, height: 1 }}
            resizeMode="cover"
            onLoad={commitStagedImage}
          />
        </View>
      )}

      {/* ── Film grain texture overlay ── */}
      <FilmGrain opacity={0.03} />

      {/* ── Cinematic gradient — the neutral scrim is PERMANENT. Both layers
             are translucent, so unmounting it mid-stack would change the
             composite and pop; it stays mounted forever. ── */}
      <LinearGradient
        colors={[
          colors.heroGradientTransparent,
          colors.heroGradientTransparent,
          colors.heroGradientMid,
          colors.heroGradientSolid,
        ]}
        locations={[0, 0.35, 0.7, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
        pointerEvents="none"
      />
      {/* ── Accent wash — scoped EXACTLY to the hero bounds (this view has
             overflow: hidden, and the gradient fills the hero box). Nothing
             bleeds below the hero: the rows are neutral and carry per-card
             tints; the hero→rows seam is the bridge's fade to PURE bg. ── */}
      {shownTheme.hasAccent && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: shownTheme.progress,
          }}
        >
          <LinearGradient
            colors={[
              colors.heroGradientTransparent,
              colors.heroGradientTransparent,
              shownTheme.palette.mid,
              shownTheme.palette.faded,
            ]}
            locations={[0, 0.35, 0.7, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      )}

      {/* ── Content block — anchored to bottom. zIndex 2 keeps it ABOVE
             every tint layer (backdrop scrims + accent wash) — the CTA can
             never be painted over by a wash. ── */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          paddingHorizontal: 20,
          paddingBottom: 24,
          paddingTop: 36,
          zIndex: 2,
        }}
      >
        {/* Rating & Format badge */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginBottom: 8,
            gap: 8,
          }}
        >
          {rating > 0 && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "rgba(14, 14, 17, 0.80)",
                borderWidth: 0.5,
                borderColor: "rgba(212, 162, 55, 0.35)",
                borderRadius: 9999,
                paddingHorizontal: 8,
                paddingVertical: 2.5,
              }}
            >
              <Ionicons
                name="star"
                size={12}
                color={colors.gold}
                style={{ marginRight: 4 }}
              />
              <Text
                style={{ color: colors.gold, fontSize: 11, fontWeight: "700" }}
              >
                {rating.toFixed(1)}
              </Text>
            </View>
          )}

          {year ? (
            <View
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.08)",
                borderRadius: 9999,
                paddingHorizontal: 8,
                paddingVertical: 2.5,
              }}
            >
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 11,
                  fontFamily: "Inter_500Medium",
                }}
              >
                {year}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Title */}
        <Text
          style={[
            typography.display,
            {
              fontSize: 26,
              lineHeight: 32,
              marginBottom: 6,
              color: colors.textPrimary,
            },
          ]}
          numberOfLines={2}
        >
          {title}
        </Text>

        {/* Overview */}
        {overview ? (
          <View style={{ marginBottom: 16 }}>
            <Text
              style={[
                typography.body,
                { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
              ]}
              numberOfLines={overviewExpanded ? undefined : 2}
            >
              {overview}
            </Text>
            {overview.length > 90 && (
              <TouchableOpacity
                onPress={() => setOverviewExpanded(!overviewExpanded)}
                activeOpacity={0.7}
                style={{ marginTop: 2 }}
              >
                <Text
                  style={{
                    color: colors.gold,
                    fontSize: 11,
                    fontFamily: "Inter_500Medium",
                  }}
                >
                  {overviewExpanded ? "Show less" : "Read more"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        {/* Dual Actions CTA: Watch Now + Details */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {/* Primary: Watch Now — animated accent tint (fades from gold) */}
          <AnimatedTouchable
            onPress={() => onWatchPress(item)}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel={`Watch ${title}`}
            accessibilityHint="Opens the video player"
            style={{
              flex: 1,
              backgroundColor: ctaBg,
              borderRadius: 12,
              paddingVertical: 13,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              // shadow* only ever rendered on iOS; this build is Android-only.
              elevation: 6,
            }}
          >
            {/* Label fades with the background; the 16px play icon snaps
                (imperceptible at that size, and Ionicons color is a plain
                prop — not animatable without a wrapper). */}
            <Ionicons
              name="play"
              size={16}
              color={shownTheme.palette.accentText}
              style={{ marginRight: 6 }}
            />
            <AnimatedText
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 14,
                color: ctaFg,
              }}
            >
              Watch Now
            </AnimatedText>
          </AnimatedTouchable>

          {/* Secondary: Details */}
          {onDetailsPress && (
            <TouchableOpacity
              onPress={() => onDetailsPress(item)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`View details for ${title}`}
              style={{
                backgroundColor: "rgba(14, 14, 17, 0.75)",
                borderWidth: 1,
                borderColor: colors.borderSubtle,
                borderRadius: 12,
                paddingVertical: 13,
                paddingHorizontal: 16,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={colors.textPrimary}
                style={{ marginRight: 6 }}
              />
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                  color: colors.textPrimary,
                }}
              >
                Details
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}
