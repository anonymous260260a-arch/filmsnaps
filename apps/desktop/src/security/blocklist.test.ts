import { describe, it, expect } from 'vitest';
import {
  shouldBlockUrl,
  isDownloadUrl,
  isVideoDomain,
  getBlockCategory,
  DOMAIN_BLOCKLIST,
  PATTERN_BLOCKLIST,
  DOWNLOAD_EXTENSIONS,
  VIDEO_DOMAIN_ALLOWLIST,
} from './blocklist';

describe('Blocklist', () => {
  describe('Data integrity', () => {
    it('DOMAIN_BLOCKLIST should be a non-empty Set', () => {
      expect(DOMAIN_BLOCKLIST).toBeInstanceOf(Set);
      expect(DOMAIN_BLOCKLIST.size).toBeGreaterThan(0);
    });

    it('PATTERN_BLOCKLIST should be a non-empty array', () => {
      expect(Array.isArray(PATTERN_BLOCKLIST)).toBe(true);
      expect(PATTERN_BLOCKLIST.length).toBeGreaterThan(0);
    });

    it('DOWNLOAD_EXTENSIONS should be a non-empty array', () => {
      expect(Array.isArray(DOWNLOAD_EXTENSIONS)).toBe(true);
      expect(DOWNLOAD_EXTENSIONS.length).toBeGreaterThan(0);
    });

    it('VIDEO_DOMAIN_ALLOWLIST should be a non-empty Set', () => {
      expect(VIDEO_DOMAIN_ALLOWLIST).toBeInstanceOf(Set);
      expect(VIDEO_DOMAIN_ALLOWLIST.size).toBeGreaterThan(0);
    });
  });

  describe('shouldBlockUrl', () => {
    it('should block known ad domains', () => {
      expect(shouldBlockUrl('https://doubleclick.net/ad.js')).toBe(true);
      expect(shouldBlockUrl('https://googleadservices.com/pagead')).toBe(true);
      expect(shouldBlockUrl('https://googlesyndication.com/pagead')).toBe(true);
    });

    it('should block analytics domains', () => {
      expect(shouldBlockUrl('https://google-analytics.com/collect')).toBe(true);
      expect(shouldBlockUrl('https://hotjar.com/hotjar.js')).toBe(true);
      expect(shouldBlockUrl('https://sentry.io/api/store')).toBe(true);
    });

    it('should block tracking patterns', () => {
      expect(shouldBlockUrl('https://example.com/analytics.js')).toBe(true);
      expect(shouldBlockUrl('https://example.com/tracking.js')).toBe(true);
      expect(shouldBlockUrl('https://example.com/gtag.js')).toBe(true);
    });

    it('should block crypto miners', () => {
      expect(shouldBlockUrl('https://coinhive.com/miner.js')).toBe(true);
      expect(shouldBlockUrl('https://coinimp.com/lib')).toBe(true);
    });

    it('should block UTM tracking parameters', () => {
      expect(shouldBlockUrl('https://example.com/page?utm_source=google')).toBe(true);
      expect(shouldBlockUrl('https://example.com/page?fbclid=abc123')).toBe(true);
      expect(shouldBlockUrl('https://example.com/page?gclid=xyz789')).toBe(true);
    });

    it('should NOT block legitimate video domains', () => {
      expect(shouldBlockUrl('https://web.nxsha.app/embed/movie/123')).toBe(false);
      expect(shouldBlockUrl('https://peachify.top/embed/movie/123')).toBe(false);
      expect(shouldBlockUrl('https://vidsrc.wtf/api/1/movie/?id=123')).toBe(false);
    });

    it('should NOT block CDN/video stream URLs', () => {
      expect(shouldBlockUrl('https://cdn.example.com/video.m3u8')).toBe(false);
      expect(shouldBlockUrl('https://video.example.com/manifest.mpd')).toBe(false);
    });

    it('should handle empty/null input gracefully', () => {
      expect(shouldBlockUrl('')).toBe(false);
      expect(shouldBlockUrl(null as any)).toBe(false);
      expect(shouldBlockUrl(undefined as any)).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(shouldBlockUrl('https://DOUBLECLICK.NET/ad.js')).toBe(true);
      expect(shouldBlockUrl('https://Google-Analytics.COM/collect')).toBe(true);
    });
  });

  describe('isDownloadUrl', () => {
    it('should block executable files', () => {
      expect(isDownloadUrl('https://example.com/app.exe')).toBe(true);
      expect(isDownloadUrl('https://example.com/app.apk')).toBe(true);
      expect(isDownloadUrl('https://example.com/app.msi')).toBe(true);
      expect(isDownloadUrl('https://example.com/app.dmg')).toBe(true);
    });

    it('should block archive files', () => {
      expect(isDownloadUrl('https://example.com/file.zip')).toBe(true);
      expect(isDownloadUrl('https://example.com/file.rar')).toBe(true);
      expect(isDownloadUrl('https://example.com/file.7z')).toBe(true);
    });

    it('should block Linux packages', () => {
      expect(isDownloadUrl('https://example.com/app.deb')).toBe(true);
      expect(isDownloadUrl('https://example.com/app.rpm')).toBe(true);
      expect(isDownloadUrl('https://example.com/app.AppImage')).toBe(true);
    });

    it('should NOT block video files', () => {
      expect(isDownloadUrl('https://example.com/video.mp4')).toBe(false);
      expect(isDownloadUrl('https://example.com/video.m3u8')).toBe(false);
      expect(isDownloadUrl('https://example.com/video.mkv')).toBe(false);
    });

    it('should NOT block web resources', () => {
      expect(isDownloadUrl('https://example.com/script.js')).toBe(false);
      expect(isDownloadUrl('https://example.com/style.css')).toBe(false);
      expect(isDownloadUrl('https://example.com/image.png')).toBe(false);
    });

    it('should handle empty/null input gracefully', () => {
      expect(isDownloadUrl('')).toBe(false);
      expect(isDownloadUrl(null as any)).toBe(false);
    });
  });

  describe('isVideoDomain', () => {
    it('should match video-related hostnames', () => {
      expect(isVideoDomain('vidsrc.wtf')).toBe(true);
      expect(isVideoDomain('embed.example.com')).toBe(true);
      expect(isVideoDomain('player.example.com')).toBe(true);
      expect(isVideoDomain('video.example.com')).toBe(true);
      expect(isVideoDomain('cdn.example.com')).toBe(true);
      expect(isVideoDomain('peachify.top')).toBe(true);
      expect(isVideoDomain('stream.example.com')).toBe(true);
    });

    it('should NOT match non-video hostnames', () => {
      expect(isVideoDomain('example.com')).toBe(false);
      expect(isVideoDomain('google.com')).toBe(false);
      expect(isVideoDomain('facebook.com')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isVideoDomain('VIDSRC.WTF')).toBe(true);
      expect(isVideoDomain('Player.Example.Com')).toBe(true);
    });
  });

  describe('getBlockCategory', () => {
    it('should categorize ad domains', () => {
      expect(getBlockCategory('https://doubleclick.net/ad.js')).toBe('ad');
      expect(getBlockCategory('https://popads.net/popup')).toBe('ad');
      expect(getBlockCategory('https://adsterra.com/serve')).toBe('ad');
    });

    it('should categorize tracker URI patterns', () => {
      // getBlockCategory checks domains first (returns 'ad' for most),
      // then falls through to pattern-based checks for URI substrings
      // Only 'pixel' and 'beacon' are checked for tracker category
      expect(getBlockCategory('https://example.com/pixel.js')).toBe('tracker');
      expect(getBlockCategory('https://example.com/beacon.js')).toBe('tracker');
    });

    it('should categorize crypto miners', () => {
      expect(getBlockCategory('https://coinhive.com/miner.js')).toBe('crypto-miner');
      expect(getBlockCategory('https://coinimp.com/lib')).toBe('crypto-miner');
    });

    it('should categorize tracking parameters', () => {
      expect(getBlockCategory('https://example.com/page?utm_source=google')).toBe('tracking-param');
      expect(getBlockCategory('https://example.com/page?fbclid=abc')).toBe('tracking-param');
    });

    it('should return unknown for unrecognized patterns', () => {
      expect(getBlockCategory('https://example.com/unknown')).toBe('unknown');
    });
  });
});
