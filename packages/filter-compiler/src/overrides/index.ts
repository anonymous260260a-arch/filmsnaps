/**
 * Per-provider overrides.
 *
 * These define provider-specific video CDN allowlists (so the adblocker
 * doesn't accidentally block video content) and additional ad/tracker
 * patterns specific to each provider.
 *
 * Allow patterns become:   @@||domain^$document
 * Block patterns become:   ||domain^$third-party
 */

export interface ProviderOverride {
  providerId: string;
  displayName: string;
  /** Domains that must never be blocked (video CDNs) */
  allowPatterns: string[];
  /** Extra ad/tracker domains specific to this provider */
  blockPatterns: string[];
  note?: string;
}

// ── All provider overrides ─────────────────────────────────────────

const ALL_OVERRIDES: ProviderOverride[] = [
  // ── Server 1: Nxsha ──────────────────────────────────────────
  {
    providerId: 'nxsha',
    displayName: 'Nxsha / Server 1',
    allowPatterns: [
      'nxsha.app',
      'web.nxsha.app',
      'nxcdn.app',
      'nxcdn.video',
      'nxs-ha.com',
    ],
    blockPatterns: [],
    note: 'NXCloud CDN serves from various subdomains',
  },
  // ── Server 2: Peachify ───────────────────────────────────────
  {
    providerId: 'peachify',
    displayName: 'Peachify / Server 2',
    allowPatterns: ['peachify.top'],
    blockPatterns: [],
  },
  // ── Server 3: ScreenScape ────────────────────────────────────
  {
    providerId: 'screenscape',
    displayName: 'ScreenScape / Server 3',
    allowPatterns: ['screenscape.me'],
    blockPatterns: [],
  },
  // ── Server 4: NHD Api ────────────────────────────────────────
  {
    providerId: 'nhdapi',
    displayName: 'NHD Api / Server 4',
    allowPatterns: [
      'nhdapi.com',
      'nhdcdn.com',
      'nhd.video',
    ],
    blockPatterns: [],
  },
  // ── Server 5: ZxcStream ──────────────────────────────────────
  {
    providerId: 'zxcstream',
    displayName: 'ZxcStream / Server 5',
    allowPatterns: ['zxcstream.xyz'],
    blockPatterns: [],
  },
  // ── Server 6: CinemaOS ───────────────────────────────────────
  {
    providerId: 'cinemaos',
    displayName: 'CinemaOS / Server 6',
    allowPatterns: ['cinemaos.live'],
    blockPatterns: [],
  },
  // ── Server 14: VidNest ────────────────────────────────────────
  {
    providerId: 'vidnest',
    displayName: 'VidNest / Server 14',
    allowPatterns: [
      'vidnest.fun',
      'vidnest-prod.com',
    ],
    blockPatterns: [],
  },
  // ── Server 18: ChillFlix ─────────────────────────────────────
  {
    providerId: 'chillflix',
    displayName: 'ChillFlix / Server 18',
    allowPatterns: [
      'chillflix.pw',
      'chillflix.lol',
      'chillflix.bond',
      'chillflix.biz',
      'www.chillflix.lol',
    ],
    blockPatterns: [],
    note: 'Multiple TLDs — rotates frequently',
  },
  // ── Server 19: TouStream ─────────────────────────────────────
  {
    providerId: 'toustream',
    displayName: 'TouStream / Server 19',
    allowPatterns: ['toustream.xyz'],
    blockPatterns: [],
  },
  // ── StreamGuide ──────────────────────────────────────────────
  {
    providerId: 'streamguide',
    displayName: 'StreamGuide',
    allowPatterns: ['streamguide.cfd'],
    blockPatterns: [],
  },
  // ── Server 20: VidKing ────────────────────────────────────────
  {
    providerId: 'vidking',
    displayName: 'VidKing / Server 20',
    allowPatterns: [
      'vidking.net',
      'www.vidking.net',
    ],
    blockPatterns: [],
  },
];

// ── Public API ─────────────────────────────────────────────────────

/**
 * Load all provider overrides.
 */
export function loadAllOverrides(): ProviderOverride[] {
  return ALL_OVERRIDES;
}

/**
 * Get overrides for a specific provider by ID.
 */
export function getOverrideFor(providerId: string): ProviderOverride | undefined {
  return ALL_OVERRIDES.find((o) => o.providerId === providerId);
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
