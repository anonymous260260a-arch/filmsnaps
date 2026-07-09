import { tmdbApi } from './api';

export interface SeasonInfo {
  seasonNumber: number;
  episodeCount: number;
}

/**
 * Calculate the next episode for a TV show, handling season transitions.
 *
 * @param tvId - TMDB TV show ID
 * @param currentSeason - Current season number
 * @param currentEpisode - Current episode number
 * @returns Object with nextSeason and nextEpisode
 */
export async function getNextEpisode(
  tvId: string | number,
  currentSeason: number,
  currentEpisode: number,
): Promise<{ nextSeason: number; nextEpisode: number }> {
  try {
    // Get all seasons to find episode counts
    const tvData = await tmdbApi.getTVSeasonsOnly(tvId);
    const seasons = (tvData.seasons as any[]) ?? [];

    // Filter valid seasons (season_number > 0 and has episodes)
    const validSeasons = seasons
      .filter((s: any) => s.season_number > 0 && s.episode_count > 0)
      .map((s: any) => ({
        seasonNumber: s.season_number,
        episodeCount: s.episode_count,
      }))
      .sort((a, b) => a.seasonNumber - b.seasonNumber);

    // Find current season info
    const currentSeasonInfo = validSeasons.find(s => s.seasonNumber === currentSeason);

    if (!currentSeasonInfo) {
      // Current season not found, assume standard episode count
      return { nextSeason: currentSeason, nextEpisode: currentEpisode + 1 };
    }

    // If not the last episode of current season
    if (currentEpisode < currentSeasonInfo.episodeCount) {
      return { nextSeason: currentSeason, nextEpisode: currentEpisode + 1 };
    }

    // Last episode of current season - find next season
    const nextSeasonInfo = validSeasons.find(s => s.seasonNumber === currentSeason + 1);

    if (nextSeasonInfo) {
      return { nextSeason: currentSeason + 1, nextEpisode: 1 };
    }

    // No next season available - stay at current (user can handle)
    return { nextSeason: currentSeason, nextEpisode: currentEpisode + 1 };
  } catch (error) {
    console.warn('[getNextEpisode] Failed to fetch season data:', error);
    // Fallback: just increment episode
    return { nextSeason: currentSeason, nextEpisode: currentEpisode + 1 };
  }
}

/**
 * Get all valid seasons with episode counts for a TV show
 */
export async function getAllSeasons(tvId: string | number): Promise<SeasonInfo[]> {
  try {
    const tvData = await tmdbApi.getTVSeasonsOnly(tvId);
    const seasons = (tvData.seasons as any[]) ?? [];

    return seasons
      .filter((s: any) => s.season_number > 0 && s.episode_count > 0)
      .map((s: any) => ({
        seasonNumber: s.season_number,
        episodeCount: s.episode_count,
      }))
      .sort((a, b) => a.seasonNumber - b.seasonNumber);
  } catch (error) {
    console.warn('[getAllSeasons] Failed to fetch season data:', error);
    return [];
  }
}

/**
 * Check if an episode is the last episode of its season
 */
export async function isLastEpisodeOfSeason(
  tvId: string | number,
  season: number,
  episode: number,
): Promise<boolean> {
  try {
    const tvData = await tmdbApi.getTVSeasonsOnly(tvId);
    const seasons = (tvData.seasons as any[]) ?? [];
    const seasonInfo = seasons.find((s: any) => s.season_number === season);

    if (!seasonInfo || !seasonInfo.episode_count) return false;
    return episode >= seasonInfo.episode_count;
  } catch {
    return false;
  }
}