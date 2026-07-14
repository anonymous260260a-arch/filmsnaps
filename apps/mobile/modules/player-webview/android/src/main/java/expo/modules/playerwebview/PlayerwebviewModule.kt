package expo.modules.playerwebview

import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PlayerWebviewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PlayerWebview")

    // Window-Overlay WebView — attaches the real WebView to the Activity window,
    // bypassing Fabric's compositing pipeline entirely.
    // File: PlayerWebViewOverlayView.kt
    View(PlayerWebViewOverlayView::class) {
      Events(
        "onLoadingStart",
        "onLoadingFinish",
        "onHttpError",
        "onMessage",
        "onRenderProcessGone",
        "onAuditData"
      )

      Prop("injectedJavaScriptBeforeContentLoaded") { view: PlayerWebViewOverlayView, value: String ->
        view.injectedScript = value
      }

      Prop("source") { view: PlayerWebViewOverlayView, value: Map<String, Any> ->
        val uri = value["uri"] as? String ?: return@Prop
        view.sourceUri = uri
      }

      Prop("userAgent") { view: PlayerWebViewOverlayView, value: String ->
        view.userAgent = value
      }

      Prop("injectedJavaScriptAfterLoad") { view: PlayerWebViewOverlayView, value: String ->
        view.injectedJavaScriptAfterLoad = value
      }

      Prop("allowsFullscreenVideo") { _: PlayerWebViewOverlayView, _: Boolean -> }

      Prop("setSupportMultipleWindows") { view: PlayerWebViewOverlayView, value: Boolean ->
        view.supportMultipleWindows = value
      }

      Prop("referrer") { view: PlayerWebViewOverlayView, value: String ->
        view.referrer = value
      }

      Prop("javaScriptCanOpenWindowsAutomatically") { view: PlayerWebViewOverlayView, value: Boolean ->
        view.javaScriptCanOpenWindowsAutomatically = value
      }

      Prop("forceLoadUrl") { view: PlayerWebViewOverlayView, value: String ->
        view.forceLoadUrl = value
      }

      Prop("forceReload") { view: PlayerWebViewOverlayView, _: Double ->
        view.reload()
      }

      Prop("forceStop") { view: PlayerWebViewOverlayView, _: Double ->
        view.stop()
      }

      Prop("injectedJavaScript_") { view: PlayerWebViewOverlayView, value: String ->
        view.injectedJavaScript_ = value
      }

      Prop("auditMode") { view: PlayerWebViewOverlayView, value: Boolean ->
        view.auditMode = value
      }
    }

    AsyncFunction("clearAllState") {
      clearWebViewState()
    }
  }

  private fun clearWebViewState() {
    val context = appContext.reactContext ?: return
    CookieManager.getInstance().removeAllCookies(null)
    CookieManager.getInstance().flush()
    WebStorage.getInstance().deleteAllData()
    WebView(context).apply {
      clearCache(true)
      clearFormData()
      clearHistory()
      clearSslPreferences()
      destroy()
    }
  }
}
