/**
 * Last-used direct provider, per title.
 *
 * Continue-watching should put the user back where they were: if they watched
 * a title on SpaceDom last time, opening it again (from CW or details)
 * prefetches and opens SpaceDom — not the app default. Storage is a tiny
 * AsyncStorage map keyed `movie:12345` → providerId.
 *
 * Reads validate against the registry: a provider that was disabled or
 * removed since the save is ignored (falls back to the default flow).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getProvider,
  getEnabledProviders,
  isDirectProvider,
  type ProviderPlatform,
} from "@filmsnaps/shared";

const KEY = "lastDirectProviderByTitle";

type Store = Record<string, string>;

let cache: Store | null = null;

async function load(): Promise<Store> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    cache = {};
  }
  return cache;
}

async function persist(store: Store): Promise<void> {
  cache = store;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(store));
  } catch {}
}

/** The provider last used for this title, or null. Only still-enabled direct providers come back. */
export async function getLastProvider(
  mediaType: "movie" | "tv",
  tmdbId: number | string,
  platform: ProviderPlatform = "mobile",
): Promise<string | null> {
  const store = await load();
  const id = store[`${mediaType}:${tmdbId}`];
  if (!id) return null;
  const def = getProvider(id);
  if (!def || !isDirectProvider(def) || !getEnabledProviders().includes(def))
    return null;
  return (def.platforms ?? []).includes(platform) ? id : null;
}

/** Remember which direct provider served this title. */
export async function saveLastProvider(
  mediaType: "movie" | "tv",
  tmdbId: number | string,
  providerId: string,
): Promise<void> {
  const store = await load();
  store[`${mediaType}:${tmdbId}`] = providerId;
  await persist(store);
}
