package expo.modules.playerwebview

import com.google.gson.annotations.SerializedName

/**
 * Remote blocklist configuration schema (V5 — split config).
 *
 * V5 splits the single blocklist.json into TWO files that travel together:
 *   - providers.json (this schema) — app-specific logic uBO syntax can't express
 *   - filters.txt                — standard uBO/EasyList syntax (network + cosmetic)
 *   - providers.json.sig         — Ed25519 signature over providers.json bytes
 *
 * V5 changes from V3:
 *   - providers[] gains: allowServerRedirects, apiIntercepts, adblockDisabled
 *   - rules.alwaysBlock becomes a dedicated section (was part of rules)
 *   - rules.videoDetection gains trustTTLMs (sliding window, default 900000ms = 15 min)
 *   - navigationGuard universalBlockPaths is the single source of truth for
 *     path-level home-escape containment (bare "/" by default)
 *   - providerProfiles maps embed domain -> allowed host suffixes (Rule 5 parity)
 *   - signature / publicKey fields for Ed25519 OTA integrity
 *
 * Hosted as providers.json on GitHub (or R2 CDN). The app downloads it on every
 * launch and uses it for domain allow/block, navigation containment, session
 * trust TTL, and per-provider interception rules. Falls back to bundled defaults
 * if the download fails.
 *
 * Update flow: edit providers.json + filters.txt on GitHub → CI signs with
 * Ed25519 private key → publishes providers.json.sig + filters.txt → next app
 * launch pulls new config, verifies signature, applies if valid → no rebuild.
 */
data class BlocklistConfig(
    @SerializedName("version") val version: Int = 0,
    // V1/V2 compat fields (kept for backward compatibility during rollout)
    @SerializedName("allowedCdnHosts") val allowedCdnHosts: Set<String> = emptySet(),
    @SerializedName("blockedDomains") val blockedDomains: Set<String> = emptySet(),
    /**
     * V6: explicit URL (substring) blocklist — highest precedence, checked
     * BEFORE R2:cdn-allowlist. Lets us block a specific path on an otherwise
     * allowlisted CDN host (e.g. cdn.jsdelivr.net/npm/disable-devtool@latest)
     * which R2 would otherwise short-circuit the whole host before any
     * path-aware block could run. OTA-configurable (no rebuild needed to
     * change the entries).
     */
    @SerializedName("blockedUrls") val blockedUrls: List<String> = emptyList(),
    @SerializedName("providerProfiles") val providerProfiles: Map<String, Set<String>> = emptyMap(),
    @SerializedName("providerRootHosts") val providerRootHosts: Set<String> = emptySet(),
    // V3 fields
    @SerializedName("rules") val rules: RulesConfig? = null,
    @SerializedName("navigationGuard") val navigationGuard: NavigationGuardConfig? = null,
    // V5: per-provider config (single source of truth for app logic)
    @SerializedName("providers") val providers: List<ProviderConfig> = emptyList(),
    // V5: Ed25519 signature over the canonical JSON bytes (OTA integrity)
    @SerializedName("signature") val signature: String? = null,
    @SerializedName("publicKey") val publicKey: String? = null,
)

data class RulesConfig(
    @SerializedName("videoDetection") val videoDetection: VideoDetectionConfig? = null,
    @SerializedName("alwaysBlock") val alwaysBlock: AlwaysBlockConfig? = null,
)

data class VideoDetectionConfig(
    @SerializedName("extensions") val extensions: List<String> = emptyList(),
    @SerializedName("pathPatterns") val pathPatterns: List<String> = emptyList(),
    @SerializedName("enableSessionTrust") val enableSessionTrust: Boolean = true,
    /** V5: sliding trust TTL in ms (default 900000 = 15 min). */
    @SerializedName("trustTTLMs") val trustTTLMs: Long = 900_000,
)

data class AlwaysBlockConfig(
    @SerializedName("domains") val domains: List<String> = emptyList(),
    @SerializedName("pathPatterns") val pathPatterns: List<String> = emptyList(),
)

/**
 * Path-level navigation containment — blocks provider home-page escapes
 * ("Go Home" on the provider's own error UI → provider.com/). Single source
 * of truth = providers.json navigationGuard.universalBlockPaths (default: ["/"]).
 */
data class NavigationGuardConfig(
    @SerializedName("universalBlockPaths") val universalBlockPaths: List<String> = listOf("/"),
    @SerializedName("shallowDepthThreshold") val shallowDepthThreshold: Int = 1,
)

data class ProviderConfig(
    @SerializedName("id") val id: String,
    @SerializedName("embedDomains") val embedDomains: List<String> = emptyList(),
    @SerializedName("cdnDomains") val cdnDomains: List<String> = emptyList(),
    @SerializedName("enabled") val enabled: Boolean = true,
    /** If true, the native adblock engine and all blocking rules are skipped for this provider. */
    @SerializedName("adblockDisabled") val adblockDisabled: Boolean = false,
    /** Hosts the provider's video/API auth APIs run on (R3.5 API exemption). */
    @SerializedName("apiDomains") val apiDomains: List<String> = emptyList(),
    /**
     * Provider home/list paths that escape the player frame ("Go Home" on an
     * error UI → provider.com/). Additive deny-list — append new shapes as
     * discovered. Single source of truth = providers.json providers[].blockHomePaths.
     */
    @SerializedName("blockHomePaths") val blockHomePaths: List<String> = emptyList(),
    /** V5: allow the provider's own initial server redirect during the NavGuard
     *  bootstrap window (redirect-mesh upstreams: viduki.net, videasy.to). */
    @SerializedName("allowServerRedirects") val allowServerRedirects: Boolean = false,
    /** V5: API synthetic-interception rules (screenscape /api/ads/cycles). */
    @SerializedName("apiIntercepts") val apiIntercepts: List<ApiInterceptRule> = emptyList(),
    /** V5: CSS cosmetic rules applied via injectCosmetics. */
    @SerializedName("cosmeticRules") val cosmeticRules: List<String> = emptyList(),
    /**
     * V5: if false, skip injecting the consolidated guard bundle via the native
     * addDocumentStartJavaScript path (still injected by React Native's
     * injectedJavaScriptBeforeContentLoaded + the spray). Some providers (peachify)
     * hydrate fine only when the bundle runs at document_end, not document_start;
     * injecting at the very start corrupts React hydration (#418). Default true.
     */
    @SerializedName("docStartBundle") val docStartBundle: Boolean = true,
    /**
     * V6: if true, the provider is a React/Next.js (hydration-sensitive) app.
     * The heavy guard bundle is deferred to onPageFinished (post-hydration) and
     * only a minimal disable-devtool redirect blocker (no global native-patch,
     * no <style> injection, no innerHTML blank-block) runs at document_start.
     * This avoids React 18 hydration error #418 (peachify). Default false.
     */
    @SerializedName("reactSafe") val reactSafe: Boolean = false,
    /**
     * V6: if true, the provider inlines `theajack/disable-devtool`, whose
     * FuncToString detector is falsely tripped by the Android WebView native
     * console-serialization bridge. When true, the native Layer 2 disable-devtool
     * stub is served for script requests to the CDN URL (jsdelivr/unpkg/etc.) so
     * that `typeof window.disableDevtool !== 'undefined'` checks pass, while
     * the RN-side DEVTOOL_CONSOLE_MASK_SCRIPT defeats the type=4 detector at
     * document_start without touching Function.prototype.toString.
     * Default false. Native side mirrors this via providers.json
     * providers[].disableDevtoolPatch.
     */
    @SerializedName("disableDevtoolPatch") val disableDevtoolPatch: Boolean = false,
)

data class ApiInterceptRule(
    @SerializedName("match") val match: String,
    @SerializedName("methods") val methods: List<String> = emptyList(),
    @SerializedName("synthetic") val synthetic: SyntheticResponse? = null,
)

data class SyntheticResponse(
    @SerializedName("primary") val primary: Map<String, Any>? = null,
    @SerializedName("fallback") val fallback: Map<String, Any>? = null,
    @SerializedName("fallbackCondition") val fallbackCondition: String? = null,
)