/**
 * Audio track display helpers — humanize language codes for the audio
 * switcher chrome + AudioTrackSheet. Codes cover ISO 639-1 / 639-2 and
 * the strings actually seen in expo-video track metadata for this catalog.
 */

const LANGUAGE_NAMES: Record<string, string> = {
  hi: "Hindi",
  hin: "Hindi",
  hindi: "Hindi",
  en: "English",
  eng: "English",
  english: "English",
  ta: "Tamil",
  tam: "Tamil",
  tamil: "Tamil",
  te: "Telugu",
  tel: "Telugu",
  telugu: "Telugu",
  ml: "Malayalam",
  mal: "Malayalam",
  malayalam: "Malayalam",
  kn: "Kannada",
  kan: "Kannada",
  kannada: "Kannada",
  bn: "Bengali",
  ben: "Bengali",
  bengali: "Bengali",
  mr: "Marathi",
  mar: "Marathi",
  marathi: "Marathi",
  pa: "Punjabi",
  pan: "Punjabi",
  punjabi: "Punjabi",
  ur: "Urdu",
  urd: "Urdu",
  urdu: "Urdu",
  gu: "Gujarati",
  guj: "Gujarati",
  gujarati: "Gujarati",
  or: "Odia",
  ori: "Odia",
  odia: "Odia",
  as: "Assamese",
  asm: "Assamese",
  assamese: "Assamese",
  multi: "Multi",
  dual: "Multi",
  "multi-audio": "Multi",
  fr: "French",
  fre: "French",
  french: "French",
  es: "Spanish",
  spa: "Spanish",
  spanish: "Spanish",
  de: "German",
  ger: "German",
  german: "German",
  it: "Italian",
  ita: "Italian",
  italian: "Italian",
  pt: "Portuguese",
  por: "Portuguese",
  portuguese: "Portuguese",
  ru: "Russian",
  rus: "Russian",
  russian: "Russian",
  ja: "Japanese",
  jpn: "Japanese",
  japanese: "Japanese",
  ko: "Korean",
  kor: "Korean",
  korean: "Korean",
  zh: "Chinese",
  chi: "Chinese",
  cmn: "Chinese",
  chinese: "Chinese",
  ar: "Arabic",
  ara: "Arabic",
  arabic: "Arabic",
  tr: "Turkish",
  tur: "Turkish",
  turkish: "Turkish",
  id: "Indonesian",
  ind: "Indonesian",
  indonesian: "Indonesian",
  th: "Thai",
  tha: "Thai",
  thai: "Thai",
  vi: "Vietnamese",
  vie: "Vietnamese",
  vietnamese: "Vietnamese",
  /** Unmapped codes observed / possible — left unmapped so fallback runs:
   *  und (undetermined), zxx (no linguistic content), mis (uncoded). */
};

/** Map a raw language code / free-text label to a display name, or null. */
export function humanizeAudioLanguage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/_/g, "-");
  if (!key) return null;
  const direct = LANGUAGE_NAMES[key];
  if (direct) return direct;
  const base = key.split("-")[0];
  return LANGUAGE_NAMES[base] ?? null;
}

/** Short chip for chrome: HI / EN / MULTI / TA… */
export function audioChipLabel(displayName: string): string {
  const d = displayName.trim().toLowerCase();
  if (d.startsWith("multi") || d === "dual") return "MULTI";
  if (d.startsWith("hindi")) return "HI";
  if (d.startsWith("english")) return "EN";
  if (d.startsWith("tamil")) return "TA";
  if (d.startsWith("telugu")) return "TE";
  if (d.startsWith("malayalam")) return "ML";
  if (d.startsWith("kannada")) return "KN";
  if (d.startsWith("bengali")) return "BN";
  if (d.startsWith("marathi")) return "MR";
  if (d.startsWith("punjabi")) return "PA";
  if (d.startsWith("urdu")) return "UR";
  // Fall back to first 2–3 letters of the display name.
  const compact = d.replace(/[^a-z]/g, "");
  return compact.slice(0, 3).toUpperCase() || "AUD";
}

/**
 * Human title for an audio track row / chrome chip.
 * Fallback for a truly unnamed track: "Track N" — never "Audio".
 */
export function audioTrackTitle(
  track: { language?: string; label?: string },
  index: number,
): string {
  const mapped = humanizeAudioLanguage(track.language);
  if (mapped) return mapped;
  const labelMapped = humanizeAudioLanguage(track.label);
  if (labelMapped) return labelMapped;
  const label = (track.label ?? "").trim();
  // Already a human sentence/word that isn't a bare code — use it.
  if (label && !/^[a-z]{2,3}([-_][a-z0-9]+)?$/i.test(label) && label.toLowerCase() !== "audio" && label.toLowerCase() !== "audio track") {
    return label;
  }
  return `Track ${index + 1}`;
}
