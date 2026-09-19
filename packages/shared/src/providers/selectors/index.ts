/**
 * Stream selector registry — maps ProviderDefinition.selection ids to
 * selector implementations. Data-only registries (adapters, selectors) keep
 * behavior out of the provider config.
 *
 * Adding a direct provider with custom selection: one selector file here +
 * a registration below + `selection: "<id>"` on the provider entry.
 */
import { selectBestStream } from "../streamSelector";
import type { StreamLink } from "../sources/types";
import type { SelectOptions, StreamSelection } from "../streamSelector";
import type { DirectStreamSelector } from "./types";
import { spacedomSelector } from "./spacedom";
import { way2moviesSelector } from "./way2movies";

/** The generic quality/size/language ranker — used when no selector is set. */
export const defaultSelector: DirectStreamSelector = {
  id: "default",
  select: (
    links: StreamLink[],
    options: SelectOptions,
  ): Promise<StreamSelection> => selectBestStream(links, options),
};

const selectors = new Map<string, DirectStreamSelector>();
selectors.set("default", defaultSelector);
selectors.set("spacedom", spacedomSelector);
selectors.set("way2movies", way2moviesSelector);

/**
 * Get a stream selector by id. Unknown or missing ids fall back to the
 * generic ranker — providers never have to opt into "default" explicitly.
 */
export function getStreamSelector(id?: string): DirectStreamSelector {
  return (id && selectors.get(id)) || defaultSelector;
}

/** Register a custom selector (tests / runtime extension). */
export function registerStreamSelector(selector: DirectStreamSelector): void {
  selectors.set(selector.id, selector);
}

export { spacedomSelector, way2moviesSelector };
export type { DirectStreamSelector };
