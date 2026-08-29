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
  Keyboard,
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
import { ProgressiveImage } from "../../components/ProgressiveImage";
import type { Movie } from "@filmsnaps/shared";
import { useSettings } from "@/lib/settings";
import { colors } from "../../theme/colors";
import {
  animeSearch,
  rankAnimeSearchResults,
  type AnimeResult,
  type ScoredAnimeResult,
} from "../../lib/anime/search";
import { lookupMal } from "../../lib/anime/resolve";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";

const NUM_COLUMNS = 3;
const GAP = 10;
const PADDING = 16;
const ITEMS_PER_PAGE = 20;
const RECENT_SEARCHES_KEY = "@filmsnaps:recent_searches";

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

const POPULAR_SEARCH_TOPICS = [
  "Oppenheimer",
  "Dune",
  "Stranger Things",
  "Attack on Titan",
  "Spider-Man",
  "Interstellar",
  "Jujutsu Kaisen",
  "Breaking Bad",
];

const ANIME_POPULAR_TOPICS = [
  "Solo Leveling",
  "Demon Slayer",
  "Jujutsu Kaisen",
  "One Piece",
  "Bleach",
  "Chainsaw Man",
  "Death Note",
];

const GENRE_CARDS = [
  {
    id: 28,
    name: "Action",
    icon: "flash-outline",
    colors: ["#E11D48", "#881337"],
  },
  {
    id: 878,
    name: "Sci-Fi",
    icon: "planet-outline",
    colors: ["#2563EB", "#1E3A8A"],
  },
  {
    id: 35,
    name: "Comedy",
    icon: "happy-outline",
    colors: ["#D97706", "#78350F"],
  },
  {
    id: 18,
    name: "Drama",
    icon: "film-outline",
    colors: ["#7C3AED", "#4C1D95"],
  },
  {
    id: 27,
    name: "Horror",
    icon: "skull-outline",
    colors: ["#475569", "#0F172A"],
  },
  {
    id: 10749,
    name: "Romance",
    icon: "heart-outline",
    colors: ["#DB2777", "#831843"],
  },
  {
    id: 53,
    name: "Thriller",
    icon: "eye-outline",
    colors: ["#059669", "#064E3B"],
  },
  {
    id: 16,
    name: "Animation",
    icon: "sparkles-outline",
    colors: ["#CA8A04", "#713F12"],
  },
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
  const [isFocused, setIsFocused] = useState(false);
  const debouncedQuery = useDebounce(query, 300);
  const isSearching = debouncedQuery.length >= 2;

  // ── Recent Searches ──
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(RECENT_SEARCHES_KEY)
      .then((val) => {
        if (val) {
          try {
            setRecentSearches(JSON.parse(val));
          } catch {}
        }
      })
      .catch(() => {});
  }, []);

  const saveRecentSearch = useCallback((term: string) => {
    const trimmed = term.trim();
    if (trimmed.length < 2) return;
    setRecentSearches((prev) => {
      const next = [
        trimmed,
        ...prev.filter((t) => t.toLowerCase() !== trimmed.toLowerCase()),
      ].slice(0, 8);
      AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)).catch(
        () => {},
      );
      return next;
    });
  }, []);

  const removeRecentSearch = useCallback((term: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRecentSearches((prev) => {
      const next = prev.filter((t) => t !== term);
      AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)).catch(
        () => {},
      );
      return next;
    });
  }, []);

  const clearAllRecentSearches = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRecentSearches([]);
    AsyncStorage.removeItem(RECENT_SEARCHES_KEY).catch(() => {});
  }, []);

  // ── Filters ──
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

  // ── Anime mode ──
  const isAnimeMode = mediaTypeFilter === "anime";
  const [animeResults, setAnimeResults] = useState<ScoredAnimeResult[]>([]);
  const [animeLoading, setAnimeLoading] = useState(false);
  const [animeError, setAnimeError] = useState<string | null>(null);
  const animeReqId = useRef(0);

  const hasFilters =
    selectedGenreIds.length > 0 || mediaTypeFilter !== "movie_tv";

  // ── Hooks ──
  const searchResult = useSearch(
    isSearching ? debouncedQuery : "",
    isSearching ? page : 1,
  );

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

  const movieEnabled =
    !isSearching && hasFilters && mediaTypeFilter === "movie_tv";
  const tvEnabled =
    !isSearching && hasFilters && mediaTypeFilter === "movie_tv";

  const movieFilterResult = useFilteredMovies(movieParams, movieEnabled);
  const tvFilterResult = useFilteredTVShows(tvParams, tvEnabled);

  const isFilterMode = isSearching || hasFilters;

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

  useEffect(() => {
    if (!isSearching) return;
    if (!searchResult.data?.results) return;
    const next = searchResult.data.results.filter(
      (item: any) => item.media_type === "movie" || item.media_type === "tv",
    );
    const clean = filterTmdbAnime(next);
    if (clean.length) {
      appendUnique(clean);
      saveRecentSearch(debouncedQuery);
    }
  }, [
    searchResult.data,
    isSearching,
    appendUnique,
    debouncedQuery,
    saveRecentSearch,
  ]);

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
        const ranked = rankAnimeSearchResults(res.results, q, 24);
        setAnimeResults(ranked);
        if (ranked.length > 0) saveRecentSearch(q);
      })
      .catch(() => {
        if (id !== animeReqId.current) return;
        setAnimeError("Couldn't reach the anime search service.");
      })
      .finally(() => {
        if (id !== animeReqId.current) return;
        setAnimeLoading(false);
      });
  }, [isAnimeMode, debouncedQuery, saveRecentSearch]);

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

  const resetPagination = useCallback(() => {
    setPage(1);
    setAllResults([]);
    allResultsRef.current = [];
    consumedMoviePage.current = 0;
    consumedTvPage.current = 0;
  }, []);

  const toggleGenre = useCallback(
    (genreId: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setMediaTypeFilter(type);
      resetPagination();
    },
    [resetPagination],
  );

  const handleSortChange = useCallback(
    (opt: SortOption) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSortBy(opt);
      setShowSortPicker(false);
      resetPagination();
    },
    [resetPagination],
  );

  const handleClearFilters = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (query.trim()) saveRecentSearch(query.trim());
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
    [nav, router, queryClient, query, saveRecentSearch],
  );

  const handleAnimePress = useCallback(
    (item: AnimeResult) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (query.trim()) saveRecentSearch(query.trim());
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
    [nav, router, queryClient, query, saveRecentSearch],
  );

  const handleQueryChange = useCallback(
    (text: string) => {
      setQuery(text);
      resetPagination();
    },
    [resetPagination],
  );

  const selectTopic = useCallback(
    (topic: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setQuery(topic);
      saveRecentSearch(topic);
      resetPagination();
    },
    [resetPagination, saveRecentSearch],
  );

  // Exact mathematical width for 3-column cards
  const itemWidth = useMemo(
    () =>
      Math.floor(
        (SCREEN_WIDTH - PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS,
      ),
    [SCREEN_WIDTH],
  );
  const itemHeight = useMemo(() => Math.round(itemWidth * 1.5), [itemWidth]);

  const isFirstLoad =
    isFilterMode &&
    page === 1 &&
    (isSearching
      ? searchResult.isLoading
      : movieFilterResult.isLoading || tvFilterResult.isLoading);

  const activeSortLabel =
    SORT_OPTIONS.find((s) => s.value === sortBy)?.label || "Popular";

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        paddingTop: insets.top,
      }}
    >
      {/* ─── Search Header ─── */}
      <View
        style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 }}
      >
        <Text
          style={{
            fontFamily: "PlayfairDisplay_700Bold",
            fontSize: 24,
            color: colors.textPrimary,
            marginBottom: 12,
          }}
        >
          Search
        </Text>

        {/* Search Bar Input */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            height: 46,
            borderRadius: 14,
            paddingHorizontal: 14,
            backgroundColor: colors.bgCard,
            borderWidth: 0.5,
            borderColor: isFocused ? colors.gold : colors.borderSubtle,
          }}
        >
          <Ionicons
            name="search"
            size={18}
            color={isFocused ? colors.gold : colors.textSecondary}
          />
          <TextInput
            style={{
              flex: 1,
              marginLeft: 10,
              fontSize: 14,
              fontFamily: "Inter_500Medium",
              color: colors.textPrimary,
              paddingVertical: 0,
            }}
            placeholder="Search movies, TV shows, anime..."
            placeholderTextColor={colors.textTertiary}
            value={query}
            onChangeText={handleQueryChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => {
              if (query.trim()) saveRecentSearch(query.trim());
            }}
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setQuery("");
                resetPagination();
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.textTertiary}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Segmented Mode Switcher */}
        <View style={{ marginTop: 10 }}>
          <View
            style={{
              flexDirection: "row",
              backgroundColor: colors.bgCard,
              borderRadius: 12,
              padding: 3,
              borderWidth: 0.5,
              borderColor: colors.borderSubtle,
            }}
          >
            {(["movie_tv", "anime"] as const).map((type) => {
              const active = mediaTypeFilter === type;
              return (
                <TouchableOpacity
                  key={type}
                  onPress={() => handleMediaTypeChange(type)}
                  activeOpacity={0.75}
                  style={{
                    flex: 1,
                    paddingVertical: 7,
                    borderRadius: 9,
                    alignItems: "center",
                    backgroundColor: active ? colors.gold : "transparent",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: "Inter_600SemiBold",
                      color: active ? colors.bg : colors.textSecondary,
                    }}
                  >
                    {type === "movie_tv" ? "Movies & TV" : "Anime"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Genre Pills & Sort Button */}
        {!isAnimeMode && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginTop: 10,
            }}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6, paddingRight: 8 }}
            >
              {Object.entries(MOVIE_GENRES)
                .slice(0, 10)
                .map(([id, name]) => {
                  const numId = Number(id);
                  const isSelected = selectedGenreIds.includes(numId);
                  return (
                    <TouchableOpacity
                      key={id}
                      onPress={() => toggleGenre(numId)}
                      activeOpacity={0.75}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 5,
                        borderRadius: 9999,
                        backgroundColor: isSelected
                          ? "rgba(212, 162, 55, 0.18)"
                          : colors.bgCard,
                        borderWidth: 0.5,
                        borderColor: isSelected
                          ? colors.gold
                          : colors.borderSubtle,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          fontFamily: "Inter_600SemiBold",
                          color: isSelected
                            ? colors.gold
                            : colors.textSecondary,
                        }}
                      >
                        {name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
            </ScrollView>

            {/* Sort Button */}
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowSortPicker((p) => !p);
              }}
              activeOpacity={0.75}
              style={{
                flexDirection: "row",
                alignItems: "center",
                height: 28,
                paddingHorizontal: 10,
                borderRadius: 9999,
                backgroundColor: showSortPicker ? colors.gold : colors.bgCard,
                borderWidth: 0.5,
                borderColor: showSortPicker ? colors.gold : colors.borderSubtle,
                gap: 4,
              }}
            >
              <Ionicons
                name="swap-vertical-outline"
                size={13}
                color={showSortPicker ? colors.bg : colors.gold}
              />
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: "Inter_600SemiBold",
                  color: showSortPicker ? colors.bg : colors.textSecondary,
                }}
              >
                {activeSortLabel}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Sort Picker Dropdown */}
        {showSortPicker && (
          <View
            style={{
              marginTop: 8,
              backgroundColor: colors.bgCard,
              borderRadius: 14,
              borderWidth: 0.5,
              borderColor: colors.borderSubtle,
              overflow: "hidden",
            }}
          >
            {SORT_OPTIONS.map((opt, idx) => {
              const isSelected = sortBy === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => handleSortChange(opt.value)}
                  activeOpacity={0.75}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderBottomWidth:
                      idx === SORT_OPTIONS.length - 1 ? 0 : 0.5,
                    borderBottomColor: colors.borderSubtle,
                    backgroundColor: isSelected
                      ? "rgba(212, 162, 55, 0.1)"
                      : colors.bgCard,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: "Inter_600SemiBold",
                      color: isSelected ? colors.gold : colors.textPrimary,
                    }}
                  >
                    {opt.label}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark" size={16} color={colors.gold} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Active Filters Clear Row */}
        {hasFilters && (
          <View
            style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}
          >
            <TouchableOpacity
              onPress={handleClearFilters}
              activeOpacity={0.7}
              style={{ flexDirection: "row", alignItems: "center" }}
            >
              <Ionicons name="close-circle" size={13} color={colors.gold} />
              <Text
                style={{
                  color: colors.gold,
                  fontSize: 11,
                  fontFamily: "Inter_600SemiBold",
                  marginLeft: 4,
                }}
              >
                Clear all filters
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ─── Content ─── */}
      {isAnimeMode && isSearching ? (
        // Anime Search Results
        <View style={{ flex: 1 }}>
          {animeLoading ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ActivityIndicator size="large" color={colors.gold} />
            </View>
          ) : animeError ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 32,
              }}
            >
              <Ionicons
                name="alert-circle-outline"
                size={42}
                color={colors.error}
              />
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 13,
                  fontFamily: "Inter_500Medium",
                  marginTop: 12,
                  textAlign: "center",
                }}
              >
                {animeError}
              </Text>
            </View>
          ) : animeResults.length === 0 ? (
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
                  fontSize: 16,
                  fontFamily: "Inter_600SemiBold",
                  marginTop: 12,
                  textAlign: "center",
                }}
              >
                No anime found
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
                Try searching with a Japanese or English title
              </Text>
            </View>
          ) : (
            <FlatList
              data={animeResults}
              keyExtractor={(item) => String(item.malId)}
              numColumns={NUM_COLUMNS}
              keyboardShouldPersistTaps="always"
              contentContainerStyle={{
                paddingHorizontal: PADDING,
                paddingBottom: 100 + insets.bottom,
                gap: GAP,
              }}
              columnWrapperStyle={{ gap: GAP }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => handleAnimePress(item)}
                  style={{ width: itemWidth, marginBottom: 8 }}
                >
                  <View
                    style={{
                      width: itemWidth,
                      height: itemHeight,
                      borderRadius: 12,
                      overflow: "hidden",
                      backgroundColor: colors.bgElevated,
                      borderWidth: 0.5,
                      borderColor: colors.borderSubtle,
                    }}
                  >
                    {item.image ? (
                      <ProgressiveImage
                        uri={item.image}
                        style={{ width: itemWidth, height: itemHeight }}
                        resizeMode="cover"
                      />
                    ) : (
                      <View
                        style={{
                          flex: 1,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: colors.bgSurface,
                        }}
                      >
                        <Ionicons
                          name="tv-outline"
                          size={24}
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
        // Loading Skeleton Grid
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            paddingHorizontal: PADDING,
            gap: GAP,
            paddingTop: 8,
          }}
        >
          {Array.from({ length: 9 }).map((_, i) => (
            <View key={i} style={{ width: itemWidth, marginBottom: 12 }}>
              <View
                style={{
                  width: itemWidth,
                  height: itemHeight,
                  borderRadius: 12,
                  backgroundColor: colors.skeletonBg,
                  borderWidth: 0.5,
                  borderColor: colors.borderSubtle,
                }}
              />
              <View
                style={{
                  width: "80%",
                  height: 12,
                  borderRadius: 4,
                  backgroundColor: colors.skeletonBg,
                  marginTop: 6,
                }}
              />
            </View>
          ))}
        </View>
      ) : isFilterMode ? (
        // Movies & TV Search / Filter Grid
        <FlatList
          data={allResults}
          keyExtractor={(item: any) => String(item.id)}
          numColumns={NUM_COLUMNS}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={{
            paddingHorizontal: PADDING,
            paddingBottom: 100 + insets.bottom,
            paddingTop: 8,
            gap: GAP,
          }}
          columnWrapperStyle={{ gap: GAP }}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            !isFirstLoad && page === 1 && !isFetchingCurrent ? (
              <View
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 32,
                  paddingTop: 60,
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
                    fontSize: 16,
                    fontFamily: "Inter_600SemiBold",
                    marginTop: 12,
                    textAlign: "center",
                  }}
                >
                  {hasFilters ? "No matching titles" : "No results found"}
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
                  {hasFilters
                    ? "Try adjusting your filters or search keywords"
                    : "Try searching with a different name or spelling"}
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            allResults.length > 0 ? (
              <View
                style={{
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 12,
                  marginBottom: 16,
                  minHeight: 36,
                }}
              >
                {isFetchingCurrent ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <ActivityIndicator size="small" color={colors.gold} />
                    <Text
                      style={{
                        color: colors.textSecondary,
                        fontSize: 12,
                        fontFamily: "Inter_500Medium",
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
            <View style={{ width: itemWidth, marginBottom: 8 }}>
              <MediaCard item={item} onPress={handleItemPress} />
            </View>
          )}
        />
      ) : (
        // ── Pre-Search Discovery Hub (When query is empty & no genre is selected) ──
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 100 + insets.bottom,
            paddingTop: 8,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* 1. Recent Searches */}
          {recentSearches.length > 0 && (
            <View style={{ marginBottom: 22 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontFamily: "Inter_600SemiBold",
                    color: colors.textPrimary,
                  }}
                >
                  Recent Searches
                </Text>
                <TouchableOpacity
                  onPress={clearAllRecentSearches}
                  activeOpacity={0.7}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontFamily: "Inter_500Medium",
                      color: colors.textTertiary,
                    }}
                  >
                    Clear all
                  </Text>
                </TouchableOpacity>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                {recentSearches.map((term) => (
                  <View
                    key={term}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: colors.bgCard,
                      borderRadius: 9999,
                      paddingLeft: 12,
                      paddingRight: 6,
                      paddingVertical: 6,
                      borderWidth: 0.5,
                      borderColor: colors.borderSubtle,
                    }}
                  >
                    <TouchableOpacity
                      onPress={() => selectTopic(term)}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontFamily: "Inter_500Medium",
                          color: colors.textSecondary,
                          marginRight: 6,
                        }}
                      >
                        {term}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => removeRecentSearch(term)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons
                        name="close"
                        size={14}
                        color={colors.textTertiary}
                      />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* 2. Trending / Quick Suggestions */}
          <View style={{ marginBottom: 24 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 10,
                gap: 6,
              }}
            >
              <Ionicons name="flame" size={15} color={colors.gold} />
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: "Inter_600SemiBold",
                  color: colors.textPrimary,
                }}
              >
                {isAnimeMode ? "Popular Anime" : "Trending Searches"}
              </Text>
            </View>

            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {(isAnimeMode ? ANIME_POPULAR_TOPICS : POPULAR_SEARCH_TOPICS).map(
                (topic) => (
                  <TouchableOpacity
                    key={topic}
                    onPress={() => selectTopic(topic)}
                    activeOpacity={0.75}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: 9999,
                      backgroundColor: colors.bgCard,
                      borderWidth: 0.5,
                      borderColor: colors.borderSubtle,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontFamily: "Inter_500Medium",
                        color: colors.textSecondary,
                      }}
                    >
                      {topic}
                    </Text>
                  </TouchableOpacity>
                ),
              )}
            </View>
          </View>

          {/* 3. Explore by Genre Bento */}
          {!isAnimeMode && (
            <View>
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: "Inter_600SemiBold",
                  color: colors.textPrimary,
                  marginBottom: 12,
                }}
              >
                Browse by Genre
              </Text>

              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                {GENRE_CARDS.map((g) => {
                  const cardW = Math.floor((SCREEN_WIDTH - 32 - 10) / 2);
                  return (
                    <TouchableOpacity
                      key={g.id}
                      onPress={() => toggleGenre(g.id)}
                      activeOpacity={0.8}
                      style={{
                        width: cardW,
                        height: 64,
                        borderRadius: 14,
                        overflow: "hidden",
                        borderWidth: 0.5,
                        borderColor: colors.borderSubtle,
                      }}
                    >
                      <LinearGradient
                        colors={[g.colors[0], g.colors[1]]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{
                          flex: 1,
                          padding: 12,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 14,
                            fontFamily: "Inter_600SemiBold",
                            color: "#fff",
                          }}
                        >
                          {g.name}
                        </Text>
                        <Ionicons
                          name={g.icon as any}
                          size={22}
                          color="rgba(255, 255, 255, 0.7)"
                        />
                      </LinearGradient>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
