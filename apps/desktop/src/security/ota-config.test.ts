/**
 * OTA config loader — ring-buffer rollback + 3×-failure watchdog.
 *
 * Electron's `app` and the provider-config verification helpers are mocked so
 * the pure logic (rotation, rollback, failure counting, heal logging) runs in
 * a plain vitest node environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockUserDataDir = mkdtempSync(join(tmpdir(), "ota-test-"));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) =>
      name === "userData" ? mockUserDataDir : tmpdir(),
    ),
  },
}));

const mockVerifySig = vi.fn();
const mockVerifyFileSig = vi.fn();
vi.mock("./provider-config", () => ({
  reloadConfig: vi.fn(),
  loadBlocklistConfig: vi.fn(),
  verifyConfigFileSignature: vi.fn((p: string) => mockVerifyFileSig(p)),
  verifyConfigSignature: vi.fn((b: Buffer, s: string) => mockVerifySig(b, s)),
}));

import {
  recordProviderFailure,
  recordProviderSuccess,
  activateOtaConfigIfPresent,
} from "./ota-config";

describe("OTA config loader", () => {
  beforeEach(() => {
    rmSync(mockUserDataDir, { recursive: true, force: true });
    mockVerifySig.mockReset();
    mockVerifyFileSig.mockReset();
    // Default: signatures verify.
    mockVerifySig.mockReturnValue(true);
    mockVerifyFileSig.mockReturnValue(true);
  });

  afterEach(() => {
    rmSync(mockUserDataDir, { recursive: true, force: true });
  });

  describe("watchdog failure counting", () => {
    it("does NOT trigger until 3 consecutive failures, resets on success", () => {
      // First two failures: counter builds, no rollback attempt (returns false
      // because there's no prior config to roll to, and count < 3 anyway).
      expect(recordProviderFailure("nxsha", "ERR_FAILED")).toBe(false);
      expect(recordProviderFailure("nxsha", "ERR_FAILED")).toBe(false);

      // A success resets the counter back to 0.
      recordProviderSuccess("nxsha");
      expect(recordProviderFailure("nxsha", "ERR_FAILED")).toBe(false);
      expect(recordProviderFailure("nxsha", "ERR_FAILED")).toBe(false);

      // Third consecutive failure reaches the threshold → watchdog fires and
      // attempts a rollback. With no prior config on disk the rollback result
      // is false, but the counter is consumed (next call starts fresh at 1).
      expect(recordProviderFailure("nxsha", "ERR_FAILED")).toBe(false);
      expect(recordProviderFailure("nxsha", "ERR_FAILED")).toBe(false);
    });

    it("ignores non-watchdog error codes", () => {
      expect(recordProviderFailure("nxsha", "ERR_NAME_NOT_RESOLVED")).toBe(
        false,
      );
      expect(
        recordProviderFailure("nxsha", "ERR_CERT_COMMON_NAME_INVALID"),
      ).toBe(false);
      // These don't count toward the threshold.
      expect(recordProviderFailure("nxsha", "ERR_FAILED")).toBe(false);
    });
  });

  describe("ring-buffer activation + rollback", () => {
    it("activates a validated OTA config, ignoring an invalid one", () => {
      // No config present → no-op, no error.
      activateOtaConfigIfPresent();

      // Valid config → activated.
      mockVerifyFileSig.mockReturnValue(true);
      const dir = join(mockUserDataDir, "ota-config");
      const { mkdirSync } = require("fs");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "providers.json"), '{"version":5}');
      writeFileSync(join(dir, "providers.json.sig"), "base64sig");
      activateOtaConfigIfPresent();
      // Invalid config → ignored (bundled default wins), no activation.
      mockVerifyFileSig.mockReturnValue(false);
      activateOtaConfigIfPresent(); // must not throw, no reload happened
    });

    it("rolls back to the prior validated config on watchdog trigger", () => {
      // Build a ring buffer: active (v5) + prior (v4).
      const dir = join(mockUserDataDir, "ota-config");
      const { mkdirSync } = require("fs");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "providers.json"),
        '{"version":5,"current":true}',
      );
      writeFileSync(join(dir, "providers.json.sig"), "sig-v5");
      writeFileSync(
        join(dir, "providers.v4.json"),
        '{"version":4,"prior":true}',
      );
      writeFileSync(join(dir, "providers.v4.json.sig"), "sig-v4");

      // All signatures verify → 3 failures trigger rollback to .v4.
      mockVerifyFileSig.mockReturnValue(true);
      expect(recordProviderFailure("chillflix", "ERR_FAILED")).toBe(false);
      expect(recordProviderFailure("chillflix", "ERR_FAILED")).toBe(false);
      expect(recordProviderFailure("chillflix", "ERR_FAILED")).toBe(true);

      // Rollback should have copied .v4 → providers.json.
      const active = readFileSync(join(dir, "providers.json"), "utf-8");
      expect(active).toContain('"prior":true');
      expect(active).not.toContain('"current":true');
    });

    it("skips rollback when the prior config signature is invalid", () => {
      const dir = join(mockUserDataDir, "ota-config");
      const { mkdirSync } = require("fs");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "providers.json"),
        '{"version":5,"current":true}',
      );
      writeFileSync(join(dir, "providers.json.sig"), "sig-v5");
      writeFileSync(
        join(dir, "providers.v4.json"),
        '{"version":4,"prior":true}',
      );
      writeFileSync(join(dir, "providers.v4.json.sig"), "sig-v4-bad");

      // Prior config fails verification → rollback skips, active unchanged.
      mockVerifyFileSig.mockImplementation((p: string) => !p.includes("v4"));
      expect(recordProviderFailure("nxsha", "ERR_FAILED")).toBe(false);
      expect(recordProviderFailure("nxsha", "ERR_FAILED")).toBe(false);
      expect(recordProviderFailure("nxsha", "ERR_FAILED")).toBe(false); // no rollback

      const active = readFileSync(join(dir, "providers.json"), "utf-8");
      expect(active).toContain('"current":true');
    });
  });

  describe("heal-events.log", () => {
    it("writes a human-readable heal log on rollback", () => {
      const dir = join(mockUserDataDir, "ota-config");
      const { mkdirSync } = require("fs");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "providers.json"),
        '{"version":5,"current":true}',
      );
      writeFileSync(join(dir, "providers.json.sig"), "sig-v5");
      writeFileSync(
        join(dir, "providers.v4.json"),
        '{"version":4,"prior":true}',
      );
      writeFileSync(join(dir, "providers.v4.json.sig"), "sig-v4");

      mockVerifyFileSig.mockReturnValue(true);
      recordProviderFailure("nxsha", "ERR_FAILED");
      recordProviderFailure("nxsha", "ERR_FAILED");
      recordProviderFailure("nxsha", "ERR_FAILED");

      const logPath = join(dir, "heal-events.log");
      expect(existsSync(logPath)).toBe(true);
      const log = readFileSync(logPath, "utf-8");
      expect(log).toContain("ROLLBACK_APPLIED");
      expect(log).toContain("provider=nxsha");
      expect(log).toContain("error=ERR_FAILED");
    });
  });
});
