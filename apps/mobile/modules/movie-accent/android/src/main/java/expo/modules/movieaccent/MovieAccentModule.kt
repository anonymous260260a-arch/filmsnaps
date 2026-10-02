package expo.modules.movieaccent

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.palette.graphics.Palette
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.Cache
import okhttp3.ConnectionPool
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Returns RAW swatches only — all quality gates / scoring / palette derivation
 * stay in JS (normalizeAccent → buildPalette).
 *
 * Shape (v4): each entry is { hex: "#RRGGBB", population: Int } where
 * population is Palette's pixel-share count (0 for the computed `average`,
 * which has no natural population). JS accepts BOTH this shape and the old
 * plain-hex shape so the react-native-image-colors fallback keeps working.
 */
class MovieAccentModule : Module() {
  private val pool = Executors.newFixedThreadPool(3) { r -> Thread(r, "movie-accent").apply { priority = Thread.NORM_PRIORITY - 1 } }
  private val scope = CoroutineScope(SupervisorJob() + pool.asCoroutineDispatcher())

  private val client: OkHttpClient by lazy {
    val builder = OkHttpClient.Builder()
      .dispatcher(Dispatcher().apply { maxRequests = 16; maxRequestsPerHost = 8 })
      .connectionPool(ConnectionPool(4, 60, TimeUnit.SECONDS))
      .connectTimeout(2000, TimeUnit.MILLISECONDS)
      .callTimeout(2600, TimeUnit.MILLISECONDS) // JS races at 3s; fail first so failure memo is real
    // Disk cache: repeat fetches of the same tiny rendition (w92/w300) after
    // process death skip the network entirely when TMDB's cache headers allow.
    appContext.reactContext?.cacheDir?.let { dir ->
      builder.cache(Cache(File(dir, "movie_accent_http"), 8L * 1024 * 1024))
    }
    builder.build()
  }

  private val maxEntries = 200
  private val cache = object : LinkedHashMap<String, Map<String, Any?>>(64, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Map<String, Any?>>?) = size > maxEntries
  }
  private val inflight = ConcurrentHashMap<String, Deferred<Map<String, Any?>?>>()

  private fun key(url: String, w: Int) = "$w|$url"
  private fun cacheGet(k: String) = synchronized(cache) { cache[k] }
  private fun cachePut(k: String, v: Map<String, Any?>) = synchronized(cache) { cache[k] = v }

  override fun definition() = ModuleDefinition {
    Name("MovieAccent")

    // Promise-based (same pattern as the expo-video patch in this repo —
    // compiles against expo-modules-core 55; Promise lives in
    // expo.modules.kotlin). The coroutine runs on this module's pool, off
    // the JS thread.
    AsyncFunction("getSwatches") { url: String, decodeWidth: Int, promise: Promise ->
      scope.launch {
        try {
          promise.resolve(load(url, decodeWidth))
        } catch (e: Throwable) {
          promise.reject("MOVIE_ACCENT_ERROR", e.message ?: "accent extraction failed", e)
        }
      }
    }

    // Synchronous, in-memory only (survives JS reloads because the native process lives on).
    Function("peekSwatches") { url: String, decodeWidth: Int ->
      cacheGet(key(url, decodeWidth))
    }

    // Fire-and-forget prefetch (call from list viewability / onPressIn).
    Function("warm") { urls: List<String>, decodeWidth: Int ->
      urls.forEach { u -> scope.launch { runCatching { load(u, decodeWidth) } } }
    }

    Function("clear") { synchronized(cache) { cache.clear() } }

    OnDestroy { scope.cancel(); pool.shutdown() }
  }

  private suspend fun load(url: String, w: Int): Map<String, Any?>? {
    val k = key(url, w)
    cacheGet(k)?.let { return it }

    val fresh = scope.async(start = CoroutineStart.LAZY) { fetchAndExtract(url, w) }
    val existing = inflight.putIfAbsent(k, fresh)
    val job = existing ?: fresh.also { it.start() }
    if (existing != null) fresh.cancel() // cancel OUR unstarted duplicate; await the winner
    try {
      val res = job.await()
      if (res != null) cachePut(k, res)
      return res
    } finally {
      if (existing == null) inflight.remove(k)
    }
  }

  private fun fetchAndExtract(url: String, w: Int): Map<String, Any?>? {
    val bytes = client.newCall(Request.Builder().url(url).build()).execute().use { r ->
      if (!r.isSuccessful) return null
      r.body?.bytes() ?: return null
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    var sample = 1
    while (bounds.outWidth / (sample * 2) >= w) sample *= 2
    val opts = BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: return null
    try {
      // Already tiny: disable Palette's internal resize (resizeBitmapArea(0)).
      val p = Palette.from(bmp).maximumColorCount(16).resizeBitmapArea(0).generate()

      fun entry(swatch: Palette.Swatch?): Map<String, Any?>? =
        swatch?.let {
          mapOf(
            "hex" to String.format("#%06X", it.rgb and 0xFFFFFF),
            "population" to it.population,
          )
        }

      return mapOf(
        "darkVibrant" to entry(p.darkVibrantSwatch),
        "darkMuted" to entry(p.darkMutedSwatch),
        "vibrant" to entry(p.vibrantSwatch),
        "muted" to entry(p.mutedSwatch),
        "dominant" to entry(p.dominantSwatch),
        // Computed mean — no natural population; JS treats 0 as "unknown".
        "average" to mapOf(
          "hex" to String.format("#%06X", average(bmp) and 0xFFFFFF),
          "population" to 0,
        ),
        "lightVibrant" to entry(p.lightVibrantSwatch),
        "lightMuted" to entry(p.lightMutedSwatch),
      )
    } finally {
      bmp.recycle()
    }
  }

  private fun average(bmp: Bitmap): Int {
    val n = bmp.width * bmp.height
    val px = IntArray(n)
    bmp.getPixels(px, 0, bmp.width, 0, 0, bmp.width, bmp.height)
    var r = 0L; var g = 0L; var b = 0L
    for (c in px) { r += Color.red(c); g += Color.green(c); b += Color.blue(c) }
    return Color.rgb((r / n).toInt(), (g / n).toInt(), (b / n).toInt())
  }
}
