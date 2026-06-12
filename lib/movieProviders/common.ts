/**
 * Common utilities for provider sanitization
 * This file was referenced but missing — now provides basic HTML cleanup
 * used by movieapi.ts, vixsrc.ts, and other providers
 */

/**
 * Base sanitization — strips event handlers and dangerous attributes
 * but preserves the player scripts and structure
 */
export function baseSanitize(html: string, _url: string): string {
  return html
    // Remove onclick and other event handler attributes
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
    // Remove javascript: protocol links
    .replace(/\s+href\s*=\s*["']javascript:[^"']*["']/gi, '')
    // Remove target attributes that open new windows
    .replace(/\s+target\s*=\s*["'][^"']*["']/gi, '')
    // Remove form actions
    .replace(/\s+action\s*=\s*["'][^"']*["']/gi, '')
    // Remove meta refresh
    .replace(/<meta[^>]*http-equiv=["']refresh["'][^>]*>/gi, '');
}

/**
 * Strip tracking scripts from HTML (basic version)
 */
export function stripTrackers(html: string): string {
  return html
    // Remove known tracker scripts
    .replace(/<script[^>]*src=["'][^"']*(?:analytics|tracking|beacon|telemetry|rum)[^"']*["'][^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove tracking pixels
    .replace(/<img[^>]*src=["'][^"']*(?:pixel|track|beacon)[^"']*["'][^>]*\/?>/gi, '')
    // Remove hidden iframes
    .replace(/<iframe[^>]*(?:style=["']display:\s*none["']|width=["']0["']|height=["']0["'])[^>]*>[\s\S]*?<\/iframe>/gi, '');
}
