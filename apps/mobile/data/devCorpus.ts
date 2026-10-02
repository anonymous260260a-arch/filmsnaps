/**
 * Dev corpus for the Accent Lab (dev-only tuning harness).
 *
 * ~50 titles chosen to stress every corner of the accent pipeline: gates
 * (mud/grey/skin), tiers (strict/relaxed), sources (poster vs backdrop hue
 * gaps), and the fallback path. Shape is deliberately tiny — labels/tags are
 * for humans; ids are resolved through TMDB by the lab screen itself.
 */
export interface CorpusEntry {
  id: number;
  type: "movie" | "tv";
  label: string;
  tags: string[];
}

export const DEV_CORPUS: CorpusEntry[] = [
  {
    id: 693134,
    type: "movie",
    label: "Dune: Part Two",
    tags: ["desert", "sepia"],
  },
  {
    id: 447365,
    type: "movie",
    label: "Guardians Vol. 3",
    tags: ["neon", "action"],
  },
  { id: 786892, type: "movie", label: "Furiosa", tags: ["desert", "sepia"] },
  { id: 346698, type: "movie", label: "Barbie", tags: ["pastel", "high-key"] },
  {
    id: 502356,
    type: "movie",
    label: "The Super Mario Bros",
    tags: ["animated", "high-key"],
  },
  { id: 872906, type: "movie", label: "Oppenheimer", tags: ["sepia", "drama"] },
  {
    id: 569094,
    type: "movie",
    label: "Spider-Man: Across the Spider-Verse",
    tags: ["animated", "neon"],
  },
  {
    id: 634649,
    type: "movie",
    label: "Spi-Man: No Way Home",
    tags: ["action"],
  },
  { id: 24428, type: "movie", label: "The Avengers", tags: ["action"] },
  { id: 299534, type: "movie", label: "Avengers: Endgame", tags: ["action"] },
  { id: 603, type: "movie", label: "The Matrix", tags: ["neon", "sci-fi"] },
  {
    id: 769,
    type: "movie",
    label: "GoodFellas",
    tags: ["drama", "skin-heavy"],
  },
  {
    id: 278,
    type: "movie",
    label: "The Shawshank Redemption",
    tags: ["drama"],
  },
  {
    id: 155,
    type: "movie",
    label: "The Dark Knight",
    tags: ["noir", "action"],
  },
  { id: 11, type: "movie", label: "Star Wars", tags: ["sci-fi", "desert"] },
  { id: 1726, type: "movie", label: "Iron Man", tags: ["neon", "action"] },
  { id: 674, type: "movie", label: "Harry Potter", tags: ["fantasy"] },
  { id: 129, type: "movie", label: "Spirited Away", tags: ["anime", "pastel"] },
  {
    id: 496243,
    type: "movie",
    label: "Demon Slayer: Mugen Train",
    tags: ["anime", "neon"],
  },
  { id: 568124, type: "movie", label: "Encanto", tags: ["animated", "pastel"] },
  {
    id: 364792,
    type: "movie",
    label: "The Revenant",
    tags: ["desert", "survival"],
  },
  { id: 122, type: "movie", label: "The Lord of the Rings", tags: ["fantasy"] },
  {
    id: 120,
    type: "movie",
    label: "The Lord of the Rings: Fellowship",
    tags: ["fantasy"],
  },
  { id: 550, type: "movie", label: "Fight Club", tags: ["noir", "drama"] },
  {
    id: 13,
    type: "movie",
    label: "Forrest Gump",
    tags: ["drama", "skin-heavy"],
  },
  { id: 597, type: "movie", label: "Titanic", tags: ["romcom", "period"] },
  {
    id: 105,
    type: "movie",
    label: "Back to the Future",
    tags: ["comedy", "sci-fi"],
  },
  { id: 807, type: "movie", label: "Se7en", tags: ["noir", "horror"] },
  { id: 438631, type: "movie", label: "Nope", tags: ["horror", "skin-heavy"] },
  {
    id: 530385,
    type: "movie",
    label: "Midsommar",
    tags: ["horror", "high-key"],
  },
  {
    id: 545611,
    type: "movie",
    label: "Everything Everywhere",
    tags: ["neon", "comedy"],
  },
  { id: 438695, type: "movie", label: "Sing 2", tags: ["animated", "neon"] },
  { id: 508965, type: "movie", label: "Klaus", tags: ["animated", "high-key"] },
  {
    id: 76600,
    type: "movie",
    label: "Avatar: The Way of Water",
    tags: ["sci-fi", "neon"],
  },
  { id: 19995, type: "movie", label: "Avatar", tags: ["sci-fi", "neon"] },
  {
    id: 872585,
    type: "movie",
    label: "Oppenheimer (B&W shots)",
    tags: ["b&w", "drama"],
  },
  { id: 1124, type: "movie", label: "The Godfather", tags: ["noir", "sepia"] },
  {
    id: 11216,
    type: "movie",
    label: "The Godfather Part II",
    tags: ["noir", "sepia"],
  },
  {
    id: 680,
    type: "movie",
    label: "Pulp Fiction",
    tags: ["noir", "skin-heavy"],
  },
  { id: 111, type: "movie", label: "Scarface", tags: ["drama", "sepia"] },
  { id: 98, type: "movie", label: "Gladiator", tags: ["desert", "sepia"] },
  {
    id: 429,
    type: "movie",
    label: "The Good, the Bad and the Ugly",
    tags: ["western", "desert"],
  },
  { id: 600, type: "movie", label: "Full Metal Jacket", tags: ["drama"] },
  { id: 9013, type: "movie", label: "E.T.", tags: ["family", "skin-heavy"] },
  {
    id: 129,
    type: "movie",
    label: "Spirited Away (dup for cache check)",
    tags: ["cache-check"],
  },
  { id: 1396, type: "tv", label: "Breaking Bad", tags: ["desert", "sepia"] },
  { id: 66732, type: "tv", label: "Stranger Things", tags: ["neon", "horror"] },
  { id: 94605, type: "tv", label: "Arcane", tags: ["anime", "neon"] },
  {
    id: 94997,
    type: "tv",
    label: "House of the Dragon",
    tags: ["fantasy", "sepia"],
  },
  { id: 70523, type: "tv", label: "Hyouka", tags: ["anime", "pastel"] },
];
