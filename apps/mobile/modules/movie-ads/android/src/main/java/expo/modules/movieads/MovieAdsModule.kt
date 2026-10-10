package expo.modules.movieads

import android.util.Log
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.startapp.sdk.adsbase.Ad
import com.startapp.sdk.adsbase.StartAppAd
import com.startapp.sdk.adsbase.StartAppSDK
import com.startapp.sdk.adsbase.adlisteners.AdDisplayListener
import com.startapp.sdk.adsbase.adlisteners.AdEventListener
import com.startapp.sdk.adsbase.model.AdPreferences

/**
 * Start.io bridge. Everything here is dormant until JS calls initialize() —
 * which only happens when the remote ads-config.json says ads are on.
 *
 * No splash, no return ads, no autostitial: initParams disables return ads
 * explicitly and SDK 5.0+ dropped splash from the default path. The
 * banner/mrec/cover formats live in MovieAdsBannerView (BannerRequest).
 */
class MovieAdsModule : Module() {
  private var initialized = false
  private var interstitialAd: StartAppAd? = null

  override fun definition() = ModuleDefinition {
    Name("MovieAds")

    Function("initialize") { appId: String, testAds: Boolean, consent: Boolean ->
      initialize(appId, testAds, consent)
    }

    Function("setConsent") { consent: Boolean ->
      setConsent(consent)
    }

    AsyncFunction("loadInterstitial") { adTag: String, promise: Promise ->
      loadInterstitial(adTag, promise)
    }

    Function("showInterstitial") {
      showInterstitial()
    }

    View(MovieAdsBannerView::class) {
      // View events → JS (onMovieAdsLoaded etc. props on the native view).
      Events(
        "onMovieAdsLoaded",
        "onMovieAdsFailed",
        "onMovieAdsImpression",
        "onMovieAdsClicked",
      )

      Prop("format") { view: MovieAdsBannerView, format: String ->
        view.format = format
      }
      Prop("adTag") { view: MovieAdsBannerView, tag: String ->
        view.adTag = tag
      }
    }
  }

  private fun initialize(appId: String, testAds: Boolean, consent: Boolean): Boolean {
    // expo types reactContext as plain Context — it's the ReactContext at runtime.
    val context = appContext.reactContext as? ReactContext ?: return false
    if (appId.isBlank()) {
      Log.w(TAG, "initialize skipped: blank appId")
      return false
    }
    // Test ads must be decided BEFORE the first init; harmless afterwards.
    try {
      StartAppSDK.setTestAdsEnabled(testAds)
    } catch (t: Throwable) {
      Log.e(TAG, "setTestAdsEnabled failed", t)
    }
    if (!initialized) {
      initialized = true // re-entry guard set synchronously; actual init on main
      context.runOnUiQueueThread {
        try {
          StartAppSDK.initParams(context.applicationContext, appId)
            .setReturnAdsEnabled(false)
            .setCallback { Log.i(TAG, "Start.io SDK ready (testAds=$testAds)") }
            .init()
          applyConsent(context, consent)
        } catch (t: Throwable) {
          Log.e(TAG, "Start.io init failed", t)
        }
      }
    } else {
      applyConsent(context, consent)
    }
    return true
  }

  private fun setConsent(consent: Boolean) {
    val context = appContext.reactContext ?: return
    applyConsent(context, consent)
  }

  private fun applyConsent(context: android.content.Context, consent: Boolean) {
    try {
      // IAB GDPR purpose-1 string ("pas" = personalized ads consent).
      StartAppSDK.setUserConsent(context, "pas", System.currentTimeMillis(), consent)
    } catch (t: Throwable) {
      Log.e(TAG, "setUserConsent failed", t)
    }
  }

  private fun loadInterstitial(adTag: String, promise: Promise) {
    val activity = appContext.currentActivity
    if (activity == null || !initialized) {
      Log.w(TAG, "loadInterstitial skipped (activity=${activity != null}, init=$initialized)")
      promise.resolve(false)
      return
    }
    // Capture before apply{} — inside the lambda a bare `adTag` resolves to
    // AdPreferences' OWN (null) getAdTag(), shadowing the function param.
    val tag = adTag
    val ad = StartAppAd(activity)
    ad.loadAd(
      AdPreferences().apply {
        setAdTag(if (tag.isNotEmpty()) tag else "general")
      },
      object : AdEventListener {
        override fun onReceiveAd(ad: Ad) {
          interstitialAd = ad as? StartAppAd
          promise.resolve(true)
        }

        override fun onFailedToReceiveAd(ad: Ad?) {
          Log.w(TAG, "interstitial no-fill: ${ad?.errorMessage}")
          promise.resolve(false)
        }
      },
    )
  }

  private fun showInterstitial(): Boolean {
    val ad = interstitialAd ?: return false
    interstitialAd = null
    val activity = appContext.currentActivity ?: return false
    activity.runOnUiThread {
      ad.showAd(object : AdDisplayListener {
        override fun adDisplayed(ad: Ad) { Log.i(TAG, "interstitial shown") }
        override fun adHidden(ad: Ad) { Log.i(TAG, "interstitial closed") }
        override fun adClicked(ad: Ad) { Log.i(TAG, "interstitial clicked") }
        override fun adNotDisplayed(ad: Ad?) { Log.w(TAG, "interstitial not displayed") }
      })
    }
    return true
  }

  private companion object {
    const val TAG = "movie-ads"
  }
}
