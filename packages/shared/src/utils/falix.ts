/**
 * Falix download-page utilities shared by web + mobile.
 *
 * Extracted from apps/web/app/download/falix/FalixPage.tsx and
 * apps/mobile/app/download/falix/[...id].tsx, where this helper block
 * was duplicated (~350 lines) with the language markers byte-for-byte.
 */

export const FALIX_API_BASE = "https://dl.falixmovies.com";

/** Build a Falix download URL: `<base>/dl/<fileId>/<encodedName>`. */
export function buildFalixDownloadUrl(
  apiBase: string,
  fileId: string,
  fileName: string,
): string {
  return `${apiBase.replace(/\/+$/, "")}/dl/${fileId}/${encodeURIComponent(fileName)}`;
}

// ── Quality helpers ────────────────────────────────────────────────

const QUALITY_ORDER: Record<string, number> = {
  "4k": 1,
  "2160p": 1,
  "1080p": 2,
  "720p": 3,
  "480p": 4,
  "360p": 5,
};

export function sortByQuality<T extends { quality: string }>(
  a: T,
  b: T,
): number {
  const aq = QUALITY_ORDER[a.quality.toLowerCase()] ?? 99;
  const bq = QUALITY_ORDER[b.quality.toLowerCase()] ?? 99;
  return aq - bq;
}

/** "1.2 GB" → bytes (0 when unparseable). */
export function parseSizeToBytes(sizeStr: string | undefined): number {
  if (!sizeStr) return 0;
  const match = sizeStr.match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  return value * (multipliers[unit] || 0);
}

// ── Language markers ──
// Falix telegram filenames embed audio-language tags ("Multi", "Hindi",
// "English", …). Users pick files BY language, so we surface them as chips
// instead of leaving them buried in a truncated release name. The list is
// deliberately exhaustive — every tag found in a name is shown, uncapped.
// Compound audio tags (DualAudio/MultiAudio) are matched as whole words so
// they don't also emit their "Dual"/"Multi" prefix chips.
const LANGUAGE_TAGS = [
  // Aggregators & audio-layout tags (priority order)
  "Multi",
  "MultiAudio",
  "Dual",
  "DualAudio",
  "Dubbed",
  // Indian subcontinent
  "Hindi",
  "English",
  "Urdu",
  "Punjabi",
  "Panjabi",
  "Marathi",
  "Gujarati",
  "Bengali",
  "Odia",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Tulu",
  "Bhojpuri",
  "Rajasthani",
  "Haryanvi",
  "Assamese",
  "Nepali",
  "Sinhala",
  // East & Southeast Asia
  "Japanese",
  "Korean",
  "Mandarin",
  "Cantonese",
  "Chinese",
  "Thai",
  "Vietnamese",
  "Indonesian",
  "Malay",
  "Filipino",
  "Tagalog",
  "Burmese",
  "Khmer",
  "Lao",
  // Middle East & Central Asia
  "Arabic",
  "Persian",
  "Farsi",
  "Turkish",
  "Kurdish",
  "Hebrew",
  "Georgian",
  "Armenian",
  "Azerbaijani",
  "Kazakh",
  "Uzbek",
  // Europe
  "Spanish",
  "French",
  "German",
  "Italian",
  "Dutch",
  "Portuguese",
  "Russian",
  "Ukrainian",
  "Belarusian",
  "Polish",
  "Czech",
  "Slovak",
  "Hungarian",
  "Romanian",
  "Bulgarian",
  "Serbian",
  "Croatian",
  "Bosnian",
  "Slovenian",
  "Albanian",
  "Macedonian",
  "Greek",
  "Lithuanian",
  "Latvian",
  "Estonian",
  "Danish",
  "Swedish",
  "Norwegian",
  "Finnish",
  "Icelandic",
  "Irish",
  "Welsh",
  "Catalan",
  "Basque",
  "Galician",
  // Africa & others
  "Swahili",
  "Afrikaans",
  "Zulu",
  "Amharic",
  "Hausa",
  "Yoruba",
  "Somali",
  "Mongolian",
] as const;

/** Word-boundary scan of a release name for known language tags.
 * Leading separator: start / . / space / _ / - ; trailing additionally
 * allows digits so channel notations like "Hindi2.0" still match. */
export function extractLanguages(name: string): string[] {
  const lower = name.toLowerCase();
  const found: string[] = [];
  for (const lang of LANGUAGE_TAGS) {
    if (
      new RegExp(`(?:^|[.\\s_-])${lang.toLowerCase()}(?:$|[.\\s_\\-\\d])`).test(
        lower,
      )
    ) {
      found.push(lang);
    }
  }
  return found;
}

export const TIER_LABELS = {
  low: "Lowest",
  mid: "Medium",
  high: "Highest",
} as const;

export const TIER_DESCRIPTIONS = {
  low: "Smallest file size",
  mid: "Balanced quality & size",
  high: "Best available quality",
} as const;

export type QualityTier = keyof typeof TIER_LABELS;

/**
 * Pick a file by tier from a quality-sorted list.
 * high → first (best), low → last (smallest), mid → middle.
 */
export function getFileByTier<T>(
  sortedFiles: T[],
  tier: QualityTier,
): T | null {
  if (sortedFiles.length === 0) return null;
  if (tier === "low") return sortedFiles[sortedFiles.length - 1];
  if (tier === "high") return sortedFiles[0];
  return sortedFiles[Math.floor(sortedFiles.length / 2)];
}
