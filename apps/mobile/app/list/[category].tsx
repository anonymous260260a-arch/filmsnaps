import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeNavigation } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackIcon } from "../../components/Icons";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tmdbApi } from "../../lib/api";
import { MOVIE_GENRES, TV_GENRES, getImageUrl } from "@filmsnaps/shared";
import { MediaCard } from "../../components/MediaCard";
import { ProgressiveImage } from "../../components/ProgressiveImage";
import {
  openDetail,
  prepareDetail,
  toDetailNavItem,
} from "../../lib/openDetail";
import { colors } from "../../theme/colors";
import * as Haptics from "expo-haptics";

type CategoryKey = "trending-movies" | "trending-tv" | "popular-movies";

const CATEGORY_CONFIG: Record<
  CategoryKey,
  { title: string; defaultType: "movie" | "tv" }
> = {
  "trending-movies": { title: "Trending Movies", defaultType: "movie" },
  "trending-tv": { title: "Trending TV", defaultType: "tv" },
  "popular-movies": { title: "Popular Movies", defaultType: "movie" },
};

const ITEMS_PER_PAGE = 20;
const NUM_COLUMNS = 3;
const GAP = 8;
const PADDING = 16;

// ── Filter option tables ──────────────────────────────────────────────────

type SortValue =
  | "popularity.desc"
  | "vote_average.desc"
  | "primary_release_date.desc"
  | "primary_release_date.asc";

const SORT_OPTIONS: { value: SortValue; label: string }[] = [
  { value: "popularity.desc", label: "Popular" },
  { value: "vote_average.desc", label: "Top Rated" },
  { value: "primary_release_date.desc", label: "Newest" },
  { value: "primary_release_date.asc", label: "Oldest" },
];

const DECADES: { id: string; label: string; start?: number; end?: number }[] = [
  { id: "all", label: "All Time" },
  { id: "2020s", label: "2020s", start: 2020, end: 2029 },
  { id: "2010s", label: "2010s", start: 2010, end: 2019 },
  { id: "2000s", label: "2000s", start: 2000, end: 2009 },
  { id: "1990s", label: "90s", start: 1990, end: 1999 },
  { id: "1980s", label: "80s", start: 1980, end: 1989 },
  { id: "1970s", label: "70s", start: 1970, end: 1979 },
  { id: "classic", label: "Pre-1970", end: 1969 },
];

const RATINGS: { value: number | null; label: string; votes?: number }[] = [
  { value: null, label: "Any" },
  { value: 5, label: "5+", votes: 60 },
  { value: 6, label: "6+", votes: 80 },
  { value: 7, label: "7+", votes: 100 },
  { value: 8, label: "8+", votes: 300 },
];

const LANGUAGES: { id: string | null; label: string }[] = [
  { id: null, label: "All" },
  { id: "en", label: "English" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "hi", label: "Hindi" },
];

interface Filters {
  mediaType: "movie" | "tv";
  sortBy: SortValue;
  genreIds: number[];
  decade: string;
  minRating: number | null;
  language: string | null;
}

// ── List-row card — MEMOIZED at module scope. A component defined inside
// the screen body would be a brand-new component TYPE every render, which
// unmounts and remounts every row on each keystroke/scroll tick — the lag
// in list mode. FlatList sees a new renderItem/type and throws away cell
// state. Module-scope + React.memo = stable identity, real recycling.
const ListRow = React.memo(function ListRow({
  item,
  mediaType,
  onPress,
  onPressIn,
}: {
  item: any;
  mediaType: "movie" | "tv";
  onPress: (item: any) => void;
  onPressIn: (item: any) => void;
}) {
  const year =
    (item.release_date || item.first_air_date || "").split("-")[0] ?? "";
  const art = item.backdrop_path || item.poster_path;
  return (
    <TouchableOpacity
      onPress={() => onPress(item)}
      onPressIn={() => onPressIn(item)}
      activeOpacity={0.8}
      accessibilityRole="button"
      style={{
        flexDirection: "row",
        gap: 12,
        padding: 8,
        borderRadius: 14,
        backgroundColor: colors.bgSurface,
        borderWidth: 0.5,
        borderColor: colors.borderSubtle,
        marginBottom: 8,
      }}
    >
      <View
        style={{
          width: 132,
          height: 74,
          borderRadius: 8,
          overflow: "hidden",
          backgroundColor: colors.bgElevated,
        }}
      >
        {art ? (
          <ProgressiveImage
            uri={getImageUrl(art, "w300")}
            style={{ width: 132, height: 74 }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="film-outline" size={18} color={colors.iconMuted} />
          </View>
        )}
      </View>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Text
          style={{
            color: colors.textPrimary,
            fontSize: 13,
            fontFamily: "Inter_600SemiBold",
          }}
          numberOfLines={1}
        >
          {item.title || item.name}
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginTop: 3,
          }}
        >
          {year ? (
            <Text
              style={{
                color: colors.textTertiary,
                fontSize: 11,
                fontFamily: "Inter_500Medium",
              }}
            >
              {year}
            </Text>
          ) : null}
          {(item.vote_average ?? 0) > 0 && (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
            >
              <Ionicons name="star" size={10} color={colors.gold} />
              <Text
                style={{
                  color: colors.gold,
                  fontSize: 11,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                {item.vote_average.toFixed(1)}
              </Text>
            </View>
          )}
          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 10,
              fontFamily: "Inter_500Medium",
            }}
          >
            {mediaType === "movie" ? "Movie" : "TV"}
          </Text>
        </View>
        {item.overview ? (
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 11,
              lineHeight: 15,
              fontFamily: "Inter_400Regular",
              marginTop: 4,
            }}
            numberOfLines={2}
          >
            {item.overview}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
});

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export default function CategoryListScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();
  const nav = useSafeNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { width: SCREEN_WIDTH } = useWindowDimensions();

  const config = category
    ? CATEGORY_CONFIG[category as CategoryKey]
    : undefined;
  const defaultType = config?.defaultType ?? "movie";

  // ── Filters (live-apply — each change is one cheap discover request) ──
  const [filters, setFilters] = useState<Filters>(() => ({
    mediaType: defaultType,
    sortBy: "popularity.desc",
    genreIds: [],
    decade: "all",
    minRating: null,
    language: null,
  }));
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // BASELINE: with zero filters engaged the page serves the exact endpoints
  // the See-All rows promised (weekly trending / popular) — filtering only
  // switches to TMDB discover. Trending ≠ popular-by-default, and the page
  // must not silently change what "Trending Movies" means.
  const isBaseline =
    filters.mediaType === defaultType &&
    filters.sortBy === "popularity.desc" &&
    filters.genreIds.length === 0 &&
    filters.decade === "all" &&
    filters.minRating == null &&
    filters.language == null;

  const hasActiveFilters = !isBaseline;

  const decadeDef = DECADES.find((d) => d.id === filters.decade);

  const discoverParams = useMemo(
    () => ({
      sortBy: filters.sortBy,
      genreIds: filters.genreIds.length ? filters.genreIds : undefined,
      yearStart: decadeDef?.start,
      yearEnd: decadeDef?.end,
      minRating: filters.minRating ?? undefined,
      minVotes:
        // Top Rated discover needs a vote floor even without a rating filter,
        // or zero-vote junk floods the grid.
        filters.minRating != null
          ? RATINGS.find((r) => r.value === filters.minRating)?.votes
          : filters.sortBy === "vote_average.desc"
            ? 100
            : undefined,
      language: filters.language ?? undefined,
    }),
    [filters, decadeDef],
  );

  const [page, setPage] = useState(1);
  const [allResults, setAllResults] = useState<any[]>([]);
  const seenIdsRef = useRef<Set<number>>(new Set());
  const [totalResults, setTotalResults] = useState<number | null>(null);

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: [
      "category",
      category,
      filters.mediaType,
      isBaseline ? "baseline" : discoverParams,
      page,
    ],
    queryFn: () => {
      if (isBaseline) {
        // Original endpoints (weekly trending / popular) — the promised list.
        if (category === "popular-movies")
          return tmdbApi.getPopularMovies(page);
        return defaultType === "tv"
          ? tmdbApi.getTrendingTV(page)
          : tmdbApi.getTrendingMovies(page);
      }
      return filters.mediaType === "movie"
        ? tmdbApi.getMoviesAdvanced({ ...discoverParams, page })
        : tmdbApi.getTVShowsAdvanced({ ...discoverParams, page });
    },
    enabled: !!config,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
  });

  // Accumulate results across pages — deduplicated by ID
  React.useEffect(() => {
    if (data?.results) {
      if (page === 1) {
        seenIdsRef.current = new Set(data.results.map((r: any) => r.id));
        setAllResults(data.results);
        setTotalResults(data.total_results ?? null);
      } else {
        const fresh = data.results.filter((r: any) => {
          if (seenIdsRef.current.has(r.id)) return false;
          seenIdsRef.current.add(r.id);
          return true;
        });
        if (fresh.length > 0) {
          setAllResults((prev) => [...prev, ...fresh]);
        }
      }
    }
  }, [data, page]);

  const resetPagination = useCallback(() => {
    setPage(1);
    setAllResults([]);
    setTotalResults(null);
    seenIdsRef.current = new Set();
  }, []);

  // Any filter/sort/media change starts a fresh result set.
  const updateFilters = useCallback(
    (patch: Partial<Filters>) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setFilters((prev) => ({ ...prev, ...patch }));
      resetPagination();
    },
    [resetPagination],
  );

  const toggleGenre = useCallback(
    (genreId: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setFilters((prev) => ({
        ...prev,
        genreIds: prev.genreIds.includes(genreId)
          ? prev.genreIds.filter((g) => g !== genreId)
          : [...prev.genreIds, genreId],
      }));
      resetPagination();
    },
    [resetPagination],
  );

  const resetFilters = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Media type is a browsing choice, not a filter — keep it.
    setFilters((prev) => ({
      ...prev,
      sortBy: "popularity.desc",
      genreIds: [],
      decade: "all",
      minRating: null,
      language: null,
    }));
    resetPagination();
  }, [resetPagination]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    resetPagination();
    await refetch();
    setRefreshing(false);
  }, [refetch, resetPagination]);

  const handleLoadMore = useCallback(() => {
    if (!isFetching && data && page < (data.total_pages ?? 1)) {
      setPage((p) => p + 1);
    }
  }, [isFetching, data, page]);

  const handleItemPressIn = useCallback(
    (item: any) => {
      const mediaType =
        item.media_type ||
        (item._mediaType as "movie" | "tv" | undefined) ||
        filters.mediaType;
      const navItem = toDetailNavItem(
        item,
        mediaType === "tv" ? "tv" : "movie",
      );
      if (navItem) prepareDetail(navItem, "list", queryClient, router);
    },
    [queryClient, router, filters.mediaType],
  );

  const handleItemPress = useCallback(
    (item: any) => {
      const mediaType =
        item.media_type ||
        (item._mediaType as "movie" | "tv" | undefined) ||
        filters.mediaType;
      const navItem = toDetailNavItem(
        item,
        mediaType === "tv" ? "tv" : "movie",
      );
      if (navItem) openDetail(navItem, "list", { queryClient, router, nav });
    },
    [nav, router, queryClient, filters.mediaType],
  );

  const itemWidth = useMemo(
    () =>
      Math.floor(
        (SCREEN_WIDTH - PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS,
      ),
    [SCREEN_WIDTH],
  );

  const activeSortLabel =
    SORT_OPTIONS.find((s) => s.value === filters.sortBy)?.label ?? "Popular";
  const genreMap = filters.mediaType === "movie" ? MOVIE_GENRES : TV_GENRES;

  if (!config) {
    return (
      <View
        className="flex-1 items-center justify-center bg-void"
        style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
      >
        <Text className="text-text-secondary text-lg">Category not found</Text>
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          className="bg-primary rounded-xl py-3 px-8 mt-4"
          activeOpacity={0.8}
        >
          <Text className="text-void font-bold">Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Chip (shared by every filter row) ──
  const Chip = ({
    label,
    active,
    onPress,
  }: {
    label: string;
    active: boolean;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 9999,
        backgroundColor: active ? "rgba(212, 162, 55, 0.18)" : colors.bgSurface,
        borderWidth: 0.5,
        borderColor: active ? colors.gold : colors.borderSubtle,
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontFamily: "Inter_600SemiBold",
          color: active ? colors.gold : colors.textSecondary,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  // ── List-row rendering — delegates to the memoized module-scope row.
  // Callbacks are stable (useCallback above), so rows only re-render when
  // their own item identity changes.
  const renderListRow = useCallback(
    ({ item }: { item: any }) => (
      <ListRow
        item={item}
        mediaType={filters.mediaType}
        onPress={handleItemPress}
        onPressIn={handleItemPressIn}
      />
    ),
    [filters.mediaType, handleItemPress, handleItemPressIn],
  );

  const countLabel =
    totalResults != null ? `${formatCount(totalResults)} titles` : null;

  return (
    <View
      className="flex-1 bg-void"
      style={{ backgroundColor: colors.bg, paddingTop: insets.top }}
    >
      {/* ── Header: back · title · view toggle · filters ── */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: 6,
          gap: 8,
        }}
      >
        <TouchableOpacity
          onPress={() => nav.goBack({ fallback: "/(tabs)" })}
          activeOpacity={0.7}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "rgba(8,8,8,0.7)",
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingVertical: 6,
          }}
        >
          <BackIcon width={18} height={18} color={colors.textPrimary} />
          <Text
            style={{
              fontFamily: "Inter_500Medium",
              fontSize: 12,
              color: colors.textPrimary,
              marginLeft: 2,
            }}
          >
            Back
          </Text>
        </TouchableOpacity>

        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 19,
            color: colors.textPrimary,
            flex: 1,
            marginLeft: 4,
          }}
          numberOfLines={1}
        >
          {config.title}
        </Text>

        {/* Grid / list toggle */}
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setViewMode((v) => (v === "grid" ? "list" : "grid"));
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={
            viewMode === "grid" ? "Switch to list view" : "Switch to grid view"
          }
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.bgSurface,
            borderWidth: 0.5,
            borderColor: colors.borderSubtle,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={viewMode === "grid" ? "list" : "grid-outline"}
            size={17}
            color={colors.textSecondary}
          />
        </TouchableOpacity>

        {/* Filters toggle — badge dot when any filter is engaged */}
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowFilters((s) => !s);
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Toggle filters"
          accessibilityState={{ selected: showFilters }}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor:
              showFilters || hasActiveFilters
                ? "rgba(212, 162, 55, 0.18)"
                : colors.bgSurface,
            borderWidth: 0.5,
            borderColor:
              showFilters || hasActiveFilters
                ? colors.gold
                : colors.borderSubtle,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name="options-outline"
            size={17}
            color={
              showFilters || hasActiveFilters
                ? colors.gold
                : colors.textSecondary
            }
          />
          {hasActiveFilters && !showFilters && (
            <View
              style={{
                position: "absolute",
                top: 7,
                right: 7,
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: colors.gold,
              }}
            />
          )}
        </TouchableOpacity>
      </View>

      {/* ── Filter panel — horizontal chip lanes (compact, scannable). ── */}
      {showFilters && (
        <View
          style={{
            marginHorizontal: 12,
            marginBottom: 8,
            backgroundColor: colors.bgSurface,
            borderRadius: 14,
            borderWidth: 0.5,
            borderColor: colors.borderSubtle,
            paddingTop: 12,
            paddingBottom: 10,
          }}
        >
          {(
            [
              {
                label: "Type",
                chips: (["movie", "tv"] as const).map((t) => ({
                  key: t,
                  label: t === "movie" ? "Movies" : "TV Shows",
                  active: filters.mediaType === t,
                  onPress: () => updateFilters({ mediaType: t }),
                })),
              },
              {
                label: "Sort",
                chips: SORT_OPTIONS.map((opt) => ({
                  key: opt.value,
                  label: opt.label,
                  active: filters.sortBy === opt.value,
                  onPress: () => updateFilters({ sortBy: opt.value }),
                })),
              },
              {
                label: "Era",
                chips: DECADES.map((d) => ({
                  key: d.id,
                  label: d.label,
                  active: filters.decade === d.id,
                  onPress: () => updateFilters({ decade: d.id }),
                })),
              },
              {
                label: "Rating",
                chips: RATINGS.map((r) => ({
                  key: r.label,
                  label: r.label,
                  active: filters.minRating === r.value,
                  onPress: () => updateFilters({ minRating: r.value }),
                })),
              },
              {
                label: "Language",
                chips: LANGUAGES.map((l) => ({
                  key: l.label,
                  label: l.label,
                  active: filters.language === l.id,
                  onPress: () => updateFilters({ language: l.id }),
                })),
              },
              {
                label: "Genres",
                chips: Object.entries(genreMap).map(([id, name]) => ({
                  key: id,
                  label: String(name),
                  active: filters.genreIds.includes(Number(id)),
                  onPress: () => toggleGenre(Number(id)),
                })),
              },
            ] as const
          ).map((lane) => (
            <View key={lane.label} style={{ marginBottom: 10 }}>
              <Text
                style={{
                  fontSize: 10,
                  fontFamily: "Inter_700Bold",
                  color: colors.textTertiary,
                  letterSpacing: 0.8,
                  marginBottom: 6,
                  marginHorizontal: 12,
                }}
              >
                {lane.label.toUpperCase()}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 12,
                  gap: 6,
                }}
              >
                {lane.chips.map((chip) => (
                  <Chip
                    key={chip.key}
                    label={chip.label}
                    active={chip.active}
                    onPress={chip.onPress}
                  />
                ))}
              </ScrollView>
            </View>
          ))}

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 2,
              paddingHorizontal: 12,
            }}
          >
            <TouchableOpacity
              onPress={resetFilters}
              activeOpacity={0.7}
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <Ionicons name="refresh" size={13} color={colors.gold} />
              <Text
                style={{
                  color: colors.gold,
                  fontSize: 11,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                Reset filters
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowFilters(false)}
              activeOpacity={0.7}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                backgroundColor: "rgba(212, 162, 55, 0.18)",
                borderWidth: 0.5,
                borderColor: colors.gold,
                borderRadius: 9999,
                paddingHorizontal: 14,
                paddingVertical: 6,
              }}
            >
              <Text
                style={{
                  color: colors.gold,
                  fontSize: 11,
                  fontFamily: "Inter_700Bold",
                }}
              >
                Done
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Result summary strip ── */}
      {!isLoading && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: PADDING,
            paddingBottom: 6,
          }}
        >
          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 11,
              fontFamily: "Inter_500Medium",
            }}
            numberOfLines={1}
          >
            {countLabel
              ? `${countLabel} · ${activeSortLabel}`
              : activeSortLabel}
          </Text>
          {hasActiveFilters && !showFilters && (
            <TouchableOpacity
              onPress={resetFilters}
              activeOpacity={0.7}
              style={{ flexDirection: "row", alignItems: "center", gap: 3 }}
            >
              <Ionicons name="close-circle" size={12} color={colors.gold} />
              <Text
                style={{
                  color: colors.gold,
                  fontSize: 11,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                Reset
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Error state ── */}
      {isError ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 32,
          }}
        >
          <Ionicons
            name="cloud-offline-outline"
            size={44}
            color={colors.textTertiary}
          />
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 15,
              fontFamily: "Inter_600SemiBold",
              marginTop: 12,
              textAlign: "center",
            }}
          >
            Couldn't load titles
          </Text>
          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 12,
              fontFamily: "Inter_400Regular",
              marginTop: 4,
              textAlign: "center",
            }}
          >
            Check your connection and try again
          </Text>
          <TouchableOpacity
            onPress={() => {
              resetPagination();
              void refetch();
            }}
            activeOpacity={0.8}
            style={{
              marginTop: 16,
              backgroundColor: colors.gold,
              borderRadius: 12,
              paddingVertical: 10,
              paddingHorizontal: 24,
            }}
          >
            <Text
              style={{
                color: colors.bg,
                fontSize: 13,
                fontFamily: "Inter_600SemiBold",
              }}
            >
              Retry
            </Text>
          </TouchableOpacity>
        </View>
      ) : isLoading && page === 1 ? (
        /* ── Skeleton grid ── */
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            padding: PADDING,
            gap: GAP,
          }}
        >
          {Array.from({ length: 9 }).map((_, i) => (
            <View key={i} style={{ width: itemWidth }}>
              <View
                style={{
                  width: itemWidth,
                  height: itemWidth * 1.5,
                  borderRadius: 12,
                  backgroundColor: colors.skeletonBg,
                }}
              />
              <View
                style={{
                  width: "80%",
                  height: 10,
                  borderRadius: 4,
                  backgroundColor: colors.skeletonBg,
                  marginTop: 6,
                }}
              />
            </View>
          ))}
        </View>
      ) : allResults.length === 0 && !isFetching ? (
        /* ── Empty state ── */
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 32,
          }}
        >
          <Ionicons
            name="search-outline"
            size={44}
            color={colors.textTertiary}
          />
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 15,
              fontFamily: "Inter_600SemiBold",
              marginTop: 12,
              textAlign: "center",
            }}
          >
            Nothing matches these filters
          </Text>
          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 12,
              fontFamily: "Inter_400Regular",
              marginTop: 4,
              textAlign: "center",
            }}
          >
            Try widening the era, rating, or genres
          </Text>
          {hasActiveFilters && (
            <TouchableOpacity
              onPress={resetFilters}
              activeOpacity={0.8}
              style={{
                marginTop: 16,
                borderRadius: 12,
                paddingVertical: 10,
                paddingHorizontal: 24,
                backgroundColor: "rgba(212, 162, 55, 0.18)",
                borderWidth: 0.5,
                borderColor: colors.gold,
              }}
            >
              <Text
                style={{
                  color: colors.gold,
                  fontSize: 13,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                Reset filters
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        /* ── Results (grid or list) ── */
        <FlatList
          data={allResults}
          keyExtractor={(item) => String(item.id)}
          key={viewMode === "grid" ? "grid" : "list"}
          numColumns={viewMode === "grid" ? NUM_COLUMNS : 1}
          contentContainerStyle={{
            padding: PADDING,
            paddingBottom: 100,
            gap: GAP,
          }}
          columnWrapperStyle={viewMode === "grid" ? { gap: GAP } : undefined}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.gold}
            />
          }
          ListFooterComponent={
            allResults.length > 0 && isFetching ? (
              <View className="self-center mt-6 mb-8 py-1">
                <ActivityIndicator size="small" color={colors.gold} />
              </View>
            ) : allResults.length > 0 && !isFetching ? (
              <Text
                style={{
                  color: colors.textTertiary,
                  fontSize: 11,
                  fontFamily: "Inter_400Regular",
                  textAlign: "center",
                  marginTop: 12,
                  marginBottom: 8,
                }}
              >
                You've reached the end
              </Text>
            ) : null
          }
          renderItem={
            viewMode === "grid"
              ? ({ item }) => (
                  <View style={{ width: itemWidth }}>
                    <MediaCard
                      item={item}
                      onPress={handleItemPress}
                      onPressIn={handleItemPressIn}
                    />
                  </View>
                )
              : renderListRow
          }
        />
      )}
    </View>
  );
}
