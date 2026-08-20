/**
 * AdblockEngine — lightweight native filter engine for shouldInterceptRequest.
 *
 * Loads pre-extracted filter patterns from @cliqz/adblocker (EasyList,
 * EasyPrivacy, AdGuard, uBO) and provides fast synchronous matching
 * for the WebView's resource loading pipeline.
 *
 * Two serialized forms are consumed (see packages/filter-compiler):
 *   - adblock-patterns.json   : human-readable JSON (fallback + hot-reload)
 *   - adblock-trie.bin         : flat little-endian binary (cold-start fast path,
 *                                Expert Fix 4). The engine tries the binary first
 *                                and falls back to JSON on any signature/version/
 *                                parse anomaly, so a corrupt or missing .bin can
 *                                never break ad blocking.
 *
 * Matching flow (first match wins):
 *   1. Domain allowlist / path exception → ALLOW (fast exit)
 *   2. Domain blocklist  → BLOCK (suffix check over sorted string table)
 *   3. Aho-Corasick unified → BLOCK or regex trigger (O(L) single pass)
 *   4. No match → ALLOW (let existing heuristic rules decide)
 *
 * Thread safety: loaded once at class init, then read-only. OK for
 * concurrent shouldInterceptRequest calls from WebView's thread pool.
 */

package expo.modules.playerwebview

import android.content.Context
import android.util.Log
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.io.IOException
import java.util.zip.CRC32
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
private class AhoCorasick : UrlMatcher {
  private class Node(
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
  override var patternCount: Int = 0
    private set

  /** Number of trie nodes (for diagnostics / init logging). */
  override var nodeCount: Int = 0
    private set

  override val isNotEmpty: Boolean get() = patternCount > 0

  /** Add all patterns and build the automaton. */
  fun buildFrom(patterns: List<String>) {
    nodes.clear()
    nodes.add(Node())
    built = false
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
   */
  override fun findFirst(text: String): String? {
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
 * Binary-backed Aho-Corasick matcher (Expert Fix 4).
 *
 * Holds the compiled goto/fail/output arrays as primitive IntArrays (no
 * Node objects) and resolves the matched pattern index to its string via
 * [acPatterns]. Loaded from adblock-trie.bin by [loadBinaryTrie]; the
 * matching semantics are identical to [AhoCorasick].
 */
private class BinaryAhoCorasick(
  private val failArr: IntArray,
  private val outArr: IntArray,
  private val childStart: IntArray,
  private val childCount: IntArray,
  private val childChars: IntArray,
  private val childNodes: IntArray,
  private val acPatterns: Array<String>,
) : UrlMatcher {
  override val isNotEmpty: Boolean get() = acPatterns.isNotEmpty()
  override val patternCount: Int get() = acPatterns.size
  override val nodeCount: Int get() = failArr.size

  /** Binary search for char [c] among node [node]'s (sorted) children. */
  private fun findChild(node: Int, c: Int): Int {
    var lo = childStart[node]
    var hi = childStart[node] + childCount[node] - 1
    while (lo <= hi) {
      val mid = (lo + hi) ushr 1
      val mc = childChars[mid]
      when {
        mc < c -> lo = mid + 1
        mc > c -> hi = mid - 1
        else -> return childNodes[mid]
      }
    }
    return -1
  }

  override fun findFirst(text: String): String? {
    var node = 0
    for (i in text.indices) {
      val c = text[i].code
      while (node != 0) {
        if (findChild(node, c) != -1) break
        node = failArr[node]
      }
      val child = findChild(node, c)
      node = if (child == -1) 0 else child
      val o = outArr[node]
      if (o >= 0) return acPatterns[o]
    }
    return null
  }
}

/** Common matcher surface implemented by both [AhoCorasick] and [BinaryAhoCorasick]. */
private interface UrlMatcher {
  val isNotEmpty: Boolean
  val patternCount: Int
  val nodeCount: Int
  fun findFirst(text: String): String?
}

/**
 * Suffix domain-set abstraction. Implemented by a JSON-backed HashSet
 * ([JsonDomainSet]) and a binary-backed sorted string table
 * ([BinarySuffixSet]) so [shouldBlock] is source-agnostic.
 */
private interface DomainSet {
  val size: Int
  fun containsSuffix(host: String): Boolean
}

/**
 * Exact/suffix domain match over a [Set] — the JSON-backed counterpart of
 * [BinarySuffixSet]. Returns true if [host] equals or is a whole-label
 * subdomain-suffix of any entry (e.g. "sub.example.com" matches "example.com").
 *
 * Substring matching is deliberately avoided: the walk only ever tests
 * whole-label suffix boundaries (`host`, then `host` minus its leading label,
 * ...), so "evil.cloudfront.net" can never match "cloudfront.net" through a
 * stray inner dot. The host is already lower-cased by the caller (it is matched
 * against `url.lowercase()`), keeping behavior identical to the binary path.
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

private class JsonDomainSet(private val set: Set<String>) : DomainSet {
  override val size: Int get() = set.size
  override fun containsSuffix(host: String): Boolean = checkDomainSuffix(host, set)
}

/**
 * Sorted string table (built from adblock-trie.bin) over which domain-suffix
 * matching does a binary search — avoiding allocation of ~102k String objects
 * from JSON. Strings live in [blob]; only matching candidates are materialized.
 */
private class BinarySuffixSet(
  private val blob: ByteArray,
  private val off: IntArray,
  private val len: IntArray,
) : DomainSet {
  override val size: Int get() = off.size

  private fun strAt(idx: Int): String = blob.decodeToString(off[idx], off[idx] + len[idx])

  private fun cmp(target: String, idx: Int): Int {
    val t = strAt(idx)
    return target.compareTo(t)
  }

  override fun containsSuffix(host: String): Boolean {
    var h = host
    while (h.isNotEmpty()) {
      // Binary search over the sorted table for an exact suffix match.
      var lo = 0
      var hi = off.size - 1
      while (lo <= hi) {
        val mid = (lo + hi) ushr 1
        val c = cmp(h, mid)
        when {
          c < 0 -> hi = mid - 1
          c > 0 -> lo = mid + 1
          else -> return true
        }
      }
      val dot = h.indexOf('.')
      if (dot < 0) break
      h = h.substring(dot + 1)
    }
    return false
  }
}

/**
 * Immutable snapshot of the engine's pattern state — swapped atomically
 * via AtomicReference for lock-free hot-reload.
 * Every field is a snapshot built at construction time; never mutated.
 */
private data class AdblockState(
  val blockedDomains: DomainSet = object : DomainSet {
    override val size = 0
    override fun containsSuffix(host: String) = false
  },
  val allowedDomains: DomainSet = object : DomainSet {
    override val size = 0
    override fun containsSuffix(host: String) = false
  },
  val allowedUrlPrefixes: List<String> = emptyList(),
  val urlMatcher: UrlMatcher = AhoCorasick(),
  val regexTriggers: Map<String, List<Regex>> = emptyMap(),
  val cosmeticSelectors: Map<String, List<String>> = emptyMap()
)

class AdblockEngine(context: Context) {

  companion object {
    private const val TAG = "AdblockEngine"
    private const val JSON_PATH = "adblock-patterns.json"
    private const val BIN_PATH = "adblock-trie.bin"
    private const val BIN_MAGIC = "FSAB"
    private const val BIN_FORMAT = 1

    private val EMPTY_STRING_LIST: List<String> = emptyList()
    private val EMPTY_COSMETIC_MAP: Map<String, List<String>> = emptyMap()
    private val EMPTY_REGEX_MAP: Map<String, List<Regex>> = emptyMap()
  }

  // ── Thread-safe engine state (hot-swappable) ──────────────────────

  private val stateRef = AtomicReference<AdblockState>()
  private val totalMatchCalls = AtomicLong(0)
  private val totalBlocked = AtomicLong(0)
  private val totalAllowed = AtomicLong(0)

  // ── Init: load patterns (binary fast-path, JSON fallback) ─────────

  init {
    val startTime = System.currentTimeMillis()
    val binState = tryLoadBinary(context)
    if (binState != null) {
      stateRef.set(binState)
      val elapsed = System.currentTimeMillis() - startTime
      Log.i(
        TAG,
        "Loaded (binary trie): " +
          "${binState.blockedDomains.size} blocked domains, " +
          "${binState.urlMatcher.patternCount} AC patterns " +
          "(${binState.urlMatcher.nodeCount} nodes), " +
          "${binState.allowedDomains.size} allowed domains, " +
          "${binState.allowedUrlPrefixes.size} allowed URL prefixes, " +
          "${binState.regexTriggers.size} regex triggers, " +
          "${binState.cosmeticSelectors.size} cosmetic domains ($elapsed ms)",
      )
    } else {
      val json = loadJsonAsset(context, JSON_PATH)
      if (json != null) {
        val state = buildStateFromJson(json)
        stateRef.set(state)
        val elapsed = System.currentTimeMillis() - startTime
        Log.i(
          TAG,
          "Loaded (JSON fallback): " +
            "${state.blockedDomains.size} blocked domains, " +
            "${state.urlMatcher.patternCount} AC patterns " +
            "(${state.urlMatcher.nodeCount} nodes), " +
            "${state.allowedDomains.size} allowed domains, " +
            "${state.allowedUrlPrefixes.size} allowed URL prefixes, " +
            "${state.regexTriggers.size} regex triggers, " +
            "${state.cosmeticSelectors.size} cosmetic domains ($elapsed ms)",
        )
      } else {
        stateRef.set(AdblockState())
      }
    }
  }

  private fun loadJsonAsset(context: Context, path: String): JSONObject? {
    return try {
      val inputStream = context.assets.open(path)
      val reader = BufferedReader(InputStreamReader(inputStream, "UTF-8"))
      val sb = StringBuilder()
      var line: String? = reader.readLine()
      while (line != null) {
        sb.append(line)
        line = reader.readLine()
      }
      reader.close()
      JSONTokener(sb.toString()).nextValue() as? JSONObject
    } catch (e: Exception) {
      Log.w(TAG, "Failed to load $path: ${e.message}")
      null
    }
  }

  // ── Binary trie loader (Expert Fix 4) ────────────────────────────
  // Validates magic + format + CRC32 + exact-consumption and otherwise
  // returns null so the caller falls back to JSON. Never throws.

  private fun tryLoadBinary(context: Context): AdblockState? {
    return try {
      val bytes = context.assets.open(BIN_PATH).use { it.readBytes() }
      val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
      if (buf.remaining() < 16) return null
      val magic = ByteArray(4)
      buf.get(magic)
      if (!magic.contentEquals(BIN_MAGIC.toByteArray())) return null
      val version = buf.int
      if (version != BIN_FORMAT) return null
      val crc = buf.int
      val payloadLen = buf.int
      if (payloadLen <= 0 || payloadLen > buf.remaining()) return null
      val payload = ByteArray(payloadLen)
      buf.get(payload)
      if (buf.remaining() != 0) return null // trailing bytes => corrupt
      val crc32 = CRC32()
      crc32.update(payload)
      if (crc32.value.toInt() != crc) return null

      parseBinaryTrie(ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN))
    } catch (e: Exception) {
      Log.w(TAG, "Binary trie load failed, falling back to JSON: ${e.message}")
      null
    }
  }

  private fun parseBinaryTrie(p: ByteBuffer): AdblockState {
    val u32 = { p.int }
    val i32 = { p.int }
    val u16 = { p.short.toInt() and 0xFFFF }

    fun readTable(): Pair<IntArray, IntArray> {
      val n = u32()
      val off = IntArray(n)
      val len = IntArray(n)
      for (i in 0 until n) {
        off[i] = u32()
        len[i] = u16()
      }
      return Pair(off, len)
    }

    val bd = readTable()
    val ad = readTable()
    val ap = readTable()
    val ac = readTable()

    // Per-pattern regex string tables
    val rxN = u32()
    val rxOffs = Array(rxN) { IntArray(0) }
    val rxLens = Array(rxN) { IntArray(0) }
    for (i in 0 until rxN) {
      val rc = u32()
      val o = IntArray(rc)
      val l = IntArray(rc)
      for (j in 0 until rc) {
        o[j] = u32()
        l[j] = u16()
      }
      rxOffs[i] = o
      rxLens[i] = l
    }

    // Aho-Corasick nodes
    val nodeCount = u32()
    val failArr = IntArray(nodeCount)
    val outArr = IntArray(nodeCount)
    val childStart = IntArray(nodeCount)
    val childCount = IntArray(nodeCount)
    val childChars = mutableListOf<Int>()
    val childNodes = mutableListOf<Int>()
    for (i in 0 until nodeCount) {
      failArr[i] = u32()
      outArr[i] = i32()
      val cc = u32()
      childStart[i] = childChars.size
      childCount[i] = cc
      for (k in 0 until cc) {
        childChars.add(u16())
        childNodes.add(u32())
      }
    }

    // Cosmetic selectors
    val cosN = u32()
    val cosDomOff = IntArray(cosN)
    val cosDomLen = IntArray(cosN)
    val cosSelsOff = Array(cosN) { IntArray(0) }
    val cosSelsLen = Array(cosN) { IntArray(0) }
    for (d in 0 until cosN) {
      cosDomOff[d] = u32()
      cosDomLen[d] = u16()
      val sc = u32()
      val o = IntArray(sc)
      val l = IntArray(sc)
      for (s in 0 until sc) {
        o[s] = u32()
        l[s] = u16()
      }
      cosSelsOff[d] = o
      cosSelsLen[d] = l
    }

    val blobLen = u32()
    val blob = ByteArray(blobLen)
    p.get(blob)
    if (p.remaining() != 0) throw IOException("trailing bytes after blob")

    val getStr = { off: Int, len: Int -> blob.decodeToString(off, off + len) }

    val blockedDomains = BinarySuffixSet(blob, bd.first, bd.second)
    val allowedDomains = BinarySuffixSet(blob, ad.first, ad.second)
    val allowedUrlPrefixes = List(ap.first.size) { i -> getStr(ap.first[i], ap.second[i]) }
    val acPatterns = Array(ac.first.size) { i -> getStr(ac.first[i], ac.second[i]) }

    val acRegexes = Array(rxN) { i ->
      List(rxOffs[i].size) { j -> getStr(rxOffs[i][j], rxLens[i][j]) }
    }
    val regexTriggers = mutableMapOf<String, List<Regex>>()
    for (i in 0 until rxN) {
      if (acRegexes[i].isNotEmpty()) {
        val compiled = mutableListOf<Regex>()
        for (r in acRegexes[i]) {
          try {
            compiled.add(Regex(r, RegexOption.IGNORE_CASE))
          } catch (e: Exception) {
            Log.w(TAG, "Invalid binary regex: $r (${e.message})")
          }
        }
        if (compiled.isNotEmpty()) regexTriggers[acPatterns[i]] = compiled
      }
    }

    val cosmeticSelectors = mutableMapOf<String, List<String>>()
    for (d in 0 until cosN) {
      val dom = getStr(cosDomOff[d], cosDomLen[d])
      val sels = List(cosSelsOff[d].size) { j -> getStr(cosSelsOff[d][j], cosSelsLen[d][j]) }
      if (sels.isNotEmpty()) cosmeticSelectors[dom] = sels
    }

    val matcher = BinaryAhoCorasick(
      failArr, outArr, childStart, childCount,
      childChars.toIntArray(), childNodes.toIntArray(), acPatterns,
    )

    return AdblockState(
      blockedDomains = blockedDomains,
      allowedDomains = allowedDomains,
      allowedUrlPrefixes = allowedUrlPrefixes,
      urlMatcher = matcher,
      regexTriggers = regexTriggers,
      cosmeticSelectors = cosmeticSelectors,
    )
  }

  // ── State builder (JSON path — shared by fallback AND hot-reload) ──

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
      Log.i(
        TAG,
        "Aho-Corasick built: ${allPatterns.size} patterns " +
          "(${urlSubstrings.size} URL + $regexHintCount regex hints), ${urlMatcher.nodeCount} nodes",
      )
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
      blockedDomains = JsonDomainSet(blockedDomains),
      allowedDomains = JsonDomainSet(allowedDomains),
      allowedUrlPrefixes = allowedUrlPrefixes,
      urlMatcher = urlMatcher,
      regexTriggers = regexTriggers,
      cosmeticSelectors = cosmeticSelectors,
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
      Log.i(
        TAG,
        "Patterns hot-reloaded: " +
          "${newState.blockedDomains.size} blocked domains, " +
          "${newState.urlMatcher.patternCount} AC patterns " +
          "(${newState.urlMatcher.nodeCount} nodes), " +
          "${newState.allowedDomains.size} allowed domains, " +
          "${newState.regexTriggers.size} regex triggers",
      )
      true
    } catch (e: Exception) {
      Log.w(TAG, "Failed to hot-reload patterns: ${e.message}")
      false
    }
  }

  // ── Parsing helpers ───────────────────────────────────────────────

  private fun parseStringSet(json: JSONObject, key: String): Set<String> {
    val arr = json.optJSONArray(key) ?: return emptySet()
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
    if (state.allowedDomains.containsSuffix(host)) {
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
    if (state.blockedDomains.containsSuffix(host)) {
      totalBlocked.incrementAndGet()
      Log.v(TAG, "BLOCK (domain): $url")
      return true
    }

    // ── Step 3: Aho-Corasick unified matching → BLOCK or Regex Trigger ──
    // A SINGLE O(L) pass matches BOTH standard blocked URL substrings AND
    // regex trigger hints in one traversal. When a regex hint matches, only
    // the associated regexes are evaluated (not all 28k). When a standard
    // URL substring matches, we block immediately.
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
