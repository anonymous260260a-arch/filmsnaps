/**
 * AdblockEngine — lightweight native filter engine for shouldInterceptRequest.
 *
 * Loads pre-extracted filter patterns from @cliqz/adblocker (EasyList,
 * EasyPrivacy, AdGuard, uBO) and provides fast synchronous matching
 * for the WebView's resource loading pipeline.
 *
 * The patterns are exported by packages/filter-compiler/src/export-android.ts
 * and bundled as assets/adblock-patterns.json in the APK.
 *
 * Matching flow (first match wins):
 *   1. Domain allowlist / path exception → ALLOW (fast HashSet exit)
 *   2. Domain blocklist  → BLOCK (fast HashSet containing() — covers e.g.
 *      "doubleclick.net" matching "ads.doubleclick.net" via suffix check)
 *   3. Aho-Corasick unified → BLOCK or regex trigger (trie-based O(L)
 *      single pass for BOTH standard blocked substrings AND regex trigger
 *      hints — when a regex hint matches, only the associated regexes are
 *      evaluated, keeping the loop O(L) per request)
 *   4. No match → ALLOW (let existing heuristic rules decide)
 *
 * Thread safety: loaded once at class init, then read-only. OK for
 * concurrent shouldInterceptRequest calls from WebView's thread pool.
 */

package expo.modules.playerwebview

import android.content.Context
import android.util.Log
import org.json.JSONObject
import org.json.JSONTokener
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Aho-Corasick automaton for multi-pattern substring matching.
 *
 * Builds a trie + failure links from all blockedUrlSubstrings at init,
 * then matches ANY pattern in a single O(L) pass per URL — replacing the
 * previous O(N*L) linear contains() scan (N=50k patterns, L=URL length).
 *
 * Reference: https://en.wikipedia.org/wiki/Aho%E2%80%93Corasick_algorithm
 */
private class AhoCorasick {
  private data class Node(
    val children: MutableMap<Char, Int> = mutableMapOf(),
    var fail: Int = 0,
    var hasOutput: Boolean = false,
    /** The pattern string ending at this node (null for intermediate nodes).
     *  Used by findFirst() to return which pattern matched. */
    var output: String? = null
  )

  private val nodes = mutableListOf(Node())
  private var built = false

  /** Number of patterns added. */
  var patternCount: Int = 0
    private set

  /** Number of trie nodes (for diagnostics / init logging). */
  var nodeCount: Int = 0
    private set

  val isEmpty: Boolean get() = patternsAdded == 0
  val isNotEmpty: Boolean get() = !isEmpty
  private var patternsAdded: Int = 0

  /** Add all patterns and build the automaton. */
  fun buildFrom(patterns: List<String>) {
    nodes.clear()
    nodes.add(Node())
    built = false
    patternsAdded = patterns.size
    patternCount = patterns.size
    if (patterns.isEmpty()) return

    for (pattern in patterns) {
      if (pattern.isEmpty()) continue
      var node = 0
      for (ch in pattern) {
        node = nodes[node].children.getOrPut(ch) {
          nodes.add(Node())
          nodes.size - 1
        }
      }
      nodes[node].hasOutput = true
      nodes[node].output = pattern
    }
    build()
    nodeCount = nodes.size
  }

  private fun build() {
    val queue = ArrayDeque<Int>()
    for ((_, child) in nodes[0].children) {
      queue.addLast(child)
    }
    while (queue.isNotEmpty()) {
      val v = queue.removeFirst()
      for ((ch, u) in nodes[v].children) {
        var f = nodes[v].fail
        while (f != 0 && !nodes[f].children.containsKey(ch)) {
          f = nodes[f].fail
        }
        if (nodes[f].children.containsKey(ch) && nodes[f].children[ch] != u) {
          nodes[u].fail = nodes[f].children[ch]!!
        }
        // Propagate output flag AND pattern from failure node (dictionary
        // suffix link). This ensures findFirst() can return the pattern
        // from any node in the match chain, not just the exact terminal.
        if (nodes[nodes[u].fail].hasOutput) {
          nodes[u].hasOutput = true
          if (nodes[u].output == null) {
            nodes[u].output = nodes[nodes[u].fail].output
          }
        }
        queue.addLast(u)
      }
    }
    built = true
  }

  /**
   * Scans [text] in O(L) and returns the FIRST matched pattern string,
   * or null if no pattern matches.
   *
   * The returned string can be either a standard blocked URL substring
   * or a regex trigger hint — the caller decides based on context
   * (checking regexTriggers map membership).
   */
  fun findFirst(text: CharSequence): String? {
    if (!built) return null
    var node = 0
    for (ch in text) {
      while (node != 0 && !nodes[node].children.containsKey(ch)) {
        node = nodes[node].fail
      }
      node = nodes[node].children[ch] ?: 0
      if (nodes[node].hasOutput) {
        return nodes[node].output
      }
    }
    return null
  }
}

/**
 * Immutable snapshot of the engine's pattern state — swapped atomically
 * via AtomicReference for lock-free hot-reload.
 * Every field is a snapshot built at construction time; never mutated.
 */
private data class AdblockState(
  val blockedDomains: Set<String> = emptySet(),
  val allowedDomains: Set<String> = emptySet(),
  val allowedUrlPrefixes: List<String> = emptyList(),
  val urlMatcher: AhoCorasick = AhoCorasick(),
  val regexTriggers: Map<String, List<Regex>> = emptyMap(),
  val regexHintSet: Set<String> = emptySet(),
  val cosmeticSelectors: Map<String, List<String>> = emptyMap()
)

class AdblockEngine(context: Context) {

  companion object {
    private const val TAG = "AdblockEngine"
    private const val ASSET_PATH = "adblock-patterns.json"

    private val EMPTY_STRING_SET: Set<String> = emptySet()
    private val EMPTY_STRING_LIST: List<String> = emptyList()
    private val EMPTY_COSMETIC_MAP: Map<String, List<String>> = emptyMap()
    private val EMPTY_REGEX_MAP: Map<String, List<Regex>> = emptyMap()
  }

  // ── Thread-safe engine state (hot-swappable) ──────────────────────

  private val stateRef = AtomicReference<AdblockState>()
  private val totalMatchCalls = AtomicLong(0)
  private val totalBlocked = AtomicLong(0)
  private val totalAllowed = AtomicLong(0)

  // ── Init: load patterns from assets (cold-start baseline) ─────────

  init {
    val startTime = System.currentTimeMillis()
    var json: JSONObject? = null

    try {
      val inputStream = context.assets.open(ASSET_PATH)
      val reader = BufferedReader(InputStreamReader(inputStream, "UTF-8"))
      val sb = StringBuilder()
      var line: String? = reader.readLine()
      while (line != null) {
        sb.append(line)
        line = reader.readLine()
      }
      reader.close()
      json = JSONTokener(sb.toString()).nextValue() as? JSONObject
    } catch (e: Exception) {
      Log.w(TAG, "Failed to load patterns from assets: ${e.message}")
    }

    if (json != null) {
      val state = buildStateFromJson(json)
      stateRef.set(state)
      val elapsed = System.currentTimeMillis() - startTime
      Log.i(TAG, "Loaded: " +
        "${state.blockedDomains.size} blocked domains, " +
        "${state.urlMatcher.patternCount} AC patterns (${state.urlMatcher.nodeCount} nodes), " +
        "${state.allowedDomains.size} allowed domains, " +
        "${state.allowedUrlPrefixes.size} allowed URL prefixes, " +
        "${state.regexTriggers.size} regex triggers, " +
        "${state.cosmeticSelectors.size} cosmetic domains " +
        "($elapsed ms)")
    } else {
      stateRef.set(AdblockState())
    }
  }

  // ── State builder (shared by init AND hot-reload) ─────────────────

  /**
   * Parse a complete adblock-patterns.json into an AdblockState snapshot.
   * Safe to call off the main thread — the returned state is immutable
   * and ready for AtomicReference swap.
   */
  private fun buildStateFromJson(json: JSONObject): AdblockState {
    val network = json.getJSONObject("network")

    val blockedDomains = parseStringSet(network, "blockedDomains")
    val allowedDomains = parseStringSet(network, "allowedDomains")
    val urlSubstrings = parseStringList(network, "blockedUrlSubstrings")
    val allowedUrlPrefixes = parseStringList(network, "allowedUrlPrefixes")

    // Load regex triggers BEFORE building the AC automaton so we can
    // include their hint keys in the trie. This avoids a separate
    // O(N) contains() scan per request for regex hints.
    val regexTriggers = parseRegexMap(network, "regexTriggers")
    val regexHintSet = regexTriggers.keys.toSet()
    val regexHintCount = regexHintSet.size

    // Build Aho-Corasick automaton from URL substrings AND regex hint
    // keys combined into a SINGLE trie. This ensures BOTH pattern types
    // match in one O(L) pass per request — standard blocked substrings
    // are blocked immediately, while regex hints trigger only their
    // associated regex evaluation (not all 28k).
    val urlMatcher = AhoCorasick()
    if (urlSubstrings.isNotEmpty() || regexHintSet.isNotEmpty()) {
      val allPatterns = urlSubstrings + regexHintSet
      urlMatcher.buildFrom(allPatterns)
      Log.i(TAG, "Aho-Corasick built: ${allPatterns.size} patterns " +
        "(${urlSubstrings.size} URL + $regexHintCount regex hints), ${urlMatcher.nodeCount} nodes")
    }

    // Parse cosmetic selectors
    val cosmeticSelectors = try {
      val cosmetic = json.optJSONObject("cosmetic") ?: JSONObject()
      val map = mutableMapOf<String, List<String>>()
      for (key in cosmetic.keys()) {
        val arr = cosmetic.optJSONArray(key)
        if (arr != null && arr.length() > 0) {
          val selectors = mutableListOf<String>()
          for (i in 0 until arr.length()) {
            arr.optString(i)?.let { selectors.add(it) }
          }
          map[key] = selectors
        }
      }
      map
    } catch (e: Exception) {
      Log.w(TAG, "Error parsing cosmetic patterns: ${e.message}")
      emptyMap()
    }

    return AdblockState(
      blockedDomains = blockedDomains,
      allowedDomains = allowedDomains,
      allowedUrlPrefixes = allowedUrlPrefixes,
      urlMatcher = urlMatcher,
      regexTriggers = regexTriggers,
      regexHintSet = regexHintSet,
      cosmeticSelectors = cosmeticSelectors
    )
  }

  /**
   * Hot-reload the pattern trie at runtime — atomically swap the
   * engine state without pausing request processing.
   *
   * Called by [BlocklistConfigLoader] when a fresh adblock-patterns.json
   * is fetched from the remote config server. The new Aho-Corasick
   * automaton is fully built before the swap, so `shouldBlock()` callers
   * never see a half-built trie.
   *
   * @param jsonString Complete adblock-patterns.json as a JSON string
   * @return true if the patterns were parsed and swapped successfully
   */
  fun updatePatterns(jsonString: String): Boolean {
    return try {
      val json = JSONTokener(jsonString).nextValue() as? JSONObject
        ?: return false
      val newState = buildStateFromJson(json)
      stateRef.set(newState)
      Log.i(TAG, "Patterns hot-reloaded: " +
        "${newState.blockedDomains.size} blocked domains, " +
        "${newState.urlMatcher.patternCount} AC patterns (${newState.urlMatcher.nodeCount} nodes), " +
        "${newState.allowedDomains.size} allowed domains, " +
        "${newState.regexTriggers.size} regex triggers")
      true
    } catch (e: Exception) {
      Log.w(TAG, "Failed to hot-reload patterns: ${e.message}")
      false
    }
  }

  // ── Parsing helpers ───────────────────────────────────────────────

  private fun parseStringSet(json: JSONObject, key: String): Set<String> {
    val arr = json.optJSONArray(key) ?: return EMPTY_STRING_SET
    val set = mutableSetOf<String>()
    for (i in 0 until arr.length()) {
      arr.optString(i)?.let { set.add(it) }
    }
    return set
  }

  private fun parseStringList(json: JSONObject, key: String): List<String> {
    val arr = json.optJSONArray(key) ?: return EMPTY_STRING_LIST
    val list = mutableListOf<String>()
    for (i in 0 until arr.length()) {
      arr.optString(i)?.let { list.add(it) }
    }
    return list
  }

  private fun parseRegexMap(json: JSONObject, key: String): Map<String, List<Regex>> {
    val obj = json.optJSONObject(key) ?: return EMPTY_REGEX_MAP
    val map = mutableMapOf<String, List<Regex>>()
    for (substringKey in obj.keys()) {
      val arr = obj.optJSONArray(substringKey)
      if (arr != null && arr.length() > 0) {
        val regexes = mutableListOf<Regex>()
        for (i in 0 until arr.length()) {
          arr.optString(i)?.let { pattern ->
            try {
              regexes.add(Regex(pattern, RegexOption.IGNORE_CASE))
            } catch (e: Exception) {
              Log.w(TAG, "Invalid regex pattern: $pattern (${e.message})")
            }
          }
        }
        if (regexes.isNotEmpty()) {
          map[substringKey] = regexes
        }
      }
    }
    return map
  }

  // ── Matching ──────────────────────────────────────────────────────

  /**
   * Check whether a request should be blocked.
   *
   * @param url        Full request URL
   * @param host       Hostname extracted from the URL (lowercased already)
   * @return true if the request should be blocked
   */
  fun shouldBlock(url: String, host: String): Boolean {
    val state = stateRef.get() ?: return false
    totalMatchCalls.incrementAndGet()

    // ── Step 1: Domain allowlist → ALLOW (fast exit) ──
    if (state.allowedDomains.isNotEmpty() && checkDomainSuffix(host, state.allowedDomains)) {
      totalAllowed.incrementAndGet()
      return false
    }

    // ── Step 1b: Path-anchored exception rules → ALLOW ──
    // Check @@||domain.com/path^ exceptions before blocklist matching.
    // Without this, EasyList would block a provider's API endpoint at
    // /api/log (tracking pixel) that the provider needs for video auth.
    if (state.allowedUrlPrefixes.isNotEmpty()) {
      val urlLower = url.lowercase()
      for (prefix in state.allowedUrlPrefixes) {
        if (urlLower.startsWith(prefix)) {
          totalAllowed.incrementAndGet()
          Log.v(TAG, "ALLOW (path exception): $urlLower")
          return false
        }
      }
    }

    // ── Step 2: Domain blocklist → BLOCK ──
    if (state.blockedDomains.isNotEmpty() && checkDomainSuffix(host, state.blockedDomains)) {
      totalBlocked.incrementAndGet()
      Log.v(TAG, "BLOCK (domain): $url")
      return true
    }

    // ── Step 3: Aho-Corasick unified matching → BLOCK or Regex Trigger ──
    // A SINGLE O(L) pass matches BOTH standard blocked URL substrings AND
    // regex trigger hints in one traversal. When a regex hint matches, only
    // the associated regexes are evaluated (not all 28k). When a standard
    // URL substring matches, we block immediately.
    //
    // This avoids:
    //   - The old O(N*L) linear contains() scan for standard substrings
    //   - The old O(N) contains() scan for regex hints (10k iterations/request)
    // Both are now O(L) via the same Aho-Corasick trie pass.
    if (state.urlMatcher.isNotEmpty) {
      val matchedPattern = state.urlMatcher.findFirst(url.lowercase())
      if (matchedPattern != null) {
        // Check if the matched pattern is a regex trigger hint
        val regexes = state.regexTriggers[matchedPattern]
        if (regexes != null) {
          // Regex hint matched — evaluate only the associated regexes
          for (regex in regexes) {
            if (regex.containsMatchIn(url.lowercase())) {
              totalBlocked.incrementAndGet()
              Log.v(TAG, "BLOCK (regex): $url")
              return true
            }
          }
          // No regex matched — fall through (the hint matched but the
          // actual regex didn't; don't block based on hint alone)
        } else {
          // Standard blocked URL substring → BLOCK immediately
          totalBlocked.incrementAndGet()
          Log.v(TAG, "BLOCK (url/aho-corasick): $url")
          return true
        }
      }
    }

    return false // ALLOW — let existing heuristic rules decide
  }

  /**
   * Walk down domain suffix (sub.example.com → example.com → com)
   * checking if any suffix is in the set. Handles HashSet O(1) lookup
   * per level, worst-case O(depth) where depth ≤ 4 for most domains.
   */
  private fun checkDomainSuffix(host: String, set: Set<String>): Boolean {
    var h = host
    while (h.isNotEmpty()) {
      if (set.contains(h)) return true
      val dot = h.indexOf('.')
      if (dot < 0) break
      h = h.substring(dot + 1)
    }
    return false
  }

  /**
   * Get cosmetic CSS selectors for a given page hostname.
   * Used to inject provider-specific ad-hiding CSS.
   *
   * Only returns selectors for the EXACT domain and its parents
   * (e.g., "sub.nxsha.app" → checks "sub.nxsha.app", "nxsha.app", "app").
   * This avoids injecting all 17k selectors globally (which would cause
   * FOUC and DOM bloat per expert recommendation).
   */
  fun getCosmeticSelectors(pageHost: String): List<String> {
    val state = stateRef.get() ?: return EMPTY_STRING_LIST
    var h = pageHost
    while (h.isNotEmpty()) {
      state.cosmeticSelectors[h]?.let { return it }
      val dot = h.indexOf('.')
      if (dot < 0) break
      h = h.substring(dot + 1)
    }
    return EMPTY_STRING_LIST
  }

  /**
   * Compact-style stats for logging.
   */
  fun getStats(): String {
    return "matches=${totalMatchCalls.get()} blocked=${totalBlocked.get()} allowed=${totalAllowed.get()}"
  }
}
