/**
 * Per-provider overrides.
 *
 * CDN allow patterns are now derived from the single source of truth:
 * `blocklist.json` at the project root (via @filmsnaps/adblock-config).
 *
 * This file only maintains overrides for things NOT in blocklist.json:
 *   - `blockPatterns` — extra ad/tracker domains specific to a provider
 *   - `notes` — human-readable comments
 *   - Virtual/internal providers (e.g., "nitro") not in the public list
 *
 * At build time, loadAllOverrides() merges the static definitions below
 * with CDN domains read from blocklist.json, producing the full set.
 *
 * Allow patterns become:   @@||domain^$document
 * Block patterns become:   ||domain^$third-party
 */

import { loadBlocklistConfig } from '@filmsnaps/adblock-config';
import type { ProviderConfig } from '@filmsnaps/adblock-config';

export interface ProviderOverride {
  providerId: string;
  displayName: string;
  /** Domains that must never be blocked (video CDNs) */
  allowPatterns: string[];
  /** Extra ad/tracker domains specific to this provider */
  blockPatterns: string[];
  note?: string;
}

// ── Static overrides (supplemental — only what blocklist.json lacks) ──
//
// CDN domains (allowPatterns) for these providers are read from
// blocklist.json providers[].cdnDomains at runtime.
// This file only keeps blockPatterns + notes on top.

const STATIC_OVERRIDES: ProviderOverride[] = [
  // ── Server 1: Nxsha ──────────────────────────────────────────
  {
    providerId: 'nxsha',
    displayName: 'Nxsha / Server 1',
    allowPatterns: [],
    blockPatterns: [],
    note: 'NXCloud CDN serves from various subdomains; see blocklist.json',
  },
  // ── Server 2: Peachify ───────────────────────────────────────
  {
    providerId: 'peachify',
    displayName: 'Peachify / Server 2',
    allowPatterns: [],
    blockPatterns: [],
  },
  // ── Server 3: ScreenScape ────────────────────────────────────
  {
    providerId: 'screenscape',
    displayName: 'ScreenScape / Server 3',
    allowPatterns: [],
    blockPatterns: [],
  },
  // ── Server 4: NHD Api ────────────────────────────────────────
  {
    providerId: 'nhdapi',
    displayName: 'NHD Api / Server 4',
    allowPatterns: [],
    blockPatterns: [],
  },
  // ── Server 5: ZxcStream ──────────────────────────────────────
  {
    providerId: 'zxcstream',
    displayName: 'ZxcStream / Server 5',
    allowPatterns: [],
    blockPatterns: [],
  },
  // ── Server 6: CinemaOS ───────────────────────────────────────
  {
    providerId: 'cinemaos',
    displayName: 'CinemaOS / Server 6',
    allowPatterns: [],
    blockPatterns: [],
  },
  // ── Server 14: VidNest ────────────────────────────────────────
  {
    providerId: 'vidnest',
    displayName: 'VidNest / Server 14',
    allowPatterns: [],
    blockPatterns: [],
  },
  // ── Server 18: ChillFlix ─────────────────────────────────────
  {
    providerId: 'chillflix',
    displayName: 'ChillFlix / Server 18',
    allowPatterns: [],
    blockPatterns: [],
    note: 'Multiple TLDs — rotates frequently; see blocklist.json',
  },
  // ── Server 19: TouStream ─────────────────────────────────────
  {
    providerId: 'toustream',
    displayName: 'TouStream / Server 19',
    allowPatterns: [],
    blockPatterns: [],
  },
  // ── StreamGuide ──────────────────────────────────────────────
  {
    providerId: 'streamguide',
    displayName: 'StreamGuide',
    allowPatterns: [],
    blockPatterns: [],
  },
  // ── Server 20: VidKing ────────────────────────────────────────
  {
    providerId: 'vidking',
    displayName: 'VidKing / Server 20',
    allowPatterns: [],
    blockPatterns: [],
  },
  // ── Nitro HLS Proxy CDN ──────────────────────────────────────
  {
    providerId: 'nitro',
    displayName: 'Nitro HLS Proxy',
    // "nitro" is a virtual provider not listed in blocklist.json,
    // so its CDN domains are kept here as static overrides.
    allowPatterns: [
      'proxy.itsnitrox.tech',
      'oo.itsnitrox.tech',
    ],
    blockPatterns: [],
    note: 'HLS video delivery CDN used by streaming providers',
  },
];

// ── Public API ────────────────────────────────────────────────────────

/**
 * Load all provider overrides, merging CDN domains from blocklist.json
 * with the static overrides defined above.
 *
 * blocklist.json providers are matched by `id`. Any provider in
 * blocklist.json that is NOT in STATIC_OVERRIDES gets a generated entry.
 * Any domain listed in blocklist.json `providers[].cdnDomains` is used
 * as the allow pattern for that provider.
 */
export function loadAllOverrides(): ProviderOverride[] {
  const merged = new Map<string, ProviderOverride>();

  // 1. Seed with static overrides
  for (const ov of STATIC_OVERRIDES) {
    merged.set(ov.providerId, { ...ov, allowPatterns: [...ov.allowPatterns] });
  }

  // 2. Merge CDN domains from blocklist.json
  try {
    const blConfig = loadBlocklistConfig();

    if (blConfig?.providers) {
      for (const provider of blConfig.providers) {
        if (!provider.enabled) continue;

        const cdnDomains = provider.cdnDomains ?? [];
        const embedDomains = provider.embedDomains ?? [];

        // Combine embed + CDN domains as allow patterns (both are safe)
        const domainsFromConfig = [...new Set([...embedDomains, ...cdnDomains])];

        if (merged.has(provider.id)) {
          // Merge into existing override — append config domains
          const existing = merged.get(provider.id)!;
          const allPatterns = new Set([
            ...existing.allowPatterns,
            ...domainsFromConfig,
          ]);
          existing.allowPatterns = [...allPatterns];
        } else {
          // Provider from config not in static overrides — create entry
          merged.set(provider.id, {
            providerId: provider.id,
            displayName: `${provider.id} (from blocklist.json)`,
            allowPatterns: domainsFromConfig,
            blockPatterns: [],
          });
        }
      }
    }
  } catch (e) {
    console.warn('[overrides] Failed to load blocklist.json — using static overrides only:', (e as Error).message);
  }

  return [...merged.values()];
}

/**
 * Get overrides for a specific provider by ID.
 */
export function getOverrideFor(providerId: string): ProviderOverride | undefined {
  return loadAllOverrides().find((o) => o.providerId === providerId);
}

/**
 * Convert overrides to EasyList-compatible filter syntax.
 *
 * Allow patterns become:   @@||domain^$document
 * Block patterns become:   ||domain^$third-party
 */
export function overridesToFilterRules(overrides: ProviderOverride[]): string {
  const lines: string[] = [
    '! ===== Filmsnaps Provider Overrides =====',
    '! Generated automatically from per-provider override files',
    '',
  ];

  for (const ov of overrides) {
    lines.push(`! ${ov.displayName} (${ov.providerId})`);

    // Allow rules (exceptions) — document level + subresources
    for (const pattern of ov.allowPatterns) {
      lines.push(`@@||${pattern}^$document`);
      lines.push(`@@||${pattern}^$xmlhttprequest`);
      lines.push(`@@||${pattern}^$media`);
    }

    // Block rules
    for (const pattern of ov.blockPatterns) {
      lines.push(`||${pattern}^$third-party`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Convert our current AD_PATTERNS list to filter rules as a fallback.
 * These catch ad domains not yet in EasyList.
 */
export function legacyAdPatternsToFilterRules(): string {
  const patterns = [
    'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
    'google-analytics.com', 'googletagmanager.com', 'pagead2.googlesyndication.com',
    'adnxs.com', 'rubiconproject.com', 'criteo.com', 'criteo.net',
    'outbrain.com', 'taboola.com', 'revcontent.com',
    'popads.net', 'popcash.net', 'adsterra.com',
    'propellerads.com', 'trafficfactory.biz',
    'histats.com', 'statcounter.com', 'scorecardresearch.com',
    'amazon-adsystem.com', 'casalemedia.com', 'contextweb.com',
    'openx.net', 'pubmatic.com', 'sharethrough.com',
    'media.net', 'advertising.com', 'adap.tv',
    'moatads.com', 'exdynsrv.com',
    'exoclick.com', 'juicyads.com', 'plugrush.com',
    'trafficjunky.com', 'adreactor.com', 'adcash.com',
    'adhitz.com', 'adpierce.com',
    'clickadu.com', 'clicksco.net', 'hilltopads.com',
    '1xlite.com',
    'cloudflareinsights.com',
  ];

  const lines: string[] = [
    '! ===== Filmsnaps Legacy AD_PATTERNS (fallback) =====',
    '! These supplement EasyList for domains it may not yet cover',
    '',
  ];

  for (const p of patterns) {
    lines.push(`||${p}^$third-party`);
  }

  return lines.join('\n');
}
