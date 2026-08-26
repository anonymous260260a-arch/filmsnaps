import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useSafeNavigation } from "@/lib/navigation";
import { MOVIE_GENRES, TV_GENRES } from "@filmsnaps/shared";
import { useDebounce } from "../../hooks/useDebounce";
import {
  useSearch,
  useFilteredMovies,
  useFilteredTVShows,
} from "../../hooks/useTMDB";
import { tmdbApi } from "../../lib/api";
import { filterTmdbAnime } from "../../lib/tmdb";
import { MediaCard } from "../../components/MediaCard";
import { EmptyState } from "../../components/EmptyState";
import { ProgressiveImage } from "../../components/ProgressiveImage";
import type { Movie } from "@filmsnaps/shared";
import { useSettings } from "@/lib/settings";
import { SwipeExemptScrollView } from "../../components/SwipeExemptScroll";
import { colors } from "../../theme/colors";
import {
  animeSearch,
  rankAnimeSearchResults,
  type AnimeResult,
  type ScoredAnimeResult,
} from "../../lib/anime/search";
import { lookupMal } from "../../lib/anime/resolve";

const NUM_COLUMNS = 3;
const GAP = 8;
const PADDING = 16;
const ITEMS_PER_PAGE = 20;

type MediaTypeFilter = "movie_tv" | "anime";
type SortOption =
  | "popularity.desc"
  | "vote_average.desc"
  | "primary_release_date.desc";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "popularity.desc", label: "Popular" },
  { value: "vote_average.desc", label: "Top Rated" },
  { value: "primary_release_date.desc", label: "Latest" },
];

export default function SearchScreen() {
  const nav = useSafeNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const queryClient = useQueryClient();
  const { settings } = useSettings();

  // ── Search state ──
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const isSearching = debouncedQuery.length >= 2;

  // ── Filters ──
  // Auto-select by the global Hard Mode Split: anime mode shows the anime
  // filter, movie_tv mode shows the combined movie/TV filter.
  const [mediaTypeFilter, setMediaTypeFilter] = useState<MediaTypeFilter>(
    settings.mode === "anime" ? "anime" : "movie_tv",
  );
  const [selectedGenreIds, setSelectedGenreIds] = useState<number[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>("popularity.desc");
  const [showSortPicker, setShowSortPicker] = useState(false);

  // ── Pagination ──
  const [page, setPage] = useState(1);
  const [allResults, setAllResults] = useState<any[]>([]);
  const allResultsRef = useRef<any[]>([]);
  const consumedMoviePage = useRef<number>(0);
  const consumedTvPage = useRef<number>(0);

  // ── Anime mode (filtered via the media-type toggle) ──
  const isAnimeMode = mediaTypeFilter === "anime";
  const [animeResults, setAnimeResults] = useState<ScoredAnimeResult[]>([]);
  const [animeLoading, setAnimeLoading] = useState(false);
  const [animeError, setAnimeError] = useState<string | null>(null);
  const animeReqId = useRef(0);

  const hasFilters =
    selectedGenreIds.length > 0 || mediaTypeFilter !== "movie_tv";

  // ── Hooks ──

  // Search mode hooks
  const searchResult = useSearch(
    isSearching ? debouncedQuery : "",
    isSearching ? page : 1,
  );

  // Discover/filter mode hooks — memoize params to keep query key stable
  const movieParams = useMemo(
    () => ({
      genreIds: selectedGenreIds.length ? selectedGenreIds : undefined,
      sortBy,
      page,
    }),
    [selectedGenreIds, sortBy, page],
  );
  const tvParams = useMemo(
    () => ({
      genreIds: selectedGenreIds.length ? selectedGenreIds : undefined,
      sortBy,
      page,
    }),
    [selectedGenreIds, sortBy, page],
  );

  // Only fetch the discover queries when there is actually something to load:
  // a genre is selected, a media-type filter is active, or a search is running.
  // Without this, the hooks fire a "discover with no filters" request on every
  // mount (even when nothing is selected), flipping isLoading true and briefly
  // painting the skeleton loader over the empty state.
  const movieEnabled =
    !isSearching && hasFilters && mediaTypeFilter === "movie_tv";
  const tvEnabled =
    !isSearching && hasFilters && mediaTypeFilter === "movie_tv";

  const movieFilterResult = useFilteredMovies(movieParams, movieEnabled);
  const tvFilterResult = useFilteredTVShows(tvParams, tvEnabled);

  // ── Determine active data source ──
  const isFilterMode = isSearching || hasFilters;

  // Whether we're currently fetching the current page
  const isFetchingCurrent = isSearching
    ? searchResult.isFetching
    : movieFilterResult.isFetching || tvFilterResult.isFetching;

  // ── Accumulate results across pages ──
  const appendUnique = useCallback((incoming: any[]) => {
    setAllResults((prev) => {
      const existingIds = new Set(prev.map((p: any) => p.id));
      const fresh = incoming.filter((i: any) => !existingIds.has(i.id));
      if (fresh.length === 0) return prev;
      const next = [...prev, ...fresh];
      allResultsRef.current = next;
      return next;
    });
  }, []);

  // Search mode — single source, simple
  useEffect(() => {
    if (!isSearching) return;
    if (!searchResult.data?.results) return;
    const next = searchResult.data.results.filter(
      (item: any) => item.media_type === "movie" || item.media_type === "tv",
    );
    const clean = filterTmdbAnime(next);
    if (clean.length) appendUnique(clean);
  }, [searchResult.data, isSearching, appendUnique]);

  // Movie source — gated by consumed page counter
  useEffect(() => {
    if (isSearching) return;
    if (mediaTypeFilter !== "movie_tv") return;
    const data = movieFilterResult.data;
    if (!data?.results?.length) return;
    const thisPage = data.page ?? page;
    if (thisPage <= consumedMoviePage.current) return;
    consumedMoviePage.current = thisPage;
    const tagged = data.results.map((r: any) => ({
      ...r,
      _mediaType: "movie" as const,
    }));
    appendUnique(filterTmdbAnime(tagged));
  }, [
    movieFilterResult.data,
    isSearching,
    mediaTypeFilter,
    appendUnique,
    page,
  ]);

  // TV source — gated by consumed page counter
  useEffect(() => {
    if (isSearching) return;
    if (mediaTypeFilter !== "movie_tv") return;
    const data = tvFilterResult.data;
    if (!data?.results?.length) return;
    const thisPage = data.page ?? page;
    if (thisPage <= consumedTvPage.current) return;
    consumedTvPage.current = thisPage;
    const tagged = data.results.map((r: any) => ({
      ...r,
      _mediaType: "tv" as const,
    }));
    appendUnique(filterTmdbAnime(tagged));
  }, [tvFilterResult.data, isSearching, mediaTypeFilter, appendUnique, page]);

  // Anime mode — independent of TMDB movie/TV hooks (AniList-backed).
  // Only meaningful with a typed query, like the other search sources.
  useEffect(() => {
    if (!isAnimeMode) {
      if (animeResults.length || animeError) {
        setAnimeResults([]);
        setAnimeError(null);
      }
      return;
    }
    const q = debouncedQuery.trim();
    if (q.length < 2) {
      setAnimeResults([]);
      setAnimeError(null);
      setAnimeLoading(false);
      return;
    }
    const id = ++animeReqId.current;
    setAnimeLoading(true);
    setAnimeError(null);
    animeSearch(q, 30)
      .then((res) => {
        if (id !== animeReqId.current) return;
        setAnimeResults(rankAnimeSearchResults(res.results, q, 24));
      })
      .catch(() => {
        if (id !== animeReqId.current) return;
        setAnimeError("Couldn't reach the anime search service.");
      })
      .finally(() => {
        if (id !== animeReqId.current) return;
        setAnimeLoading(false);
      });
  }, [isAnimeMode, debouncedQuery]);

  // ── Check if there are more pages ──
  const hasMorePages = useMemo(() => {
    if (isSearching) {
      const totalPages = searchResult.data?.total_pages ?? 0;
      return page < totalPages && totalPages > 1;
    }
    const moviePages = movieFilterResult.data?.total_pages ?? 0;
    const tvPages = tvFilterResult.data?.total_pages ?? 0;
    if (mediaTypeFilter === "movie_tv")
      return page < Math.max(moviePages, tvPages);
    return false;
  }, [
    isSearching,
    searchResult.data,
    movieFilterResult.data,
    tvFilterResult.data,
    page,
    mediaTypeFilter,
  ]);

  // ── Reset when filters change ──
  const resetPagination = useCallback(() => {
    setPage(1);
    setAllResults([]);
    allResultsRef.current = [];
    consumedMoviePage.current = 0;
    consumedTvPage.current = 0;
  }, []);

  // ── Handlers ──

  const toggleGenre = useCallback(
    (genreId: number) => {
      setSelectedGenreIds((prev) =>
        prev.includes(genreId)
          ? prev.filter((g) => g !== genreId)
          : [...prev, genreId],
      );
      resetPagination();
    },
    [resetPagination],
  );

  const handleMediaTypeChange = useCallback(
    (type: MediaTypeFilter) => {
      setMediaTypeFilter(type);
      resetPagination();
    },
    [resetPagination],
  );

  const handleSortChange = useCallback(
    (opt: SortOption) => {
      setSortBy(opt);
      setShowSortPicker(false);
      resetPagination();
    },
    [resetPagination],
  );

  const handleClearFilters = useCallback(() => {
    setSelectedGenreIds([]);
    setMediaTypeFilter(settings.mode === "anime" ? "anime" : "movie_tv");
    setSortBy("popularity.desc");
    setQuery("");
    resetPagination();
  }, [resetPagination, settings.mode]);

  const handleLoadMore = useCallback(() => {
    if (!isFetchingCurrent && hasMorePages) {
      setPage((p) => p + 1);
    }
  }, [isFetchingCurrent, hasMorePages]);

  const handleItemPress = useCallback(
    (item: Movie) => {
      const mediaType = (item as any)._mediaType || item.media_type || "movie";
      const id = item.id;

      if (mediaType === "tv") {
        queryClient.prefetchQuery({
          queryKey: ["tv", id],
          queryFn: () => tmdbApi.getTVDetails(id),
          staleTime: 1000 * 60 * 60,
        });
        router.prefetch(`/tv/${id}`);
        nav.push(`/tv/${id}`);
      } else {
        queryClient.prefetchQuery({
          queryKey: ["movie", id],
          queryFn: () => tmdbApi.getMovieDetails(id),
          staleTime: 1000 * 60 * 60,
        });
        router.prefetch(`/movie/${id}`);
        nav.push(`/movie/${id}`);
      }
    },
    [nav, router, queryClient],
  );

  const handleQueryChange = useCallback(
    (text: string) => {
      setQuery(text);
      resetPagination();
    },
    [resetPagination],
  );

  // Anime result → resolve its TMDB twin, then open the native detail page
  // (which carries the anime threading into the player). If no twin exists,
  // surface that the title isn't on FilmSnaps.
  const handleAnimePress = useCallback(
    (item: AnimeResult) => {
      const twin = lookupMal(item.malId);
      const tmdbShowId = twin?.tmdbShowId;
      const tmdbMovieId = twin?.tmdbMovieId;
      if (tmdbShowId != null) {
        queryClient.prefetchQuery({
          queryKey: ["tv", tmdbShowId],
          queryFn: () => tmdbApi.getTVDetails(tmdbShowId),
          staleTime: 1000 * 60 * 60,
        });
        router.prefetch(`/tv/${tmdbShowId}`);
        nav.push(`/tv/${tmdbShowId}`);
      } else if (tmdbMovieId != null) {
        queryClient.prefetchQuery({
          queryKey: ["movie", tmdbMovieId],
          queryFn: () => tmdbApi.getMovieDetails(tmdbMovieId),
          staleTime: 1000 * 60 * 60,
        });
        router.prefetch(`/movie/${tmdbMovieId}`);
        nav.push(`/movie/${tmdbMovieId}`);
      } else {
        setAnimeError(
          `No matching FilmSnaps title for "${item.titleEnglish || item.title}".`,
        );
      }
    },
    [nav, router, queryClient],
  );

  // ── Dimensions ──
  const itemWidth = useMemo(
    () => (SCREEN_WIDTH - PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS,
    [SCREEN_WIDTH],
  );
  const itemHeight = useMemo(() => itemWidth * 1.5 + 40, [itemWidth]);

  // ── Loading state (first page only) ──
  // Gated on isFilterMode so that an unselected, empty search page (nothing
  // typed, no filters) never shows the skeleton — there is nothing to load.
  const isFirstLoad =
    isFilterMode &&
    page === 1 &&
    (isSearching
      ? searchResult.isLoading
      : movieFilterResult.isLoading || tvFilterResult.isLoading);

  return (
    <View
      className="flex-1 bg-void"
      style={{ paddingTop: insets.top, backgroundColor: colors.bg }}
    >
      {/* ─── Search header ─── */}
      <View className="px-4 pt-4 pb-2">
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 22,
            color: colors.textPrimary,
          }}
        >
          Search
        </Text>

        {/* Search bar */}
        <View className="flex-row items-center bg-elevated rounded-[50] px-4 h-11 border-[0.5px] border-subtle">
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            className="flex-1 text-text-primary text-base ml-2.5"
            placeholder="Movies, TV shows..."
            placeholderTextColor={colors.textTertiary}
            value={query}
            onChangeText={handleQueryChange}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setQuery("");
                resetPagination();
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.textTertiary}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Media type toggle — two-way: Movies/TV vs Anime (auto-selected by mode) */}
        <View className="flex-row mt-3 bg-zinc-900 rounded-lg p-0.5">
          {(["movie_tv", "anime"] as const).map((type) => (
            <TouchableOpacity
              key={type}
              onPress={() => handleMediaTypeChange(type)}
              className={`flex-1 py-2 rounded-md items-center ${mediaTypeFilter === type ? "bg-primary" : ""}`}
              activeOpacity={0.7}
            >
              <Text
                className={`text-xs font-bold ${mediaTypeFilter === type ? "text-void" : "text-zinc-400"}`}
              >
                {type === "movie_tv" ? "Movies / TV" : "Anime"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Genre pills + sort */}
        <View className="flex-row items-center mt-3">
          <SwipeExemptScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-1"
            contentContainerStyle={{ gap: 6 }}
          >
            {Object.entries(MOVIE_GENRES)
              .slice(0, 10)
              .map(([id, name]) => (
                <TouchableOpacity
                  key={id}
                  onPress={() => toggleGenre(Number(id))}
                  activeOpacity={0.7}
                  className={`px-3 py-1.5 rounded-full border ${
                    selectedGenreIds.includes(Number(id))
                      ? "border-primary bg-primary/10"
                      : "border-zinc-700 bg-zinc-800/50"
                  }`}
                >
                  <Text
                    className={`text-[10px] font-semibold ${
                      selectedGenreIds.includes(Number(id))
                        ? "text-primary"
                        : "text-zinc-300"
                    }`}
                  >
                    {name}
                  </Text>
                </TouchableOpacity>
              ))}
          </SwipeExemptScrollView>
          {/* Sort button */}
          <TouchableOpacity
            onPress={() => setShowSortPicker((p) => !p)}
            className="ml-2 w-9 h-9 rounded-full bg-zinc-800 items-center justify-center"
            activeOpacity={0.7}
          >
            <Ionicons
              name="funnel-outline"
              size={16}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* Sort picker */}
        {showSortPicker && (
          <View className="mt-2 bg-zinc-900 rounded-xl p-1 border border-zinc-700">
            {SORT_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                onPress={() => handleSortChange(opt.value)}
                className={`px-4 py-2.5 rounded-lg ${sortBy === opt.value ? "bg-primary/20" : ""}`}
                activeOpacity={0.7}
              >
                <Text
                  className={`text-sm ${sortBy === opt.value ? "text-primary font-bold" : "text-zinc-300"}`}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Clear filters */}
        {hasFilters && (
          <TouchableOpacity
            onPress={handleClearFilters}
            className="self-start mt-2"
            activeOpacity={0.7}
          >
            <Text className="text-primary text-xs font-semibold">
              Clear filters
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ─── Content ─── */}
      {isAnimeMode ? (
        // Anime mode — AniList-backed grid; tapping opens the TMDB twin.
        <View style={{ flex: 1 }}>
          {animeLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={colors.gold} />
            </View>
          ) : animeError ? (
            <View className="flex-1 items-center justify-center px-8">
              <Ionicons
                name="alert-circle-outline"
                size={44}
                color={colors.progressTrack}
              />
              <Text className="text-zinc-400 text-sm mt-4 text-center">
                {animeError}
              </Text>
            </View>
          ) : animeResults.length === 0 ? (
            <View className="flex-1 items-center justify-center px-8">
              <Ionicons
                name="tv-outline"
                size={48}
                color={colors.progressTrack}
              />
              <Text className="text-zinc-400 text-base mt-4 text-center">
                {debouncedQuery.trim().length >= 2
                  ? "No anime found"
                  : "Search anime titles"}
              </Text>
              <Text className="text-zinc-600 text-sm mt-2 text-center">
                Type at least 2 characters
              </Text>
            </View>
          ) : (
            <FlatList
              data={animeResults}
              keyExtractor={(item) => String(item.malId)}
              numColumns={NUM_COLUMNS}
              keyboardShouldPersistTaps="always"
              contentContainerStyle={{
                padding: PADDING,
                paddingBottom: 100,
                flexGrow: 1,
              }}
              columnWrapperStyle={{ gap: GAP }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => handleAnimePress(item)}
                  style={{ width: itemWidth, marginBottom: 14 }}
                >
                  <View
                    className="bg-elevated rounded-xl overflow-hidden"
                    style={{ width: itemWidth, height: itemHeight - 40 }}
                  >
                    {item.image ? (
                      <ProgressiveImage
                        uri={item.image}
                        style={{ width: itemWidth, height: itemHeight - 40 }}
                        resizeMode="cover"
                      />
                    ) : (
                      <View className="flex-1 items-center justify-center bg-elevated">
                        <Ionicons
                          name="tv-outline"
                          size={28}
                          color={colors.textTertiary}
                        />
                      </View>
                    )}
                  </View>
                  <Text
                    style={{
                      color: colors.textSecondary,
                      fontSize: 12,
                      fontFamily: "Inter_500Medium",
                      marginTop: 6,
                    }}
                    numberOfLines={2}
                  >
                    {item.titleEnglish || item.title}
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      ) : isFirstLoad ? (
        // Loading skeleton
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
                  height: itemHeight,
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
      ) : isFilterMode ? (
        // Search or filter results — grid with infinite scroll
        <FlatList
          data={allResults}
          keyExtractor={(item: any) => String(item.id)}
          numColumns={NUM_COLUMNS}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={{
            padding: PADDING,
            paddingBottom: 100,
            flexGrow: 1,
          }}
          columnWrapperStyle={{ gap: GAP }}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            !isFirstLoad && page === 1 && !isFetchingCurrent ? (
              <View
                className="flex-1 items-center justify-center px-8"
                style={{ paddingTop: 80 }}
              >
                <Ionicons
                  name="search-outline"
                  size={48}
                  color={colors.progressTrack}
                />
                <Text className="text-zinc-400 text-base mt-4 text-center">
                  {hasFilters ? "No results found" : "Search movies & TV shows"}
                </Text>
                <Text className="text-zinc-600 text-sm mt-2 text-center">
                  {hasFilters
                    ? "Try different filters or search term"
                    : "Type at least 2 characters, or use filters to discover"}
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            allResults.length > 0 ? (
              <View
                className="self-center mt-4 mb-8 py-1"
                style={{ minHeight: 40 }}
              >
                {isFetchingCurrent ? (
                  <View className="flex-row items-center" style={{ gap: 8 }}>
                    <ActivityIndicator size="small" color={colors.gold} />
                    <Text
                      style={{
                        color: colors.textSecondary,
                        fontSize: 12,
                        fontFamily: "Inter_400Regular",
                      }}
                    >
                      Loading more...
                    </Text>
                  </View>
                ) : !hasMorePages && allResults.length >= ITEMS_PER_PAGE ? (
                  <Text
                    style={{
                      color: colors.textTertiary,
                      fontSize: 11,
                      fontFamily: "Inter_400Regular",
                    }}
                  >
                    You've reached the end
                  </Text>
                ) : null}
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={{ width: itemWidth }}>
              <MediaCard item={item} onPress={handleItemPress} />
            </View>
          )}
        />
      ) : (
        // Empty state — no query, no filters
        // Show a helpful prompt instead of carousel previews
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="search" size={48} color={colors.progressTrack} />
          <Text className="text-zinc-400 text-base mt-4 text-center">
            Search movies & TV shows
          </Text>
          <Text className="text-zinc-600 text-sm mt-2 text-center">
            Type at least 2 characters, or use filters to discover
          </Text>
          {/* Quick filter chips to get started */}
          <View
            className="flex-row flex-wrap justify-center mt-6"
            style={{ gap: 8 }}
          >
            {[
              { id: 28, name: "Action" },
              { id: 35, name: "Comedy" },
              { id: 18, name: "Drama" },
              { id: 878, name: "Sci-Fi" },
              { id: 53, name: "Thriller" },
            ].map((g) => (
              <TouchableOpacity
                key={g.id}
                onPress={() => toggleGenre(g.id)}
                activeOpacity={0.7}
                className="px-4 py-2 rounded-full border border-zinc-700 bg-zinc-800/50"
              >
                <Text className="text-zinc-300 text-xs font-semibold">
                  {g.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
