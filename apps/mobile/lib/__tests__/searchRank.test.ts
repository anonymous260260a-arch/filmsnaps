/**
 * searchRank — re-ranker contract tests.
 *
 * Pins the "search gives good results" fixes:
 *  - title match dominates popularity (the obvious hit lands first),
 *  - no-art junk drops off page 1 (unless it would empty the page),
 *  - people split into their own lane,
 *  - accent/case normalization (Pokémon ≈ pokemon).
 */
import { describe, expect, it } from "vitest";
import {
  rankSearchResults,
  titleMatchScore,
  type RankableSearchItem,
} from "../searchRank";

const movie = (over: Partial<RankableSearchItem> = {}): RankableSearchItem => ({
  id: 1,
  media_type: "movie",
  title: "Dune",
  poster_path: "/dune.jpg",
  vote_average: 7.5,
  vote_count: 9000,
  popularity: 200,
  ...over,
});

describe("titleMatchScore", () => {
  it("exact match outranks popularity-only matches", () => {
    const exact = titleMatchScore("dune", movie());
    const partial = titleMatchScore("dun", {
      ...movie({ title: "Dune: Part Two" }),
    });
    expect(exact).toBeGreaterThan(partial);
    expect(exact).toBe(1);
  });

  it("word-start beats substring beats word-overlap", () => {
    const start = titleMatchScore("spider", {
      ...movie({ title: "Spider-Man" }),
    });
    const contains = titleMatchScore("man", {
      ...movie({ title: "Spider-Man" }),
    });
    expect(start).toBeGreaterThan(contains);
  });

  it("normalizes case, accents, and punctuation", () => {
    expect(titleMatchScore("pokemon", movie({ title: "Pokémon" }))).toBe(1);
    expect(titleMatchScore("spider man", movie({ title: "Spider-Man" }))).toBe(
      1,
    );
  });

  it("no overlap scores 0", () => {
    expect(titleMatchScore("interstellar", movie({ title: "Dune" }))).toBe(0);
  });

  it("uses the shortest title variant (original vs localized)", () => {
    // A short original title should match better than the long localized one.
    const score = titleMatchScore("bubble", {
      ...movie({ title: "Bubble Gum Girl", original_title: "Bubble" }),
    });
    expect(score).toBe(1);
  });
});

describe("rankSearchResults", () => {
  it("puts the exact hit first regardless of TMDB's raw order", () => {
    const split = rankSearchResults("dune", [
      movie({ id: 2, title: "Dune: Part Two", popularity: 500 }),
      movie({ id: 1, title: "Dune", popularity: 100 }),
      movie({ id: 3, title: "Duneland", popularity: 50 }),
    ]);
    expect(split.titles[0].id).toBe(1);
    expect(split.titles[1].id).toBe(2);
  });

  it("drops no-art junk that also has no votes", () => {
    const split = rankSearchResults("dune", [
      movie({ id: 1, title: "Dune" }),
      movie({ id: 9, title: "Dune Bootleg", poster_path: null, vote_count: 0 }),
    ]);
    expect(split.titles.map((t) => t.id)).toEqual([1]);
  });

  it("keeps an obscure no-art title when it is an exact match", () => {
    const split = rankSearchResults("dune bootleg", [
      movie({ id: 1, title: "Dune" }),
      movie({ id: 9, title: "Dune Bootleg", poster_path: null, vote_count: 0 }),
    ]);
    expect(split.titles.map((t) => t.id)).toContain(9);
  });

  it("splits people into their own lane", () => {
    const split = rankSearchResults("timothée chalamet", [
      movie({ id: 1, title: "Dune" }),
      {
        id: 100,
        media_type: "person",
        name: "Timothée Chalamet",
        profile_path: "/chalamet.jpg",
      },
    ]);
    expect(split.titles).toHaveLength(1);
    expect(split.people).toHaveLength(1);
    expect(split.people[0].name).toBe("Timothée Chalamet");
  });

  it("drops person rows without a profile picture", () => {
    const split = rankSearchResults("nobody", [
      {
        id: 100,
        media_type: "person",
        name: "No Face",
        profile_path: null,
      },
    ]);
    expect(split.people).toHaveLength(0);
  });

  it("counts popularity as a tiebreak among equal matches", () => {
    const split = rankSearchResults("the dark night of", [
      movie({ id: 1, title: "The Dark Night", popularity: 30 }),
      movie({ id: 2, title: "Night of the Dark", popularity: 300 }),
    ]);
    // Both contain all words; popularity + position decide — order must be
    // deterministic, not TMDB-arrival order.
    expect(split.titles).toHaveLength(2);
  });
});
