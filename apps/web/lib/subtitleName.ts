/**
 * subtitleName — human-friendly subtitle naming (mobile SubtitleSheet parity).
 *
 * Online providers return SCENE release names — dots instead of spaces with
 * codec/quality/group junk ("Resident.Evil.2026.1080p.AMZN.WEB-DL.Hindi.5.1-
 * English.5.1.ESub.x264-HDHub4u.Ms"), and mpv's embedded track titles carry
 * the same junk ("HDHub4u.Ms"). Both read terribly in the subtitle sheet.
 * This reduces them to what a person scans for: title, year, quality/source,
 * languages. Heuristic by design — unknown tokens stay in the title, so a
 * misspelled tag degrades to a slightly longer name instead of losing text.
 */

/** Display languages — the only tokens that SURVIVE as meaningful meta. */
const LANGS = new Set([
  "hindi",
  "english",
  "tamil",
  "telugu",
  "malayalam",
  "kannada",
  "bengali",
  "bangla",
  "marathi",
  "punjabi",
  "gujarati",
  "urdu",
  "nepali",
  "sinhala",
  "multi",
  "arabic",
  "mandarin",
  "chinese",
  "cantonese",
  "japanese",
  "korean",
  "spanish",
  "espanol",
  "french",
  "german",
  "italian",
  "russian",
  "portuguese",
  "turkish",
  "thai",
  "vietnamese",
  "indonesian",
  "tagalog",
  "persian",
  "farsi",
  "hebrew",
  "ukrainian",
  "polish",
  "dutch",
  "swedish",
  "norwegian",
  "danish",
  "finnish",
  "greek",
  "czech",
  "hungarian",
  "romanian",
]);

/** Source/service tokens — kept, uppercased, grouped with the resolution. */
const SOURCES = new Set([
  "web-dl",
  "webdl",
  "web",
  "webrip",
  "bluray",
  "blu-ray",
  "bdrip",
  "bdremux",
  "brrip",
  "remux",
  "hdrip",
  "dvdrip",
  "dvdscr",
  "dvd",
  "hdtc",
  "hdcam",
  "telesync",
  "hdtv",
  "cam",
  "hd",
  "uhd",
  "amzn",
  "nf",
  "dsnp",
  "pcok",
  "atvp",
  "hmax",
  "stv",
  "it",
  "bcu",
  "pdtv",
  "imax",
]);

const RES_RE = /^(2160p|1080p|720p|540p|480p|360p|4k)$/i;
const YEAR_RE = /^(19\d{2}|20\d{2})$/;

/** Codec/audio/site/group markers — pure noise in a subtitle list. */
const JUNK = new Set([
  "x264",
  "x265",
  "h264",
  "h265",
  "hevc",
  "avc",
  "av1",
  "xvid",
  "divx",
  "aac",
  "aac2",
  "aac5",
  "ac3",
  "eac3",
  "dd",
  "ddp",
  "ddp5",
  "dd5",
  "dd51",
  "dts",
  "truehd",
  "atmos",
  "dolby",
  "hdr",
  "hdr10",
  "dv",
  "10bit",
  "8bit",
  "6ch",
  "2ch",
  "640kbps",
  "320kbps",
  "kbps",
  "esubs",
  "esub",
  "subs",
  "sub",
  "hc",
  "hcsub",
  "msubs",
  "sdh",
  "hq",
  "proper",
  "repack",
  "extended",
  "unrated",
  "remastered",
  "hdhub",
  "hdhub4u",
  "fsl",
  "fslv2",
  "psa",
  "yts",
  "rarbg",
  "telly",
  "vxt",
  "central",
  "1xbet",
  "hdf",
  "ms",
  "org",
  "line",
  "lines",
  "mkv",
  "mkvhub",
  "cine",
  "v2",
  "v3",
  "v4",
  "1xbet",
  "aa",
  "hua",
  "nfhm",
  "tata",
  "ds4k",
  "hdts",
]);

const isDigitish = (t: string) =>
  /^\d+(?:[.\-]\d+)*(?:ch|kbps|bits?)?$/i.test(t);

/**
 * Release-group / scraper track titles ("HDHub4u.Ms", "FSLv2", "AMZN") — pure
 * noise as the secondary line of a track menu row. True only when EVERY word
 * of the title is a known tag (or filler); anything else is a real title
 * ("English Forced", "Director's Commentary") and survives.
 */
export function isTrackTitleJunk(title: string): boolean {
  const words = title
    .toLowerCase()
    .split(/[.\-_\s]+/)
    .filter(Boolean);
  if (words.length === 0) return true;
  return words.every(
    (w) =>
      JUNK.has(w) ||
      SOURCES.has(w) ||
      LANGS.has(w) ||
      isDigitish(w) ||
      w.length <= 2,
  );
}

const capitalize = (w: string) => w.replace(/^./, (c) => c.toUpperCase());

/** ISO 639-2/3 → 2-letter display code ("EN", "AR", "HI"). */
const LANG_CODES: Record<string, string> = {
  eng: "EN",
  en: "EN",
  hin: "HI",
  hi: "HI",
  ara: "AR",
  ar: "AR",
  tam: "TA",
  ta: "TA",
  tel: "TE",
  te: "TE",
  mal: "ML",
  ml: "ML",
  kan: "KN",
  kn: "KN",
  ben: "BN",
  bn: "BN",
  mar: "MR",
  mr: "MR",
  pan: "PA",
  pa: "PA",
  guj: "GU",
  gu: "GU",
  urd: "UR",
  ur: "UR",
  nep: "NE",
  sin: "SI",
  jpn: "JA",
  ja: "JA",
  kor: "KO",
  ko: "KO",
  zho: "ZH",
  chi: "ZH",
  zh: "ZH",
  cmn: "ZH",
  yue: "ZH",
  fra: "FR",
  fre: "FR",
  fr: "FR",
  deu: "DE",
  ger: "DE",
  de: "DE",
  spa: "ES",
  es: "ES",
  rus: "RU",
  ru: "RU",
  por: "PT",
  pt: "PT",
  ita: "IT",
  it: "IT",
  tur: "TR",
  tr: "TR",
  tha: "TH",
  th: "TH",
  vie: "VI",
  vi: "VI",
  ind: "ID",
  id: "ID",
  tgl: "TL",
  pol: "PL",
  pl: "PL",
  ukr: "UK",
  uk: "UK",
  fas: "FA",
  per: "FA",
  fa: "FA",
  heb: "HE",
  swe: "SV",
  nor: "NO",
  dan: "DA",
  fin: "FI",
  ell: "EL",
  gre: "EL",
  ces: "CS",
  hun: "HU",
  ron: "RO",
  rum: "RO",
  nds: "DE",
};

/**
 * Short language code for the track-menu heading ("EN", "AR", "HI") — the
 * most scannable identifier for a subtitle row. Accepts ISO codes ("eng",
 * "en") or full names ("English"); returns null when unknown.
 */
export function langCode(lang?: string | null): string | null {
  if (!lang) return null;
  const t = lang.trim().toLowerCase();
  if (!t) return null;
  if (LANG_CODES[t]) return LANG_CODES[t];
  // Full-name fallback ("English" → EN, "Farsi/Persian" → FA).
  const first = t.split(/[\s/]/)[0];
  if (LANG_CODES[first]) return LANG_CODES[first];
  return /^[a-z]{2}$/.test(t) ? t.toUpperCase() : null;
}

/**
 * English-first sort for subtitle lists (mobile parity): device-locale →
 * English → the rest, stable within groups. Returns a new array.
 */
export function englishFirst<T>(
  list: T[],
  langOf: (item: T) => string | null | undefined,
): T[] {
  let device = "en";
  try {
    device = Intl.DateTimeFormat()
      .resolvedOptions()
      .locale.slice(0, 2)
      .toLowerCase();
  } catch {}
  const rank = (item: T): number => {
    const l = (langOf(item) ?? "").toLowerCase();
    if (!l) return 3;
    const code = langCode(l) ?? l.slice(0, 2);
    if (code === device) return 0;
    if (code === "en" || l.startsWith("english")) return 1;
    return 2;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/** Classify one dash-compound token by scanning its sub-parts. */
function classify(token: string): {
  kind: "year" | "res" | "source" | "lang" | "junk" | "unknown";
  value?: string;
} {
  const t = token.toLowerCase();
  if (YEAR_RE.test(t)) return { kind: "year", value: token };
  if (RES_RE.test(t)) return { kind: "res", value: t };
  if (SOURCES.has(t)) return { kind: "source", value: token.toUpperCase() };
  if (LANGS.has(t)) return { kind: "lang", value: capitalize(t) };
  if (JUNK.has(t) || isDigitish(t)) return { kind: "junk" };
  // Compound ("x264-HDHub4u.Ms", "5.1-English"): recognized if ANY sub-part
  // is. Meaningful parts win over junk — scan languages/res/sources/years
  // first, and only mark the token junk when NOTHING meaningful is inside
  // (otherwise "5.1-English" would be dismissed at the digit and lose the
  // language).
  const parts = token.split(/[.\-]/).filter(Boolean);
  if (parts.length > 1) {
    for (const p of parts) {
      const pt = p.toLowerCase();
      if (YEAR_RE.test(pt)) return { kind: "year", value: p };
      if (LANGS.has(pt)) return { kind: "lang", value: capitalize(pt) };
      if (SOURCES.has(pt)) return { kind: "source", value: p.toUpperCase() };
      if (RES_RE.test(pt)) return { kind: "res", value: pt };
    }
    for (const p of parts) {
      const pt = p.toLowerCase();
      if (JUNK.has(pt) || isDigitish(pt)) return { kind: "junk" };
    }
  }
  return { kind: "unknown" };
}

/**
 * Scene release name → "Title (Year) · 1080p WEB-DL · Hindi, English".
 * Falls back to the separator-cleaned input when nothing is recognized.
 */
export function prettyReleaseName(raw: string): string {
  const input = String(raw ?? "").trim();
  if (!input) return "Subtitle";

  const cleaned = input
    .replace(/\.(mkv|mp4|avi|webm|m4v|ts|srt|ass|ssa|vtt|sub)$/i, "")
    .replace(/[._]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!cleaned) return "Subtitle";

  const tokens = cleaned.split(" ").filter(Boolean);
  const title: string[] = [];
  let year: string | null = null;
  const tech: string[] = [];
  const langs: string[] = [];
  let titleEnded = false;

  for (const token of tokens) {
    const c = classify(token);
    if (c.kind === "unknown") {
      // Unknown leading words extend the title; unknown trailing words are
      // almost always release-group remnants — dropped.
      if (!titleEnded) title.push(token);
      continue;
    }
    titleEnded = true;
    if (c.kind === "year" && !year) year = c.value ?? null;
    else if (c.kind === "res" && !tech.includes(c.value!)) tech.push(c.value!);
    else if (c.kind === "source" && !tech.includes(c.value!))
      tech.push(c.value!);
    else if (
      c.kind === "lang" &&
      !langs.some((l) => l.toLowerCase() === c.value!.toLowerCase())
    )
      langs.push(c.value!);
  }

  const head = title.join(" ").trim() || cleaned;
  const meta: string[] = [];
  if (tech.length > 0) meta.push(tech.join(" "));
  if (langs.length > 0) meta.push(langs.join(", "));

  const out = `${head}${year ? ` (${year})` : ""}${meta.length ? ` · ${meta.join(" · ")}` : ""}`;
  return out.length > 90 ? `${out.slice(0, 87).trimEnd()}…` : out;
}
