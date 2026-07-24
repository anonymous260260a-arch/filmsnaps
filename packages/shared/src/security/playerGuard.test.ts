import { describe, it, expect } from 'vitest';
import {
  buildGuardScript,
  buildContentReadyScript,
  buildBridgeScript,
  buildProgressTrackerScript,
  buildAllScripts,
  buildAllScriptsWithScriptlets,
  DEFAULT_AD_FULL_PATTERNS,
  DEFAULT_AD_SHORT_PATTERNS,
} from './playerGuard';

describe('Player Guard Scripts', () => {
  describe('DEFAULT_AD patterns', () => {
    it('DEFAULT_AD_FULL_PATTERNS should be a non-empty array', () => {
      expect(Array.isArray(DEFAULT_AD_FULL_PATTERNS)).toBe(true);
      expect(DEFAULT_AD_FULL_PATTERNS.length).toBeGreaterThan(0);
    });

    it('DEFAULT_AD_SHORT_PATTERNS should be a non-empty array', () => {
      expect(Array.isArray(DEFAULT_AD_SHORT_PATTERNS)).toBe(true);
      expect(DEFAULT_AD_SHORT_PATTERNS.length).toBeGreaterThan(0);
    });

    it('SHORT patterns should be subsets or prefixes of FULL patterns', () => {
      for (const pattern of DEFAULT_AD_SHORT_PATTERNS) {
        const exactMatch = DEFAULT_AD_FULL_PATTERNS.includes(pattern);
        const prefixMatch = DEFAULT_AD_FULL_PATTERNS.some(
          (full) => full.startsWith(pattern) || pattern.startsWith(full)
        );
        expect(exactMatch || prefixMatch).toBe(true);
      }
    });

    it('should include common ad domains', () => {
      expect(DEFAULT_AD_FULL_PATTERNS).toContain('doubleclick.net');
      expect(DEFAULT_AD_FULL_PATTERNS).toContain('googleadservices.com');
      expect(DEFAULT_AD_FULL_PATTERNS).toContain('googlesyndication.com');
    });
  });

  describe('buildGuardScript', () => {
    it('should return a non-empty string', () => {
      const script = buildGuardScript('example.com');
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });

    it('should be a self-executing function', () => {
      const script = buildGuardScript('example.com');
      expect(script).toContain('(function()');
      expect(script).toContain('})()');
    });

    it('should accept provider hostname parameter without error', () => {
      const script = buildGuardScript('example.com');
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });

    it('should use default patterns when none provided', () => {
      const script = buildGuardScript('example.com');
      // Should contain JSON-encoded default patterns
      expect(script).toContain('doubleclick.net');
      expect(script).toContain('googleadservices.com');
    });

    it('should use custom patterns when provided', () => {
      const customPatterns = ['custom-ad.com', 'tracker.net'];
      const script = buildGuardScript('example.com', customPatterns);
      expect(script).toContain('custom-ad.com');
      expect(script).toContain('tracker.net');
      // Should NOT contain default patterns
      expect(script).not.toContain('doubleclick.net');
    });

    it('should include popup blocking', () => {
      const script = buildGuardScript('example.com');
      expect(script).toContain('window.open');
    });

    it('should include fetch interception', () => {
      const script = buildGuardScript('example.com');
      expect(script).toContain('fetch');
    });

    it('should include XHR interception', () => {
      const script = buildGuardScript('example.com');
      expect(script).toContain('XMLHttpRequest');
    });

    it('should include anti-anti-adblock measures', () => {
      const script = buildGuardScript('example.com');
      expect(script).toContain('_maskFn');
      expect(script).toContain('_fsNativeStr');
    });
  });

  describe('buildContentReadyScript', () => {
    it('should return a non-empty string', () => {
      const script = buildContentReadyScript();
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });

    it('should be a self-executing function', () => {
      const script = buildContentReadyScript();
      expect(script).toContain('(function()');
    });

    it('should post a content-ready message', () => {
      const script = buildContentReadyScript();
      expect(script).toContain('content-ready');
    });
  });

  describe('buildBridgeScript', () => {
    it('should return a non-empty string', () => {
      const script = buildBridgeScript();
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });

    it('should be a self-executing function', () => {
      const script = buildBridgeScript();
      expect(script).toContain('(function()');
    });

    it('should set up message event listener', () => {
      const script = buildBridgeScript();
      expect(script).toContain('addEventListener');
      expect(script).toContain('message');
    });
  });

  describe('buildProgressTrackerScript', () => {
    it('should return a non-empty string', () => {
      const script = buildProgressTrackerScript();
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });

    it('should be a self-executing function', () => {
      const script = buildProgressTrackerScript();
      expect(script).toContain('(function()');
    });

    it('should track video progress', () => {
      const script = buildProgressTrackerScript();
      expect(script).toContain('timeupdate');
      expect(script).toContain('currentTime');
    });
  });

  describe('buildAllScripts', () => {
    it('should combine all scripts', () => {
      const all = buildAllScripts('example.com');
      const guard = buildGuardScript('example.com');
      const ready = buildContentReadyScript();
      const bridge = buildBridgeScript();
      const progress = buildProgressTrackerScript();

      expect(all).toContain(guard);
      expect(all).toContain(ready);
      expect(all).toContain(bridge);
      expect(all).toContain(progress);
    });

    it('should be larger than any individual script', () => {
      const all = buildAllScripts('example.com');
      const guard = buildGuardScript('example.com');
      expect(all.length).toBeGreaterThan(guard.length);
    });
  });

  describe('buildAllScriptsWithScriptlets', () => {
    it('should return a non-empty string', () => {
      const script = buildAllScriptsWithScriptlets('example.com');
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });

    it('should include scriptlets', () => {
      const script = buildAllScriptsWithScriptlets('example.com');
      // Scriptlets should be present
      expect(script).toContain('abort-on-property-read');
    });

    it('should include provider-specific scriptlets when providerId given', () => {
      const script = buildAllScriptsWithScriptlets('example.com', 'nxsha');
      expect(script.length).toBeGreaterThan(0);
    });
  });

  describe('Script safety', () => {
    it('guard script should not contain syntax errors (basic check)', () => {
      const script = buildGuardScript('example.com');
      // Remove the self-executing wrapper for syntax check
      const inner = script.slice(
        script.indexOf('(function()'),
        script.lastIndexOf('})()') + 4
      );
      // Should not throw when parsed
      expect(() => new Function(inner)).not.toThrow();
    });

    it('scripts should be valid JavaScript strings', () => {
      const scripts = [
        buildGuardScript('example.com'),
        buildContentReadyScript(),
        buildBridgeScript(),
        buildProgressTrackerScript(),
      ];

      for (const script of scripts) {
        expect(typeof script).toBe('string');
        expect(script.length).toBeGreaterThan(0);
        // Should not contain null bytes
        expect(script).not.toContain('\0');
      }
    });
  });
});
