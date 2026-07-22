/**
 * Blocklist config validator.
 *
 * Performs structural validation on blocklist.json:
 *  - Required fields present
 *  - No duplicate provider IDs
 *  - All provider domains are valid (non-empty, no protocol)
 *  - Rule patterns are valid regex
 *  - Version is 2
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

  if (!config || typeof config !== 'object') {
    errors.push('Config must be a non-null object');
    return { valid: false, errors, warnings };
  }

  const cfg = config as Record<string, unknown>;

  // ── version ──
  if (typeof cfg.version !== 'number') {
    errors.push('"version" must be a number');
  } else if (cfg.version < 2) {
    warnings.push(`"version" is ${cfg.version}; V2 schema expected`);
  }

  // ── allowedCdnHosts ──
  validateStringArray(cfg, 'allowedCdnHosts', errors, true);

  // ── blockedDomains ──
  validateStringArray(cfg, 'blockedDomains', errors, false);

  // ── providerRootHosts (optional V1) ──
  if (cfg.providerRootHosts !== undefined) {
    validateStringArray(cfg, 'providerRootHosts', errors, false);
  }

  // ── providerProfiles (optional V1) ──
  if (cfg.providerProfiles !== undefined) {
    if (typeof cfg.providerProfiles !== 'object' || cfg.providerProfiles === null) {
      errors.push('"providerProfiles" must be an object');
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

  return { valid: errors.length === 0, errors, warnings };
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
    if (typeof val[i] !== 'string' || val[i].trim() === '') {
      errors.push(`"${key}[${i}]" must be a non-empty string`);
    }
  }
}

function validateRules(
  rules: unknown,
  errors: string[],
  warnings: string[],
): void {
  if (typeof rules !== 'object' || rules === null) {
    errors.push('"rules" must be an object');
    return;
  }

  const r = rules as Record<string, unknown>;

  // ── videoDetection ──
  if (r.videoDetection !== undefined) {
    const vd = r.videoDetection;
    if (typeof vd !== 'object' || vd === null) {
      errors.push('"rules.videoDetection" must be an object');
    } else {
      const vdObj = vd as Record<string, unknown>;
      validateStringArray(vdObj, 'extensions', errors, false);
      validateStringArray(vdObj, 'pathPatterns', errors, false);

      // Validate path patterns are valid regex
      if (Array.isArray(vdObj.pathPatterns)) {
        for (let i = 0; i < vdObj.pathPatterns.length; i++) {
          try {
            new RegExp(vdObj.pathPatterns[i] as string);
          } catch {
            errors.push(`"rules.videoDetection.pathPatterns[${i}]" is not a valid regex`);
          }
        }
      }

      if (typeof vdObj.enableSessionTrust !== 'boolean') {
        errors.push('"rules.videoDetection.enableSessionTrust" must be a boolean');
      }
    }
  }

  // ── alwaysBlock ──
  if (r.alwaysBlock !== undefined) {
    const ab = r.alwaysBlock;
    if (typeof ab !== 'object' || ab === null) {
      errors.push('"rules.alwaysBlock" must be an object');
    } else {
      const abObj = ab as Record<string, unknown>;
      validateStringArray(abObj, 'domains', errors, false);
      validateStringArray(abObj, 'pathPatterns', errors, true);
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
    if (typeof p !== 'object' || p === null) {
      errors.push(`"providers[${i}]" must be an object`);
      continue;
    }

    const provider = p as Record<string, unknown>;

    // id
    if (typeof provider.id !== 'string' || provider.id.trim() === '') {
      errors.push(`"providers[${i}].id" must be a non-empty string`);
    } else {
      if (seenIds.has(provider.id)) {
        errors.push(`"providers[${i}].id" is a duplicate: "${provider.id}"`);
      }
      seenIds.add(provider.id);
    }

    // embedDomains
    validateStringArray(provider, 'embedDomains', errors, false);

    // cdnDomains
    validateStringArray(provider, 'cdnDomains', errors, true);

    // enabled
    if (typeof provider.enabled !== 'boolean') {
      errors.push(`"providers[${i}].enabled" must be a boolean`);
    }
  }
}
