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
)

data class VideoDetectionConfig(
    val extensions: List<String> = emptyList(),
    val pathPatterns: List<String> = emptyList(),
    val enableSessionTrust: Boolean = true,
)

data class ProviderConfig(
    val id: String,
    val embedDomains: List<String> = emptyList(),
    val cdnDomains: List<String> = emptyList(),
    val enabled: Boolean = true,
    /** If true, the native adblock engine and all blocking rules are skipped for this provider. */
    val adblockDisabled: Boolean = false,
)
