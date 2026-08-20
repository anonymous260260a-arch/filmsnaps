/**
 * Blocklist config validator.
 *
 * Performs structural validation on providers.json:
 *  - Required fields present
 *  - No duplicate provider IDs
 *  - All provider domains are valid (non-empty, no protocol)
 *  - Rule patterns are valid regex
 *  - Version is 5 (warn below)
 *  - V5 semantics: host entries must be exact-host or suffix (never substring)
 *  - V5: allowServerRedirects boolean, trustTTLMs positive, navigationGuard,
 *        signature presence for OTA
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ── Public API ────────────────────────────────────────────────────────

export function validateConfig(config: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config || typeof config !== "object") {
    errors.push("Config must be a non-null object");
    return { valid: false, errors, warnings };
  }

  const cfg = config as Record<string, unknown>;

  // ── version ──
  if (typeof cfg.version !== "number") {
    errors.push('"version" must be a number');
  } else if (cfg.version < 5) {
    warnings.push(`"version" is ${cfg.version}; V5 schema expected`);
  }

  // ── allowedCdnHosts (V1 compat; exact/suffix) ──
  validateStringArray(cfg, "allowedCdnHosts", errors, true);
  validateHostArray(cfg.allowedCdnHosts, "allowedCdnHosts", errors);

  // ── blockedDomains (V1 compat; exact/suffix) ──
  validateStringArray(cfg, "blockedDomains", errors, false);
  validateHostArray(cfg.blockedDomains, "blockedDomains", errors);

  // ── blockedUrls (V6; substring URL blocklist — optional) ──
  validateStringArray(cfg, "blockedUrls", errors, true);

  // ── providerRootHosts (optional V1) ──
  if (cfg.providerRootHosts !== undefined) {
    validateStringArray(cfg, "providerRootHosts", errors, false);
    validateHostArray(cfg.providerRootHosts, "providerRootHosts", errors);
  }

  // ── providerProfiles (optional V1) ──
  if (cfg.providerProfiles !== undefined) {
    if (
      typeof cfg.providerProfiles !== "object" ||
      cfg.providerProfiles === null
    ) {
      errors.push('"providerProfiles" must be an object');
    } else {
      for (const [key, hosts] of Object.entries(cfg.providerProfiles)) {
        validateHostArray(hosts, `providerProfiles.${key}`, errors);
      }
    }
  }

  // ── rules (V2) ──
  if (cfg.rules !== undefined) {
    validateRules(cfg.rules, errors, warnings);
  }

  // ── providers (V2) ──
  if (cfg.providers !== undefined) {
    validateProviders(cfg.providers, errors, warnings);
  }

  // ── navigationGuard (V3) ──
  if (cfg.navigationGuard !== undefined) {
    const ng = cfg.navigationGuard;
    if (typeof ng !== "object" || ng === null) {
      errors.push('"navigationGuard" must be an object');
    } else {
      validateStringArray(
        ng as Record<string, unknown>,
        "universalBlockPaths",
        errors,
        true,
      );
    }
  }

  // ── signature (V5, OTA integrity) ──
  if (cfg.signature !== undefined) {
    if (typeof cfg.signature !== "string" || cfg.signature.length < 32) {
      errors.push('"signature" must be a non-empty base64 string (Ed25519)');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── V5 host-match semantics ───────────────────────────────────────────
// Exact host or suffix (`=== host` or `host.endsWith('.name')`). A bare
// token like "cloudfront.net" must NOT match "evil-cloudfront.net" — that
// substring vulnerability was flagged by the expert review. Host entries may
// also carry a leading scheme stripped by callers; validation only rejects
// entries that are clearly not host-shaped (contain '/', whitespace, or wildcards).

function validateHostArray(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (!Array.isArray(value)) return;
  for (let i = 0; i < value.length; i++) {
    const h = value[i];
    if (typeof h !== "string") continue;
    if (
      h.includes("/") ||
      h.includes(" ") ||
      h.includes("*") ||
      h === "" ||
      /^\./.test(h)
    ) {
      errors.push(`"${label}[${i}]" is not a valid exact/suffix host: "${h}"`);
    }
  }
}

// ── Internal validators ───────────────────────────────────────────────

function validateStringArray(
  obj: Record<string, unknown>,
  key: string,
  errors: string[],
  allowEmpty: boolean,
): void {
  const val = obj[key];
  if (!Array.isArray(val)) {
    if (val !== undefined) {
      errors.push(`"${key}" must be an array`);
    }
    return;
  }
  if (!allowEmpty && val.length === 0) {
    errors.push(`"${key}" must not be empty`);
  }
  for (let i = 0; i < val.length; i++) {
    if (typeof val[i] !== "string" || val[i].trim() === "") {
      errors.push(`"${key}[${i}]" must be a non-empty string`);
    }
  }
}

function validateRules(
  rules: unknown,
  errors: string[],
  warnings: string[],
): void {
  if (typeof rules !== "object" || rules === null) {
    errors.push('"rules" must be an object');
    return;
  }

  const r = rules as Record<string, unknown>;

  // ── videoDetection ──
  if (r.videoDetection !== undefined) {
    const vd = r.videoDetection;
    if (typeof vd !== "object" || vd === null) {
      errors.push('"rules.videoDetection" must be an object');
    } else {
      const vdObj = vd as Record<string, unknown>;
      validateStringArray(vdObj, "extensions", errors, false);
      validateStringArray(vdObj, "pathPatterns", errors, false);

      // Validate path patterns are valid regex
      if (Array.isArray(vdObj.pathPatterns)) {
        for (let i = 0; i < vdObj.pathPatterns.length; i++) {
          try {
            new RegExp(vdObj.pathPatterns[i] as string);
          } catch {
            errors.push(
              `"rules.videoDetection.pathPatterns[${i}]" is not a valid regex`,
            );
          }
        }
      }

      if (typeof vdObj.enableSessionTrust !== "boolean") {
        errors.push(
          '"rules.videoDetection.enableSessionTrust" must be a boolean',
        );
      }

      // V5: sliding trust TTL must be a positive number
      if (vdObj.trustTTLMs !== undefined) {
        if (typeof vdObj.trustTTLMs !== "number" || vdObj.trustTTLMs <= 0) {
          errors.push(
            '"rules.videoDetection.trustTTLMs" must be a positive number',
          );
        }
      }
    }
  }

  // ── alwaysBlock ──
  if (r.alwaysBlock !== undefined) {
    const ab = r.alwaysBlock;
    if (typeof ab !== "object" || ab === null) {
      errors.push('"rules.alwaysBlock" must be an object');
    } else {
      const abObj = ab as Record<string, unknown>;
      validateStringArray(abObj, "domains", errors, false);
      validateHostArray(abObj.domains, "rules.alwaysBlock.domains", errors);
      validateStringArray(abObj, "pathPatterns", errors, true);
    }
  }
}

function validateProviders(
  providers: unknown,
  errors: string[],
  warnings: string[],
): void {
  if (!Array.isArray(providers)) {
    errors.push('"providers" must be an array');
    return;
  }

  const seenIds = new Set<string>();

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    if (typeof p !== "object" || p === null) {
      errors.push(`"providers[${i}]" must be an object`);
      continue;
    }

    const provider = p as Record<string, unknown>;

    // id
    if (typeof provider.id !== "string" || provider.id.trim() === "") {
      errors.push(`"providers[${i}].id" must be a non-empty string`);
    } else {
      if (seenIds.has(provider.id)) {
        errors.push(`"providers[${i}].id" is a duplicate: "${provider.id}"`);
      }
      seenIds.add(provider.id);
    }

    // embedDomains (exact/suffix, no substring)
    validateStringArray(provider, "embedDomains", errors, false);
    validateHostArray(
      provider.embedDomains,
      `providers[${i}].embedDomains`,
      errors,
    );

    // cdnDomains (exact/suffix, no substring)
    validateStringArray(provider, "cdnDomains", errors, true);
    validateHostArray(
      provider.cdnDomains,
      `providers[${i}].cdnDomains`,
      errors,
    );

    // enabled
    if (typeof provider.enabled !== "boolean") {
      errors.push(`"providers[${i}].enabled" must be a boolean`);
    }

    // V5: allowServerRedirects boolean
    if (
      provider.allowServerRedirects !== undefined &&
      typeof provider.allowServerRedirects !== "boolean"
    ) {
      errors.push(`"providers[${i}].allowServerRedirects" must be a boolean`);
    }

    // V5: apiDomains (exact/suffix)
    if (provider.apiDomains !== undefined) {
      validateStringArray(provider, "apiDomains", errors, true);
      validateHostArray(
        provider.apiDomains,
        `providers[${i}].apiDomains`,
        errors,
      );
    }

    // blockHomePaths — path strings (start with '/'), non-empty
    if (provider.blockHomePaths !== undefined) {
      validateStringArray(provider, "blockHomePaths", errors, true);
      const bh = provider.blockHomePaths as unknown[];
      for (let j = 0; j < bh.length; j++) {
        const pathEntry = bh[j];
        if (typeof pathEntry === "string" && !pathEntry.startsWith("/")) {
          errors.push(
            `"providers[${i}].blockHomePaths[${j}]" must start with "/"`,
          );
        }
      }
    }

    // V5: apiIntercepts — array of { match, methods?, synthetic? }
    if (provider.apiIntercepts !== undefined) {
      if (!Array.isArray(provider.apiIntercepts)) {
        errors.push(`"providers[${i}].apiIntercepts" must be an array`);
      } else {
        for (let j = 0; j < provider.apiIntercepts.length; j++) {
          const rule = provider.apiIntercepts[j];
          if (typeof rule !== "object" || rule === null) {
            errors.push(
              `"providers[${i}].apiIntercepts[${j}]" must be an object`,
            );
          } else if (
            typeof (rule as Record<string, unknown>).match !== "string" ||
            ((rule as Record<string, unknown>).match as string) === ""
          ) {
            errors.push(
              `"providers[${i}].apiIntercepts[${j}].match" must be a non-empty string`,
            );
          }
        }
      }
    }

    // cosmeticRules — non-empty strings
    if (provider.cosmeticRules !== undefined) {
      validateStringArray(provider, "cosmeticRules", errors, true);
    }

    // adblockDisabled boolean
    if (
      provider.adblockDisabled !== undefined &&
      typeof provider.adblockDisabled !== "boolean"
    ) {
      errors.push(`"providers[${i}].adblockDisabled" must be a boolean`);
    }
  }
}
