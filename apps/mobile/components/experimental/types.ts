/**
 * Types for the experimental Nuvio provider sandbox.
 */

/** A single stream extracted by a provider */
export interface ProviderStream {
  name: string;
  title: string;
  url: string;
  quality: string;
  headers?: Record<string, string>;
  subtitles?: Array<{ url: string; language: string; name: string }>;
  provider: string;
}

/** Message posted from the sandbox WebView back to React Native */
export interface SandboxResult {
  type: 'result' | 'error' | 'log' | 'progress';
  streams?: ProviderStream[];
  message?: string;
  stack?: string;
  args?: string[];
  elapsed?: number;
}

/** Metadata about an experimental provider */
export interface ExperimentalProvider {
  /** Unique ID (matches the provider source key) */
  id: string;
  /** Human-readable display name */
  name: string;
  /** ISO language codes supported */
  languages: string[];
  /** Whether this provider requires external deps (cheerio/crypto-js) */
  deps: {
    crypto?: boolean;
    cheerio?: boolean;
  };
  /** Estimated extraction complexity */
  complexity: 'simple' | 'medium' | 'complex';
}

/** Parameters for a provider test */
export interface TestParams {
  tmdbId: string;
  mediaType: 'movie' | 'tv';
  season: number;
  episode: number;
}

/** Per-provider test result */
export interface ProviderTestResult {
  providerId: string;
  status: 'pending' | 'running' | 'success' | 'error';
  streams: ProviderStream[];
  error?: string;
  elapsed?: number;
  startTime?: number;
}
