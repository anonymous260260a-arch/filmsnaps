package expo.modules.playerwebview

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicReference

/**
 * Fetches and caches the remote blocklist configuration.
 *
 * Load order (priority high → low):
 *   1. Remote JSON from CONFIG_URL (fetched every 6h, cached to disk)
 *   2. Bundled assets/blocklist-default.json (shipped with APK)
 *   3. Hardcoded defaults in PlayerWebViewOverlayView companion object
 *
 * To change the config URL without rebuilding, update the JSON on GitHub.
 * The app pulls fresh config on every launch (background fetch).
 *
 * Environment variable fallback:
 *   Set BLOCKLIST_CONFIG_URL in gradle.properties or local.properties
 *   to override the default GitHub URL. Example:
 *     BLOCKLIST_CONFIG_URL=https://my-cdn.com/blocklist.json
 */
object BlocklistConfigLoader {

    private const val TAG = "BlocklistConfig"
    private const val CACHE_FILE_NAME = "blocklist-config.json"
    private const val META_FILE_NAME = "blocklist-config-meta.json"
    private const val CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000L // 6 hours
    private const val BUNDLED_DEFAULT = "blocklist-default.json"

    // Default URL — hosted on the web app. Override via BuildConfig.BLOCKLIST_CONFIG_URL.
    private const val DEFAULT_CONFIG_PATH = "/api/blocklist"

    private val _config = AtomicReference<BlocklistConfig?>(null)
    val config: BlocklistConfig get() = _config.get() ?: BlocklistConfig()

    /**
     * Flattened CDN host set from V2 providers[] and V1 allowedCdnHosts.
     * This is what PlayerWebViewOverlayView.effectiveAllowedCdnHosts reads.
     */
    val allCdnHosts: HashSet<String> get() {
        val cfg = _config.get() ?: return HashSet()
        val hosts = HashSet<String>()
        // V2: flatten provider CDN domains
        for (provider in cfg.providers) {
            hosts.addAll(provider.cdnDomains)
        }
        // V1: also include direct allowlist
        hosts.addAll(cfg.allowedCdnHosts)
        // Always include common CDN platforms
        hosts.addAll(COMMON_CDN_HOSTS)
        return hosts
    }

    // Common CDN platforms that should never be blocked
    private val COMMON_CDN_HOSTS = setOf(
        "akamai.net", "akamaiedge.net", "cloudfront.net",
        "fastly.net", "fastlylb.net",
        "image.tmdb.org", "api.themoviedb.org",
        "fonts.googleapis.com", "fonts.gstatic.com",
        "gstatic.com",
    )

    // ── ETag metadata helpers ───────────────────────────────────────
    // Persists ETag / Last-Modified headers from the last 200 response.
    // On the next fetch, these are sent as If-None-Match / If-Modified-Since.
    // A 304 response means no bytes downloaded; we just update the cache
    // timestamp so the next cold-start finds a "fresh" file.

    private data class FetchMeta(
        val etag: String = "",
        val lastModified: String = ""
    )

    private fun loadFetchMeta(context: Context): FetchMeta {
        try {
            val file = File(context.cacheDir, META_FILE_NAME)
            if (!file.exists()) return FetchMeta()
            val obj = JSONObject(file.readText())
            return FetchMeta(
                etag = obj.optString("etag", ""),
                lastModified = obj.optString("lastModified", "")
            )
        } catch (_: Exception) { return FetchMeta() }
    }

    private fun saveFetchMeta(context: Context, meta: FetchMeta) {
        try {
            val obj = JSONObject()
            if (meta.etag.isNotEmpty()) obj.put("etag", meta.etag)
            if (meta.lastModified.isNotEmpty()) obj.put("lastModified", meta.lastModified)
            File(context.cacheDir, META_FILE_NAME).writeText(obj.toString())
        } catch (_: Exception) {}
    }

    private var initialized = false

    /**
     * Resolve the config URL. Priority:
     *   1. BuildConfig.BLOCKLIST_CONFIG_URL (set via gradle.properties / env)
     *   2. WEB_URL + /api/blocklist (from Expo public env)
     *   3. Hardcoded fallback
     */
    private fun getConfigUrl(): String {
        // 1. Check BuildConfig override
        try {
            val buildUrl = Class.forName("expo.modules.playerwebview.BuildConfig")
                .getField("BLOCKLIST_CONFIG_URL")
                .get(null) as? String
            if (!buildUrl.isNullOrBlank()) return buildUrl
        } catch (_: Exception) {}

        // 2. Try to read EXPO_PUBLIC_WEB_URL from BuildConfig (set by Expo)
        try {
            val webUrl = Class.forName("com.filmSnaps.BuildConfig")
                .getField("EXPO_PUBLIC_WEB_URL")
                .get(null) as? String
            if (!webUrl.isNullOrBlank()) {
                return webUrl.trimEnd('/') + DEFAULT_CONFIG_PATH
            }
        } catch (_: Exception) {}

        // 3. Fallback to GitHub raw
        return "https://raw.githubusercontent.com/anonymous260260a-arch/filmsnaps/main/blocklist.json"
    }

    /**
     * Initialize the loader. Call once from warmupRenderer().
     * Load order: cache → bundled asset → remote fetch (background).
     */
    fun init(context: Context) {
        if (initialized) return
        initialized = true

        // 1. Load cached config (instant, no network)
        loadFromCache(context)

        // 2. Load bundled default as baseline (if no cache yet)
        if (_config.get() == null) {
            loadFromAssets(context)
        }

        // 3. Fetch fresh config in background (overrides everything)
        Thread({
            fetchAndCache(context)
        }, "blocklist-fetch").apply { isDaemon = true; start() }
    }

    /**
     * Force-refresh the config.
     */
    fun refresh(context: Context) {
        Thread({
            fetchAndCache(context)
        }, "blocklist-refresh").apply { isDaemon = true; start() }
    }

    private fun loadFromCache(context: Context) {
        try {
            val file = File(context.cacheDir, CACHE_FILE_NAME)
            if (!file.exists()) return

            val age = System.currentTimeMillis() - file.lastModified()
            if (age > CACHE_MAX_AGE_MS * 2) {
                file.delete()
                return
            }

            val json = file.readText()
            val parsed = parseConfig(json)
            _config.set(parsed)
            Log.d(TAG, "Loaded cached config v${parsed.version} " +
                "(${allCdnHosts.size} allowed, " +
                "${parsed.blockedDomains.size} blocked)")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to load cached config: ${e.message}")
        }
    }

    private fun loadFromAssets(context: Context) {
        try {
            val json = context.assets.open(BUNDLED_DEFAULT).bufferedReader().readText()
            val parsed = parseConfig(json)
            _config.set(parsed)
            Log.d(TAG, "Loaded bundled default config v${parsed.version}")
        } catch (e: Exception) {
            Log.w(TAG, "No bundled default config: ${e.message}")
        }
    }

    private fun fetchAndCache(context: Context) {
        try {
            val configUrl = getConfigUrl()
            val meta = loadFetchMeta(context)
            Log.d(TAG, "Fetching config from: $configUrl" +
                if (meta.etag.isNotEmpty()) " (etag: ${meta.etag})" else "")

            val url = URL(configUrl)
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 5000
            conn.readTimeout = 5000
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", "FilmSnaps-Android/1.0")

            // Conditional request — server returns 304 if unchanged
            if (meta.etag.isNotEmpty()) {
                conn.setRequestProperty("If-None-Match", meta.etag)
            }
            if (meta.lastModified.isNotEmpty()) {
                conn.setRequestProperty("If-Modified-Since", meta.lastModified)
            }

            val responseCode = conn.responseCode
            when (responseCode) {
                304 -> {
                    // Config unchanged — just refresh the cache timestamp
                    // so the next cold-start finds a "fresh" file.
                    val cachedFile = File(context.cacheDir, CACHE_FILE_NAME)
                    if (cachedFile.exists()) {
                        cachedFile.setLastModified(System.currentTimeMillis())
                    }
                    Log.d(TAG, "Config unchanged (304), cache timestamp refreshed")
                    conn.disconnect()
                    return
                }
                200 -> {
                    // Fresh config — parse and cache
                    val json = conn.inputStream.bufferedReader().readText()

                    // Extract ETag / Last-Modified from response headers
                    val responseEtag = conn.getHeaderField("ETag") ?: ""
                    val responseLastModified = conn.getHeaderField("Last-Modified") ?: ""
                    conn.disconnect()

                    val parsed = parseConfig(json)
                    _config.set(parsed)

                    // Cache JSON body to disk
                    File(context.cacheDir, CACHE_FILE_NAME).writeText(json)

                    // Cache ETag metadata alongside
                    if (responseEtag.isNotEmpty() || responseLastModified.isNotEmpty()) {
                        saveFetchMeta(context, FetchMeta(
                            etag = responseEtag,
                            lastModified = responseLastModified
                        ))
                    }

                    Log.d(TAG, "Fetched fresh config v${parsed.version} " +
                        "(${allCdnHosts.size} allowed, " +
                        "${parsed.blockedDomains.size} blocked)")
                }
                else -> {
                    Log.w(TAG, "Config fetch failed: HTTP $responseCode")
                    conn.disconnect()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Config fetch failed: ${e.message}")
        }
    }

    private fun parseConfig(json: String): BlocklistConfig {
        val obj = JSONObject(json)

        // V1 fields (backward compat)
        val allowed = parseStringSet(obj, "allowedCdnHosts")
        val blocked = parseStringSet(obj, "blockedDomains")
        val rootHosts = parseStringSet(obj, "providerRootHosts")

        val profiles = mutableMapOf<String, Set<String>>()
        val profilesObj = obj.optJSONObject("providerProfiles")
        if (profilesObj != null) {
            for (key in profilesObj.keys()) {
                profiles[key] = parseStringSet(profilesObj, key)
            }
        }

        // V2: parse providers array
        val providers = mutableListOf<ProviderConfig>()
        val providersArr = obj.optJSONArray("providers")
        if (providersArr != null) {
            for (i in 0 until providersArr.length()) {
                val pObj = providersArr.optJSONObject(i) ?: continue
                providers.add(ProviderConfig(
                    id = pObj.optString("id", ""),
                    embedDomains = parseStringList(pObj, "embedDomains"),
                    cdnDomains = parseStringList(pObj, "cdnDomains"),
                    enabled = pObj.optBoolean("enabled", true),
                    adblockDisabled = pObj.optBoolean("adblockDisabled", false),
                ))
            }
        }

        // V2: parse videoDetection rules
        val videoDetection = obj.optJSONObject("rules")?.optJSONObject("videoDetection")
        val vdConfig = if (videoDetection != null) {
            VideoDetectionConfig(
                extensions = parseStringList(videoDetection, "extensions"),
                pathPatterns = parseStringList(videoDetection, "pathPatterns"),
                enableSessionTrust = videoDetection.optBoolean("enableSessionTrust", true),
            )
        } else null

        return BlocklistConfig(
            version = obj.optInt("version", 0),
            allowedCdnHosts = allowed,
            blockedDomains = blocked,
            providerProfiles = profiles,
            providerRootHosts = rootHosts,
            videoDetection = vdConfig,
            providers = providers,
        )
    }

    private fun parseStringSet(obj: JSONObject, key: String): Set<String> {
        val arr = obj.optJSONArray(key) ?: return emptySet()
        val set = mutableSetOf<String>()
        for (i in 0 until arr.length()) {
            arr.optString(i)?.let { if (it.isNotEmpty()) set.add(it) }
        }
        return set
    }

    private fun parseStringList(obj: JSONObject, key: String): List<String> {
        val arr = obj.optJSONArray(key) ?: return emptyList()
        val list = mutableListOf<String>()
        for (i in 0 until arr.length()) {
            arr.optString(i)?.let { if (it.isNotEmpty()) list.add(it) }
        }
        return list
    }
}
