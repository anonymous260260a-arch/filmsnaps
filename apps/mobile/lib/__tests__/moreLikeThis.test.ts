/**
 * aggregateRecommendations — More-Like-This quality tests.
 *
 * Pins the "more like this gives bad results" fixes:
 *  - TMDB /recommendations output is the source (not genre discover),
 *  - seeds are excluded from results,
 *  - quality gate drops 0-vote / low-rated junk,
 *  - agreement across seeds compounds ranking,
 *  - recency weighting favors the most recent watch.
 */
import { describe, expect, it } from "vitest";
import { aggregateRecommendations } from "../../hooks/useTMDB";

const item = (over: Partial<any> = {}): any => ({
  id: 1,
  title: "Some Movie",
  vote_average: 7.2,
  vote_count: 400,
  popularity: 50,
  poster_path: "/x.jpg",
  ...over,
});

describe("aggregateRecommendations", () => {
  it("excludes every seed id from the results", () => {
    const out = aggregateRecommendations([
      {
        seedId: 11,
        seedIndex: 0,
        results: [item({ id: 11 }), item({ id: 12 })],
      },
      {
        seedId: 22,
        seedIndex: 1,
        results: [item({ id: 22 }), item({ id: 12 })],
      },
    ]);
    expect(out.map((o: any) => o.id)).toEqual([12]);
  });

  it("drops low-rated and low-vote junk", () => {
    const out = aggregateRecommendations([
      {
        seedId: 11,
        seedIndex: 0,
        results: [
          item({ id: 1, vote_average: 4.2, vote_count: 900 }), // rating gate
          item({ id: 2, vote_average: 8.5, vote_count: 3 }), // votes gate
          item({ id: 3, vote_average: 7.0, vote_count: 100 }), // passes
        ],
      },
    ]);
    expect(out.map((o: any) => o.id)).toEqual([3]);
  });

  it("compounds agreement: a title two seeds recommend beats a single-seed title", () => {
    const shared = item({
      id: 50,
      vote_average: 7.0,
      vote_count: 200,
      popularity: 5,
    });
    const solo = item({
      id: 60,
      vote_average: 7.0,
      vote_count: 200,
      popularity: 500,
    });
    const out = aggregateRecommendations([
      { seedId: 1, seedIndex: 0, results: [shared, solo] },
      { seedId: 2, seedIndex: 1, results: [shared] },
    ]);
    expect(out[0].id).toBe(50);
    expect(out[0]._mltScore).toBeGreaterThan(0);
  });

  it("recency-weighted: most recent seed's recommendations rank higher", () => {
    const fromNew = item({ id: 1, popularity: 10 });
    const fromOld = item({ id: 2, popularity: 10 });
    const out = aggregateRecommendations([
      { seedId: 11, seedIndex: 0, results: [fromNew] },
      { seedId: 22, seedIndex: 2, results: [fromOld] },
    ]);
    // Same quality/popularity — the newer seed's pick must come first.
    expect(out[0].id).toBe(1);
  });

  it("tags _mediaType for tv-shaped items without one", () => {
    const out = aggregateRecommendations([
      {
        seedId: 1,
        seedIndex: 0,
        results: [item({ id: 9, first_air_date: "2024-01-01" })],
      },
    ]);
    expect(out[0]._mediaType).toBe("tv");
  });

  it("caps the pool at 20", () => {
    const out = aggregateRecommendations([
      {
        seedId: 1,
        seedIndex: 0,
        results: Array.from({ length: 40 }, (_, i) =>
          item({ id: 100 + i, popularity: i }),
        ),
      },
    ]);
    expect(out).toHaveLength(20);
  });
});
