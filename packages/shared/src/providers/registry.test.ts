import { describe, it, expect } from 'vitest';
import {
  PROVIDERS,
  getProvider,
  getEnabledProviders,
  isProtectionEnabled,
} from './registry';
import type { ProviderDefinition } from '../types/provider';

describe('Provider Registry', () => {
  describe('PROVIDERS array', () => {
    it('should be a non-empty array', () => {
      expect(Array.isArray(PROVIDERS)).toBe(true);
      expect(PROVIDERS.length).toBeGreaterThan(0);
    });

    it('should have unique IDs across all providers', () => {
      const ids = PROVIDERS.map((p) => p.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('every provider should have required fields', () => {
      for (const provider of PROVIDERS) {
        expect(provider.id).toBeTruthy();
        expect(typeof provider.id).toBe('string');
        expect(provider.name).toBeTruthy();
        expect(provider.baseUrl).toBeTruthy();
        expect(provider.embed).toBeDefined();
        expect(typeof provider.embed.movie).toBe('function');
        expect(typeof provider.embed.tv).toBe('function');
      }
    });

    it('every provider baseUrl should be a valid URL', () => {
      for (const provider of PROVIDERS) {
        expect(() => new URL(provider.baseUrl)).not.toThrow();
      }
    });
  });

  describe('getProvider', () => {
    it('should return a provider by exact id', () => {
      const provider = getProvider('nxsha');
      expect(provider).toBeDefined();
      expect(provider?.id).toBe('nxsha');
      expect(provider?.name).toBe('Nxsha');
    });

    it('should be case-insensitive', () => {
      const upper = getProvider('NXSHA');
      const lower = getProvider('nxsha');
      expect(upper?.id).toBe(lower?.id);
    });

    it('should return undefined for non-existent id', () => {
      expect(getProvider('nonexistent')).toBeUndefined();
    });

    it('should return undefined for disabled providers', () => {
      // multiembed is explicitly disabled
      expect(getProvider('multiembed')).toBeUndefined();
    });

    it('should find all enabled providers by id', () => {
      const enabledIds = PROVIDERS
        .filter((p) => p.enabled !== false)
        .map((p) => p.id);

      for (const id of enabledIds) {
        expect(getProvider(id)).toBeDefined();
      }
    });
  });

  describe('getEnabledProviders', () => {
    it('should return only enabled providers', () => {
      const enabled = getEnabledProviders();
      for (const provider of enabled) {
        expect(provider.enabled).not.toBe(false);
      }
    });

    it('should exclude forDownloadOnly providers by default', () => {
      const enabled = getEnabledProviders(false);
      for (const provider of enabled) {
        expect(provider.forDownloadOnly).not.toBe(true);
      }
    });

    it('should include forDownloadOnly when explicitly requested', () => {
      const all = getEnabledProviders(true);
      const downloadOnly = all.filter((p) => p.forDownloadOnly);
      expect(downloadOnly.length).toBeGreaterThan(0);
    });

    it('should sort by order (ascending)', () => {
      const enabled = getEnabledProviders();
      for (let i = 1; i < enabled.length; i++) {
        const prevOrder = enabled[i - 1].order ?? 999;
        const currOrder = enabled[i].order ?? 999;
        expect(currOrder).toBeGreaterThanOrEqual(prevOrder);
      }
    });

    it('should not include disabled providers', () => {
      const enabled = getEnabledProviders();
      const disabledIds = PROVIDERS
        .filter((p) => p.enabled === false)
        .map((p) => p.id);

      for (const id of disabledIds) {
        expect(enabled.find((p) => p.id === id)).toBeUndefined();
      }
    });
  });

  describe('isProtectionEnabled', () => {
    it('should return true for provider with protection.enabled = true', () => {
      const nxsha = PROVIDERS.find((p) => p.id === 'nxsha');
      expect(nxsha).toBeDefined();
      expect(isProtectionEnabled(nxsha!)).toBe(true);
    });

    it('should return true for provider without protection config (default)', () => {
      const providerWithoutProtection: ProviderDefinition = {
        id: 'test',
        name: 'Test',
        baseUrl: 'https://test.com',
        embed: {
          movie: (id) => `/movie/${id}`,
          tv: (id, s, e) => `/tv/${id}/${s}/${e}`,
        },
      };
      expect(isProtectionEnabled(providerWithoutProtection)).toBe(true);
    });

    it('should return false for provider with protection.enabled = false', () => {
      const providerDisabled: ProviderDefinition = {
        id: 'test',
        name: 'Test',
        baseUrl: 'https://test.com',
        embed: {
          movie: (id) => `/movie/${id}`,
          tv: (id, s, e) => `/tv/${id}/${s}/${e}`,
        },
        protection: { enabled: false },
      };
      expect(isProtectionEnabled(providerDisabled)).toBe(false);
    });
  });

  describe('Embed URL builders', () => {
    it('should generate correct movie embed URLs', () => {
      const nxsha = getProvider('nxsha');
      expect(nxsha?.embed.movie('12345')).toContain('12345');
      expect(nxsha?.embed.movie('12345')).toContain('/embed/movie/');
    });

    it('should generate correct TV embed URLs with season and episode', () => {
      const nxsha = getProvider('nxsha');
      const url = nxsha?.embed.tv('12345', 2, 3);
      expect(url).toContain('12345');
      expect(url).toContain('/embed/tv/');
      expect(url).toContain('2');
      expect(url).toContain('3');
    });

    it('should handle startAt parameter for providers that support it', () => {
      const vidsrc = PROVIDERS.find((p) => p.id === 'vidsrc');
      if (vidsrc && vidsrc.embed.movie.length >= 2) {
        const url = (vidsrc.embed.movie as Function)('12345', 60);
        expect(url).toContain('startAt=60');
      }
    });
  });
});
