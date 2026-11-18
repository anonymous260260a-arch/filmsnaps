/**
 * Abuse-word flagging for /api/feedback. Flags, never blocks — the admin
 * decides. Keep the list short and unambiguous; false positives are worse
 * than a missed insult, since flagged rows are hidden by default.
 * Word-boundary matched (so "grape" never flags on "rape") after un-mapping
 * common leetspeak / separator tricks.
 */
const ABUSE_WORDS = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "dick",
  "cunt",
  "motherfucker",
  "whore",
  "slut",
  "retard",
  "faggot",
  "nigger",
  "nigga",
  "kike",
  "spic",
  "chink",
  "tranny",
  "rape",
  "penis",
  "vagina",
  "porn",
  "nude",
  "sex",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0]/g, "o")
    .replace(/[1!]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[4@]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/[*_.\-]/g, "");
}

const PATTERNS = ABUSE_WORDS.map((w) => new RegExp(`\\b${w}\\b`));

export function containsAbuse(text: string): boolean {
  const n = normalize(text);
  return PATTERNS.some((re) => re.test(n));
}
