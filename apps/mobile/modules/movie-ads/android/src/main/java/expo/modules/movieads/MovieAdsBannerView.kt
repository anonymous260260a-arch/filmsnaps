package expo.modules.movieads

import android.content.Context
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import com.startapp.sdk.ads.banner.BannerCreator
import com.startapp.sdk.ads.banner.BannerFormat
import com.startapp.sdk.ads.banner.BannerListener
import com.startapp.sdk.ads.banner.BannerRequest
import com.startapp.sdk.adsbase.model.AdPreferences

/**
 * Fixed-size in-layout ad (banner 320x50, mrec 300x250, cover 1200x628).
 *
 * Uses the modern BannerRequest API: load → BannerCreator → attach the
 * created view. The Start.io init must have completed first (JS only
 * renders this view when ads-config enabled the slot AND initialize ran).
 *
 * Lifecycle: load fires once on attach; the loaded banner is KEPT across
 * detach/reattach (removing it forced a fresh WebView each return, which
 * never paints). Only reset() (format/tag change) tears the child down.
 * Events reach JS via
 * EventDispatcher delegates whose property names must match Events(...) in
 * MovieAdsModule's View definition.
 */
class MovieAdsBannerView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {

  var format: String = "banner"
    set(value) {
      if (field != value) {
        field = value
        reset()
      }
    }

  var adTag: String = ""
    set(value) {
      if (field != value) {
        field = value
        reset()
      }
    }

  // Event names = property names; must stay in sync with Events(...) in the module.
  private val onMovieAdsLoaded by EventDispatcher<Map<String, Any>>()
  private val onMovieAdsFailed by EventDispatcher<Map<String, Any>>()
  private val onMovieAdsImpression by EventDispatcher<Map<String, Any>>()
  private val onMovieAdsClicked by EventDispatcher<Map<String, Any>>()

  private var adView: View? = null
  private var loading = false
  private var attached = false

  private val bannerFormat: BannerFormat
    get() = when (format) {
      "mrec" -> BannerFormat.MREC
      "cover" -> BannerFormat.COVER
      else -> BannerFormat.BANNER
    }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached = true
    loadIfNeeded()
  }

  override fun onDetachedFromWindow() {
    attached = false
    // KEEP the loaded banner across detach/reattach. Removing it forced a
    // fresh WebView creation on every return from a pushed screen, and a
    // WebView born during a screen transition never paints (blank ad +
    // AD_CLIPPED impression drops). The creative stays cached in the view
    // and simply reappears when the tab is shown again.
    super.onDetachedFromWindow()
  }

  private fun detachChild() {
    adView?.let { v -> (v.parent as? ViewGroup)?.removeView(v) }
    adView = null
  }

  private fun reset() {
    detachChild()
    loading = false
    if (attached) loadIfNeeded()
  }

  private fun loadIfNeeded() {
    if (loading || adView != null || !attached) return
    val ctx = appContext.reactContext ?: return
    loading = true

    BannerRequest(ctx)
      .setAdFormat(bannerFormat)
      .setAdPreferences(AdPreferences().apply {
        // NOTE: inside apply{} a bare `adTag` would resolve to AdPreferences'
        // OWN (null) getAdTag() — must qualify with the view's `this@`.
        val tag = this@MovieAdsBannerView.adTag
        setAdTag(if (tag.isNotEmpty()) tag else "general")
      })
      .load { creator: BannerCreator?, error: String? ->
        loading = false
        if (creator == null) {
          Log.w(TAG, "no-fill ($format, tag=$adTag): $error")
          onMovieAdsFailed(mapOf("reason" to "no_fill", "format" to format))
          return@load
        }
        if (!attached) return@load // screen went away between load and attach

        val view = creator.create(ctx, object : BannerListener {
          override fun onReceiveAd(banner: View) {
            onMovieAdsLoaded(mapOf("format" to format))
          }

          override fun onFailedToReceiveAd(banner: View) {
            onMovieAdsFailed(mapOf("reason" to "no_fill", "format" to format))
          }

          override fun onImpression(banner: View) {
            onMovieAdsImpression(mapOf("format" to format))
          }

          override fun onClick(banner: View) {
            onMovieAdsClicked(mapOf("format" to format))
          }
        })

        adView = view
        addView(
          view,
          LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
          ).apply { gravity = Gravity.CENTER },
        )
      }
  }

  private companion object {
    const val TAG = "movie-ads"
  }
}
