package expo.modules.playerwebview

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.PublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.concurrent.atomic.AtomicReference

/**
 * FilmSnaps Mobile — OTA Config Loader (V5 split: providers.json + filters.txt)
 *
 * Loads and validates the v5 split config (providers.json) with Ed25519
 * signature verification. providers.json carries per-provider CDN domains,
 * embed domains, profiles, navigation guard, video detection. filters.txt
 * carries the uBO/EasyList engine rules. The two travel together and are
 * signed by the same Ed25519 key (providers.json.sig).
 *
 * Load order (priority high → low):
 *   1. Fresh OTA fetch (validated) — on launch + every 2h
 *   2. Ring-buffer cache on disk (last-known-good)
 *   3. Bundled default (assets/providers.json / blocklist-default.json)
 *
 * Config URL resolution:
 *   1. BuildConfig.BLOCKLIST_CONFIG_URL (set via gradle.properties / env)
 *   2. Hardcoded fallback to GitHub raw
 *
 * Ed25519 public key resolution:
 *   1. assets/filmsnaps-ed25519.pub (bundled via extraResources equivalent)
 *   2. Hardcoded fallback (development only)
 */
object BlocklistConfigLoader {

    private const val TAG = "BlocklistConfig"
    private const val PROVIDERS_FILE = "providers.json"
    private const val FILTERS_FILE = "filters.txt"
    private const val SIG_SUFFIX = ".sig"
    private const val PUBLIC_KEY_ASSET = "filmsnaps-ed25519.pub"
    private const val CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000L // 2 hours (matches desktop)
    private const val RING_DEPTH = 3
    private const val WATCHDOG_THRESHOLD = 3
    private const val HEAL_LOG_FILE = "heal-events.log"

    private val _config = AtomicReference<BlocklistConfig?>(null)
    val config: BlocklistConfig get() = _config.get() ?: BlocklistConfig()

    /**
     * Active OTA config version (the `version` field of whatever config is
     * currently loaded — ring-buffer cache, bundled default, or fresh OTA).
     * Exposed to RN (PlayerwebviewModule.getConfigVersion) so the JS guard
     * bundle memo can invalidate defensively if a future feature starts
     * injecting OTA-driven rules into the bundle. See VideoWebView.tsx useMemo.
     */
    fun getConfigVersion(): Int = config.version

    // ── Monotonic versioning (downgrade-attack defense) ──────────────
    // The active config version is persisted across launches so a MITM cannot
    // serve an OLD (validly signed but vulnerable) config. If a fetched config
    // has version <= the stored active version, it is REJECTED even when its
    // Ed25519 signature verifies. Versions must only ever increase.
    // NOTE: a regular private SharedPreferences is used for the version counter
    // (non-secret). For higher assurance, migrate to EncryptedSharedPreferences
    // (AndroidX Security) — same API, master-key encrypted on disk.
    private const val PREFS_NAME = "filmsnaps_secure"
    private const val KEY_ACTIVE_VERSION = "active_config_version"

    private fun getActiveVersion(context: Context): Int {
        return try {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getInt(KEY_ACTIVE_VERSION, 0)
        } catch (_: Exception) { 0 }
    }

    private fun persistActiveVersion(context: Context, version: Int) {
        try {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putInt(KEY_ACTIVE_VERSION, version).apply()
        } catch (_: Exception) {}
    }

    /** Context from init(), used for accessing application context. */
    private var appContext: Context? = null

    /** Failures per provider id, reset when a provider loads successfully. */
    private val providerFailures = mutableMapOf<String, Int>()

    /** Watchdog error codes that count toward a config rollback. */
    private val watchdogErrorCodes = setOf(
        "ERR_FAILED",
        "ERR_BLOCKED_BY_CLIENT",
        "ERR_ABORTED",
        "ERR_CONNECTION_RESET",
        "ERR_TIMED_OUT",
    )

    // ── ETag metadata helpers ───────────────────────────────────────
    private data class FetchMeta(
        val etag: String = "",
        val lastModified: String = ""
    )

    private fun loadFetchMeta(context: Context): FetchMeta {
        try {
            val file = File(context.cacheDir, "providers-meta.json")
            if (!file.exists()) return FetchMeta()
            val obj = JsonParser.parseString(file.readText()).asJsonObject
            return FetchMeta(
                etag = obj.get("etag")?.asString ?: "",
                lastModified = obj.get("lastModified")?.asString ?: ""
            )
        } catch (_: Exception) { return FetchMeta() }
    }

    private fun saveFetchMeta(context: Context, meta: FetchMeta) {
        try {
            val obj = JsonObject()
            if (meta.etag.isNotEmpty()) obj.addProperty("etag", meta.etag)
            if (meta.lastModified.isNotEmpty()) obj.addProperty("lastModified", meta.lastModified)
            File(context.cacheDir, "providers-meta.json").writeText(obj.toString())
        } catch (_: Exception) {}
    }

    private var initialized = false

    /** Resolve the OTA config URL. Priority: BuildConfig override → GitHub raw. */
    private fun getConfigUrl(): String {
        try {
            val buildUrl = Class.forName("expo.modules.playerwebview.BuildConfig")
                .getField("BLOCKLIST_CONFIG_URL")
                .get(null) as? String
            if (!buildUrl.isNullOrBlank()) return buildUrl
        } catch (_: Exception) {}
        return "https://raw.githubusercontent.com/anonymous260260a-arch/filmsnaps/main/providers.json"
    }

    /** Resolve the filters.txt URL (sibling to providers.json). */
    private fun getFiltersUrl(): String {
        val configUrl = getConfigUrl()
        return configUrl.replace("providers.json", "filters.txt")
    }

    /** Resolve the signature URL (sibling to providers.json). */
    private fun getSignatureUrl(): String {
        val configUrl = getConfigUrl()
        return "$configUrl$SIG_SUFFIX"
    }

    /**
     * Initialize the loader. Call once from warmupRenderer().
     * Load order: ring-buffer cache → bundled asset → remote fetch (background).
     */
    fun init(context: Context) {
        if (initialized) return
        initialized = true
        appContext = context.applicationContext

        // 1. Load ring-buffer cache (last-known-good validated config)
        loadFromRingBuffer(context)

        // 2. Load bundled default as baseline (if no cache yet)
        if (_config.get() == null) {
            loadFromAssets(context)
        }

        // 3. Fetch fresh config in background (overrides everything if valid)
        Thread({ fetchAndValidate(context) }, "blocklist-fetch").apply {
            isDaemon = true
            start()
        }
    }

    /** Force-refresh the config (manual trigger from settings). */
    fun refresh(context: Context) {
        Thread({ fetchAndValidate(context) }, "blocklist-refresh").apply {
            isDaemon = true
            start()
        }
    }

    /**
     * Record a provider frame failure. When a previously-working provider fails
     * WATCHDOG_THRESHOLD times in a row, revert to the prior validated config.
     *
     * Called from the onReceivedError handler in PlayerWebViewOverlayView.
     *
     * @param providerId the provider whose embed failed
     * @param errorCode WebView error code (converted to string, e.g. "ERR_FAILED")
     * @returns true when a rollback was performed
     */
    fun recordProviderFailure(providerId: String, errorCode: String): Boolean {
        if (!watchdogErrorCodes.contains(errorCode)) return false

        val count = providerFailures.getOrDefault(providerId, 0) + 1
        providerFailures[providerId] = count

        if (count >= WATCHDOG_THRESHOLD) {
            providerFailures[providerId] = 0
            logHealEvent(
                provider = providerId,
                errorCode = errorCode,
                action = "WATCHDOG_REVERT",
                detail = "reverting after $count consecutive failures"
            )
            return rollbackConfig(appContext!!)
        }
        return false
    }

    /** Reset the failure counter when a provider loads successfully. */
    fun recordProviderSuccess(providerId: String) {
        providerFailures.remove(providerId)
    }

    // ── Ring-buffer rotation ────────────────────────────────────────

    private fun rotateIntoRing(jsonText: String, filtersText: String, sigB64: String, context: Context) {
        try {
            val dir = otaDir(context)
            dir.mkdirs()
            val head = File(dir, PROVIDERS_FILE)

            // Shift: v2 → v3 (drop old v3), head → v2, write new head
            if (RING_DEPTH >= 3) {
                val v3 = File(dir, "providers.v2.json")
                val v2 = File(dir, "providers.v1.json")
                if (v2.exists()) {
                    v3.delete()
                    copyFile(v2, v3)
                    copyFile(File(v2.absolutePath + SIG_SUFFIX), File(v3.absolutePath + SIG_SUFFIX))
                }
            }
            if (RING_DEPTH >= 2) {
                val v2 = File(dir, "providers.v1.json")
                if (head.exists()) {
                    v2.delete()
                    copyFile(head, v2)
                    copyFile(File(head.absolutePath + SIG_SUFFIX), File(v2.absolutePath + SIG_SUFFIX))
                }
            }

            head.writeText(jsonText)
            File(head.absolutePath + SIG_SUFFIX).writeText(sigB64)
            if (filtersText.isNotEmpty()) File(dir, FILTERS_FILE).writeText(filtersText)
        } catch (e: Exception) {
            logHealEvent(action = "RING_ROTATE_FAILED", detail = e.message ?: "unknown")
        }
    }

    // ── Loading from various sources ────────────────────────────────

    private fun loadFromRingBuffer(context: Context) {
        val dir = otaDir(context)
        val head = File(dir, PROVIDERS_FILE)
        if (!head.exists()) return

        // The active OTA config must verify; if not, ignore it (bundled default wins)
        if (!verifyConfigFileSignature(head)) {
            logHealEvent(
                action = "OTA_ACTIVE_REJECTED",
                config = head.absolutePath,
                detail = "active OTA config signature invalid — using bundled default"
            )
            return
        }
        loadConfigFromFile(head)
        logHealEvent(action = "OTA_ACTIVATED", config = head.absolutePath)
    }

    private fun loadFromAssets(context: Context) {
        try {
            // Try providers.json first (v5), fallback to blocklist-default.json (v3)
            var json: String
            var version: Int
            try {
                json = context.assets.open(PROVIDERS_FILE).bufferedReader().readText()
                version = JsonParser.parseString(json).asJsonObject.get("version")?.asInt ?: 0
            } catch (_: Exception) {
                json = context.assets.open("blocklist-default.json").bufferedReader().readText()
                version = JsonParser.parseString(json).asJsonObject.get("version")?.asInt ?: 0
            }
            val parsed = parseConfig(json)
            _config.set(parsed)
            persistActiveVersion(context, version)
            Log.d(TAG, "Loaded bundled default config v$version")
            logConfigSummary("bundled", parsed)
        } catch (e: Exception) {
            Log.w(TAG, "No bundled default config: ${e.message}")
        }
    }

    private fun loadConfigFromFile(file: File) {
        try {
            val json = file.readText()
            val parsed = parseConfig(json)
            _config.set(parsed)
            appContext?.let { persistActiveVersion(it, parsed.version) }
            Log.d(TAG, "Loaded config from ${file.name} v${parsed.version} " +
                "(${allCdnHosts.size} allowed, ${parsed.blockedDomains.size} blocked)")
            logConfigSummary(file.name, parsed)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to load config from ${file.name}: ${e.message}")
        }
    }

    // ── Remote fetch + validation ───────────────────────────────────

    private fun fetchAndValidate(context: Context) {
        try {
            val configUrl = getConfigUrl()
            val filtersUrl = getFiltersUrl()
            val sigUrl = getSignatureUrl()
            val meta = loadFetchMeta(context)

            Log.d(TAG, "Fetching config from: $configUrl" +
                if (meta.etag.isNotEmpty()) " (etag: ${meta.etag})" else "")

            val providersText = fetchText(configUrl, meta) ?: return
            val sigText = fetchText(sigUrl, FetchMeta()) ?: run {
                logHealEvent(action = "OTA_FETCH_FAILED", detail = "missing signature")
                ""
            }
            val filtersText = fetchText(filtersUrl, FetchMeta()) ?: ""

            // Verify Ed25519 signature over canonical JSON bytes
            val jsonBytes = providersText.toByteArray(StandardCharsets.UTF_8)
            if (!verifyConfigSignature(jsonBytes, sigText)) {
                logHealEvent(
                    action = "OTA_SIGNATURE_REJECTED",
                    detail = "fetched config signature did not verify — keeping current"
                )
                return
            }

            // Structural validation (reject malformed or downgrade configs)
            val parsed: BlocklistConfig
            try {
                parsed = parseConfig(providersText)
                if (parsed.version < 5) {
                    logHealEvent(action = "OTA_STRUCTURE_REJECTED", detail = "version=${parsed.version}")
                    return
                }
            } catch (e: Exception) {
                logHealEvent(action = "OTA_PARSE_FAILED", detail = e.message ?: "unknown")
                return
            }

            // Monotonic versioning — REJECT downgrade / replay attacks.
            // A MITM can serve an OLD config that still has a valid Ed25519
            // signature (they cannot forge the signature, but they CAN replay a
            // previously-valid v4/v5 config that lacked the latest security
            // fixes). If the fetched version is not strictly greater than the
            // active version, reject it even though the signature verifies.
            val currentVersion = getActiveVersion(context)
            if (parsed.version <= currentVersion) {
                logHealEvent(
                    action = "OTA_DOWNGRADE_REJECTED",
                    detail = "fetched v${parsed.version} <= active v$currentVersion — possible downgrade/replay attack"
                )
                return
            }

            // All checks passed — rotate into ring buffer + reload
            rotateIntoRing(providersText, filtersText, sigText.trim(), context)
            _config.set(parsed) // Hot-swap immediately
            persistActiveVersion(context, parsed.version)
            logHealEvent(
                action = "OTA_APPLIED",
                detail = "v${parsed.version}"
            )
            logConfigSummary("remote", parsed)
        } catch (e: Exception) {
            logHealEvent(action = "OTA_FAILED", detail = e.message ?: "unknown")
        }
    }

    private fun fetchText(urlString: String, meta: FetchMeta): String? {
        try {
            val url = URL(urlString)
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 10000
            conn.readTimeout = 10000
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", "FilmSnaps-Android/1.0")

            if (meta.etag.isNotEmpty()) conn.setRequestProperty("If-None-Match", meta.etag)
            if (meta.lastModified.isNotEmpty()) conn.setRequestProperty("If-Modified-Since", meta.lastModified)

            when (conn.responseCode) {
                304 -> {
                    // Config unchanged — refresh cache timestamp
                    val cachedFile = File(otaDir(appContext!!), PROVIDERS_FILE)
                    if (cachedFile.exists()) cachedFile.setLastModified(System.currentTimeMillis())
                    Log.d(TAG, "Config unchanged (304), cache timestamp refreshed")
                    conn.disconnect()
                    return null
                }
                200 -> {
                    val text = conn.inputStream.bufferedReader().readText()
                    val etag = conn.getHeaderField("ETag") ?: ""
                    val lastMod = conn.getHeaderField("Last-Modified") ?: ""
                    conn.disconnect()
                    if (etag.isNotEmpty() || lastMod.isNotEmpty()) {
                        saveFetchMeta(appContext!!, FetchMeta(etag = etag, lastModified = lastMod))
                    }
                    return text
                }
                else -> {
                    Log.w(TAG, "Fetch failed: HTTP ${conn.responseCode} for $urlString")
                    conn.disconnect()
                    return null
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Fetch failed for $urlString: ${e.message}")
            return null
        }
    }

    // ── Ed25519 signature verification ──────────────────────────────

    /** Load the Ed25519 public key from assets. */
    private fun loadPublicKey(context: Context): PublicKey? {
        return try {
            val inputStream = context.assets.open(PUBLIC_KEY_ASSET)
            val bytes = inputStream.readBytes()
            inputStream.close()
            val spec = X509EncodedKeySpec(bytes)
            val kf = KeyFactory.getInstance("Ed25519")
            kf.generatePublic(spec)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to load Ed25519 public key from assets: ${e.message}")
            null
        }
    }

    /** Verify Ed25519 signature over canonical JSON bytes. */
    fun verifyConfigSignature(jsonBytes: ByteArray, signatureB64: String): Boolean {
        val context = appContext ?: return false
        val publicKey = loadPublicKey(context) ?: return false
        try {
            val sigBytes = android.util.Base64.decode(signatureB64, android.util.Base64.DEFAULT)
            val signature = java.security.Signature.getInstance("Ed25519")
            signature.initVerify(publicKey)
            signature.update(jsonBytes)
            return signature.verify(sigBytes)
        } catch (e: Exception) {
            Log.w(TAG, "Signature verification failed: ${e.message}")
            return false
        }
    }

    /** Verify a providers.json file's signature against its .sig sibling. */
    fun verifyConfigFileSignature(jsonFile: File): Boolean {
        val sigFile = File(jsonFile.absolutePath + SIG_SUFFIX)
        if (!sigFile.exists()) return false
        try {
            val jsonBytes = jsonFile.readBytes()
            val sigB64 = sigFile.readText().trim()
            return verifyConfigSignature(jsonBytes, sigB64)
        } catch (e: Exception) {
            return false
        }
    }

    // ── Ring-buffer rollback ────────────────────────────────────────

    /** Revert to the prior validated ring-buffer entry. Returns true on rollback. */
    fun rollbackConfig(context: Context): Boolean {
        val dir = otaDir(context)
        val head = File(dir, PROVIDERS_FILE)

        // Prefer the newest prior config that still verifies
        for (i in RING_DEPTH - 1 downTo 1) {
            val candidate = File(dir, "providers.v$i.json")
            if (!candidate.exists()) continue
            if (!verifyConfigFileSignature(candidate)) {
                logHealEvent(
                    action = "ROLLBACK_SKIP",
                    config = candidate.absolutePath,
                    detail = "prior config signature invalid — skipping"
                )
                continue
            }
            try {
                copyFile(candidate, head)
                val sigPath = File(candidate.absolutePath + SIG_SUFFIX)
                if (sigPath.exists()) copyFile(sigPath, File(head.absolutePath + SIG_SUFFIX))
                logHealEvent(
                    action = "ROLLBACK_APPLIED",
                    config = candidate.absolutePath,
                    detail = "reverted to prior validated config"
                )
                return true
            } catch (e: Exception) {
                logHealEvent(
                    action = "ROLLBACK_FAILED",
                    config = candidate.absolutePath,
                    detail = e.message ?: "unknown"
                )
            }
        }
        logHealEvent(action = "ROLLBACK_NONE", detail = "no prior validated config on disk")
        return false
    }

    // ── Config parsing ──────────────────────────────────────────────

    private fun parseConfig(json: String): BlocklistConfig {
        val gson = Gson()
        return gson.fromJson(json, BlocklistConfig::class.java)
    }

    // ── Flattened CDN host set (read by PlayerWebViewOverlayView) ────

    /** Explicit URL (substring) blocklist — highest precedence interception. */
    val allBlockedUrls: List<String> get() {
        return _config.get()?.blockedUrls ?: emptyList()
    }

    /** Flattened CDN host set from providers[] cdnDomains + allowedCdnHosts. */
    val allCdnHosts: Set<String> get() {
        val cfg = _config.get() ?: return emptySet()
        val hosts = mutableSetOf<String>()
        for (provider in cfg.providers) {
            hosts.addAll(provider.cdnDomains)
        }
        hosts.addAll(cfg.allowedCdnHosts)
        // Common CDN platforms that should never be blocked
        hosts.addAll(setOf(
            "akamai.net", "akamaiedge.net", "cloudfront.net",
            "fastly.net", "fastlylb.net",
            "image.tmdb.org", "api.themoviedb.org",
            "fonts.googleapis.com", "fonts.gstatic.com",
            "gstatic.com",
        ))
        return hosts
    }

    // ── Logging / diagnostics ───────────────────────────────────────

    /** Emits fields the home-escape guard + cosmetic prepend read. */
    private fun logConfigSummary(source: String, cfg: BlocklistConfig) {
        val universal = cfg.navigationGuard?.universalBlockPaths ?: listOf("/")
        val enabledProviders = cfg.providers.filter { it.enabled }
        val withHomePaths = enabledProviders.filter { it.blockHomePaths.isNotEmpty() }
        val withCosmetic = enabledProviders.filter { it.cosmeticRules.isNotEmpty() }
        val withApiIntercepts = enabledProviders.filter { it.apiIntercepts.isNotEmpty() }
        val withRedirects = enabledProviders.filter { it.allowServerRedirects }
        Log.i(TAG, "[CONFIG] source=$source version=${cfg.version} " +
            "universal=$universal " +
            "providers=${enabledProviders.size} " +
            "(homePaths=${withHomePaths.size}, cosmetic=${withCosmetic.size}, " +
            "apiIntercepts=${withApiIntercepts.size}, allowRedirects=${withRedirects.size}) " +
            "ids=${enabledProviders.joinToString(",") { it.id }}")
    }

    private fun logHealEvent(
        provider: String? = null,
        errorCode: String? = null,
        action: String,
        config: String? = null,
        detail: String? = null
    ) {
        try {
            val dir = otaDir(appContext!!)
            dir.mkdirs()
            val ts = java.time.Instant.now().toString()
            val parts = mutableListOf(ts, action)
            provider?.let { parts.add("provider=$it") }
            errorCode?.let { parts.add("error=$it") }
            config?.let { parts.add("config=$it") }
            detail?.let { parts.add("detail=$it") }
            File(dir, HEAL_LOG_FILE).appendText(parts.joinToString(" | ") + "\n")
            Log.i(TAG, "[HEAL] ${parts.joinToString(" | ")}")
        } catch (_: Exception) {}
    }

    // ── Path helpers ────────────────────────────────────────────────

    private fun otaDir(context: Context): File {
        return File(context.filesDir.parentFile, "ota-config")
    }

    private fun copyFile(src: File, dest: File) {
        dest.writeBytes(src.readBytes())
    }
}