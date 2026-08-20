package expo.modules.playerwebview

/**
 * Whole-label suffix host matcher — DSA: a sorted array of REVERSED host strings
 * searched with binary search. Reversing `cloudfront.net` → `ten.tnorfc` turns a
 * suffix match into a prefix match, so membership is O(log N) per label level
 * (≤ ~4 levels), total O(log N · depth).
 *
 * This replaces O(N·L) substring scans (`host.contains(it)`) in the request cascade
 * and — critically — closes the "evil-cloudfront.net" false-allow vulnerability:
 * `containsSuffix("evil-cloudfront.net")` for entry `cloudfront.net` is FALSE, while
 * `containsSuffix("cdn.cloudfront.net")` is TRUE. Only exact hosts or proper
 * subdomains match. See expert consult 2026-08-14 (F1 / P2).
 *
 * A [HostSuffixSet] is immutable; build it once from a config snapshot and swap the
 * reference (do NOT rebuild on the hot path).
 */
class HostSuffixSet(domains: Collection<String>) {

  private val reversed: List<String> = domains
    .map { it.trim().lowercase().reversed() }
    .filter { it.isNotEmpty() }
    .sorted()

  /** True if [hostRaw] equals or is a proper subdomain of any entry. */
  fun containsSuffix(hostRaw: String): Boolean {
    var h = hostRaw.lowercase()
    while (h.isNotEmpty()) {
      if (binarySearch(reversed, h.reversed())) return true
      val dot = h.indexOf('.')
      if (dot < 0) break
      h = h.substring(dot + 1)
    }
    return false
  }

  private fun binarySearch(arr: List<String>, key: String): Boolean {
    var lo = 0
    var hi = arr.size - 1
    while (lo <= hi) {
      val mid = (lo + hi) ushr 1
      val c = arr[mid].compareTo(key)
      when {
        c < 0 -> lo = mid + 1
        c > 0 -> hi = mid - 1
        else -> return true
      }
    }
    return false
  }
}
