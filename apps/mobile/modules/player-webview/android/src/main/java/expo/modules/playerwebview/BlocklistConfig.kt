package expo.modules.playerwebview

/**
 * Remote blocklist configuration schema (V2).
 *
 * V2 adds:
 *   - rules.videoDetection — regex patterns and extensions for R0 video detection
 *   - providers[] — per-provider CDN domains that flatten into allCdnHosts
 *   - V1 fields (allowedCdnHosts, blockedDomains, etc.) are still supported
 *     for backward compatibility.
 *
 * Hosted as a JSON file on GitHub. The app downloads it on every launch
 * and uses it for domain allow/block decisions in shouldInterceptRequest.
 * Falls back to bundled defaults if the download fails.
 *
 * Update flow: edit JSON on GitHub → next app launch pulls new config → no rebuild.
 */
data class BlocklistConfig(
    val version: Int = 0,
    // V1 fields (backward compat)
    val allowedCdnHosts: Set<String> = emptySet(),
    val blockedDomains: Set<String> = emptySet(),
    val providerProfiles: Map<String, Set<String>> = emptyMap(),
    val providerRootHosts: Set<String> = emptySet(),
    // V2 fields
    val videoDetection: VideoDetectionConfig? = null,
    val providers: List<ProviderConfig> = emptyList(),
    // V3 fields
    val navigationGuard: NavigationGuardConfig? = null,
)

data class VideoDetectionConfig(
    val extensions: List<String> = emptyList(),
    val pathPatterns: List<String> = emptyList(),
    val enableSessionTrust: Boolean = true,
)

/**
 * Path-level navigation containment — blocks provider home-page escapes
 * ("Go Home" on the provider's own error UI → provider.com/). Single source
 * of truth = blocklist.json navigationGuard.
 */
data class NavigationGuardConfig(
    val universalBlockPaths: List<String> = emptyList(),
    val shallowDepthThreshold: Int = 1,
)

data class ProviderConfig(
    val id: String,
    val embedDomains: List<String> = emptyList(),
    val cdnDomains: List<String> = emptyList(),
    val enabled: Boolean = true,
    /** If true, the native adblock engine and all blocking rules are skipped for this provider. */
    val adblockDisabled: Boolean = false,
    /**
     * Per-provider static cosmetic CSS rules (e.g. screenscape's "Ads window
     * ends" badge, download banner, footer buttons). Single source of truth =
     * blocklist.json providers[].cosmeticRules. Prependable as a static
     * <style> at document-start so always-present elements are hidden before
     * React paints them — declarative CSS re-applies on any re-render.
     */
    val cosmeticRules: List<String> = emptyList(),
    /**
     * Per-provider home/list paths that escape the player frame (the provider
     * error-UI "Go Home" → provider.com/ escape). Additive deny-list — append
     * new shapes as discovered. Single source of truth =
     * blocklist.json providers[].blockHomePaths.
     */
    val blockHomePaths: List<String> = emptyList(),
)
