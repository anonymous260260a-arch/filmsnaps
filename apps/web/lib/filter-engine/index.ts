/**
 * Filter Engine - uBlock Origin-inspired rule matching system
 * 
 * This module implements a pattern-based URL filtering system similar to uBlock Origin.
 * It supports EasyList-style filter rules for blocking trackers, ads, and unwanted resources.
 * 
 * Rule Syntax:
 * - ||domain.com^          - Block any URL containing domain.com
 * - ||cdn-cgi/rum^         - Block URLs containing cdn-cgi/rum
 * - |https://exact.com^    - Block exact domain match
 * - *.google-analytics.*   - Wildcard matching
 * - /regex_pattern/        - Regex patterns
 */

export interface FilterRule {
  raw: string;
  type: 'domain' | 'path' | 'regex' | 'exact';
  pattern: string;
  domains?: string[]; // Optional: only apply to specific domains
  options?: FilterOptions;
}

export interface FilterOptions {
  thirdParty?: boolean;
  firstParty?: boolean;
  script?: boolean;
  image?: boolean;
  xhr?: boolean;
  fetch?: boolean;
  websocket?: boolean;
  frame?: boolean;
  media?: boolean;
}

export interface FilterResult {
  blocked: boolean;
  rule?: FilterRule;
  reason: string;
}

/**
 * Default filter rules - blocks common trackers and unwanted resources
 * These rules are applied both server-side and client-side
 */
export const DEFAULT_FILTER_RULES: string[] = [
  // Cloudflare tracking
  '||cdn-cgi/rum^',
  '||cdn-cgi/challenge-platform^',
  '||cloudflareinsights.com^',
  '||cloudflarestream.com^',
  
  // Google tracking
  '||googletagmanager.com^',
  '||google-analytics.com^',
  '||googleadservices.com^',
  '||googleads.g.doubleclick.net^',
  '||stats.g.doubleclick.net^',
  '||analytics.google.com^',
  '||gtag/js^',
  
  // DoubleClick
  '||doubleclick.net^',
  '||ad.doubleclick.net^',
  
  // Facebook/Meta tracking
  '||facebook.com/tr^',
  '||connect.facebook.net^',
  '||pixel.facebook.com^',
  
  // Analytics services
  '||umami.is^',
  '||umami.*.com^',
  '||analytics.*.com^',
  '||plausible.io^',
  '||matomo.*^',
  '||hotjar.com^',
  '||fullstory.com^',
  '||logrocket.com^',
  '||sentry.io^',
  
  // Ad networks
  '||adsystem.*^',
  '||adserver.*^',
  '||ads.*.com^',
  '||banner.*^',
  
  // Tracking pixels
  '||pixel.*^',
  '||track.*^',
  '||tracking.*^',
  '||beacon.*^',
  '||telemetry.*^',
  
  // Known malicious domains
  '||histats.com^',
  '||counter.*.com^',
  '||statcounter.com^',
  
  // Crypto miners
  '||coinhive.com^',
  '||cryptoloot.*^',
  
  // Popunder/Popup networks
  '||popads.*^',
  '||popcash.*^',
  
  // Specific file patterns
  '||/analytics.js^',
  '||/tracking.js^',
  '||/tracker.js^',
  '||/beacon.js^',
  '||/telemetry.js^',
  '||/rum.js^',
  
  // Query parameter patterns
  '?utm_',
  '?fbclid=',
  '?gclid=',
  '?_ga=',
];

/**
 * Parse a filter rule string into a structured FilterRule object
 */
export function parseFilterRule(ruleString: string): FilterRule | null {
  const raw = ruleString.trim();
  
  // Skip empty lines and comments
  if (!raw || raw.startsWith('!') || raw.startsWith('#')) {
    return null;
  }
  
  // Extract options (after $)
  let options: FilterOptions | undefined;
  let pattern = raw;
  
  if (raw.includes('$')) {
    const [mainPart, optionsPart] = raw.split('$');
    pattern = mainPart;
    options = parseFilterOptions(optionsPart);
  }
  
  // Determine rule type and extract pattern
  if (pattern.startsWith('/') && pattern.endsWith('/')) {
    // Regex pattern
    return {
      raw,
      type: 'regex',
      pattern: pattern.slice(1, -1),
      options,
    };
  }
  
  if (pattern.startsWith('||')) {
    // Domain pattern: ||domain.com^
    const domainPattern = pattern.slice(2).replace(/\^$/, '');
    return {
      raw,
      type: 'domain',
      pattern: domainPattern,
      options,
    };
  }
  
  if (pattern.startsWith('|')) {
    // Exact URL start: |https://example.com
    return {
      raw,
      type: 'exact',
      pattern: pattern.slice(1),
      options,
    };
  }
  
  // Path pattern or simple substring match
  return {
    raw,
    type: 'path',
    pattern,
    options,
  };
}

/**
 * Parse filter options string (e.g., "third-party,script")
 */
function parseFilterOptions(optionsString: string): FilterOptions {
  const options: FilterOptions = {};
  const parts = optionsString.split(',');
  
  for (const part of parts) {
    const trimmed = part.trim();
    
    switch (trimmed) {
      case 'third-party':
        options.thirdParty = true;
        break;
      case 'first-party':
        options.firstParty = true;
        break;
      case 'script':
        options.script = true;
        break;
      case 'image':
        options.image = true;
        break;
      case 'xmlhttprequest':
      case 'xhr':
        options.xhr = true;
        break;
      case 'fetch':
        options.fetch = true;
        break;
      case 'websocket':
      case 'ws':
        options.websocket = true;
        break;
      case 'frame':
      case 'subdocument':
        options.frame = true;
        break;
      case 'media':
        options.media = true;
        break;
    }
  }
  
  return options;
}

/**
 * Compile filter rules for efficient matching
 */
export function compileFilterRules(rules: string[]): FilterRule[] {
  const compiled: FilterRule[] = [];
  
  for (const rule of rules) {
    const parsed = parseFilterRule(rule);
    if (parsed) {
      compiled.push(parsed);
    }
  }
  
  return compiled;
}

/**
 * Check if a URL should be blocked based on filter rules
 */
export function matchFilter(
  url: string,
  rules: FilterRule[],
  context?: {
    requestOrigin?: string;
    pageOrigin?: string;
    requestType?: 'script' | 'image' | 'xhr' | 'fetch' | 'websocket' | 'frame' | 'media' | 'other';
  }
): FilterResult {
  const urlLower = url.toLowerCase();
  let urlObj: URL | null = null;
  
  try {
    urlObj = new URL(url);
  } catch {
    // Invalid URL, can't match
  }
  
  for (const rule of rules) {
    if (matchesRule(url, urlLower, urlObj, rule, context)) {
      return {
        blocked: true,
        rule,
        reason: `Blocked by filter rule: ${rule.raw}`,
      };
    }
  }
  
  return {
    blocked: false,
    reason: 'No matching filter rules',
  };
}

/**
 * Check if a URL matches a specific rule
 */
function matchesRule(
  url: string,
  urlLower: string,
  urlObj: URL | null,
  rule: FilterRule,
  context?: {
    requestOrigin?: string;
    pageOrigin?: string;
    requestType?: string;
  }
): boolean {
  // Check request type options
  if (context?.requestType && rule.options) {
    const typeMap: Record<string, keyof FilterOptions> = {
      'script': 'script',
      'image': 'image',
      'xmlhttprequest': 'xhr',
      'xhr': 'xhr',
      'fetch': 'fetch',
      'websocket': 'websocket',
      'frame': 'frame',
      'subdocument': 'frame',
      'media': 'media',
    };
    
    const optionKey = typeMap[context.requestType];
    if (optionKey && rule.options[optionKey] === false) {
      return false;
    }
  }
  
  // Check third-party/first-party options
  if (context?.requestOrigin && context?.pageOrigin) {
    const isThirdParty = new URL(context.requestOrigin).hostname !== new URL(context.pageOrigin).hostname;
    
    if (rule.options?.thirdParty && !isThirdParty) {
      return false;
    }
    if (rule.options?.firstParty && isThirdParty) {
      return false;
    }
  }
  
  // Match based on rule type
  switch (rule.type) {
    case 'regex':
      try {
        const regex = new RegExp(rule.pattern, 'i');
        return regex.test(url);
      } catch {
        return false;
      }
      
    case 'domain':
      // Match if the domain pattern appears anywhere in the URL
      return urlLower.includes(rule.pattern.toLowerCase());
      
    case 'exact':
      // Match exact domain start
      return urlLower.startsWith(rule.pattern.toLowerCase());
      
    case 'path':
      // Simple substring match
      return urlLower.includes(rule.pattern.toLowerCase());
  }
  
  return false;
}

/**
 * Create a filter engine instance with compiled rules
 */
export function createFilterEngine(customRules?: string[]) {
  const allRules = [...DEFAULT_FILTER_RULES, ...(customRules || [])];
  const compiledRules = compileFilterRules(allRules);
  
  return {
    /**
     * Check if a URL should be blocked
     */
    shouldBlock(url: string, context?: Parameters<typeof matchFilter>[2]): FilterResult {
      return matchFilter(url, compiledRules, context);
    },
    
    /**
     * Check if URL is blocked (boolean only)
     */
    isBlocked(url: string, context?: Parameters<typeof matchFilter>[2]): boolean {
      return this.shouldBlock(url, context).blocked;
    },
    
    /**
     * Get all compiled rules
     */
    getRules(): FilterRule[] {
      return [...compiledRules];
    },
    
    /**
     * Add custom rules at runtime
     */
    addRules(newRules: string[]): void {
      const parsed = compileFilterRules(newRules);
      compiledRules.push(...parsed);
    },
    
    /**
     * Remove rules matching a pattern
     */
    removeRules(pattern: string): void {
      const index = compiledRules.findIndex(r => r.raw.includes(pattern));
      if (index !== -1) {
        compiledRules.splice(index, 1);
      }
    },
  };
}

/**
 * Generate a minified version of the filter engine for client-side injection
 */
export function generateClientSideFilterEngine(): string {
  const rulesJson = JSON.stringify(DEFAULT_FILTER_RULES);
  
  return `
(function() {
  'use strict';
  
  var DEFAULT_FILTER_RULES = ${rulesJson};
  
  function parseFilterRule(ruleString) {
    var raw = ruleString.trim();
    if (!raw || raw.startsWith('!') || raw.startsWith('#')) return null;
    
    var options = undefined;
    var pattern = raw;
    
    if (raw.includes('$')) {
      var parts = raw.split('$');
      pattern = parts[0];
      // Options parsing simplified for client-side
    }
    
    if (pattern.startsWith('/') && pattern.endsWith('/')) {
      return { type: 'regex', pattern: pattern.slice(1, -1), raw: raw };
    }
    if (pattern.startsWith('||')) {
      return { type: 'domain', pattern: pattern.slice(2).replace(/\\^$/, ''), raw: raw };
    }
    if (pattern.startsWith('|')) {
      return { type: 'exact', pattern: pattern.slice(1), raw: raw };
    }
    return { type: 'path', pattern: pattern, raw: raw };
  }
  
  var compiledRules = DEFAULT_FILTER_RULES.map(parseFilterRule).filter(Boolean);
  
  function shouldBlock(url) {
    var urlLower = url.toLowerCase();
    
    for (var i = 0; i < compiledRules.length; i++) {
      var rule = compiledRules[i];
      var rulePattern = rule.pattern.toLowerCase();
      
      switch (rule.type) {
        case 'regex':
          try {
            if (new RegExp(rule.pattern, 'i').test(url)) return true;
          } catch(e) {}
          break;
        case 'domain':
        case 'path':
          if (urlLower.includes(rulePattern)) return true;
          break;
        case 'exact':
          if (urlLower.startsWith(rulePattern)) return true;
          break;
      }
    }
    return false;
  }
  
  // Override fetch
  var originalFetch = window.fetch;
  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : input.url;
    if (shouldBlock(url)) {
      console.log('[FilterEngine] Blocked fetch:', url);
      return Promise.resolve(new Response('', { status: 204 }));
    }
    return originalFetch.apply(this, arguments);
  };
  
  // Override XMLHttpRequest
  var originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (shouldBlock(url)) {
      console.log('[FilterEngine] Blocked XHR:', url);
      this._blocked = true;
      return;
    }
    return originalXHROpen.apply(this, arguments);
  };
  
  var originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    if (this._blocked) {
      console.log('[FilterEngine] Blocked XHR send');
      return;
    }
    return originalXHRSend.apply(this, arguments);
  };
  
  // Expose for debugging
  window.__filterEngine = { shouldBlock, compiledRules };
})();
`.trim();
}

// Export for use in other modules
export default {
  parseFilterRule,
  compileFilterRules,
  matchFilter,
  createFilterEngine,
  generateClientSideFilterEngine,
  DEFAULT_FILTER_RULES,
};
