import ExpoModulesCore

public class PlayerwebviewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PlayerWebview")

    // ── View manager ──
    View(PlayerWebView.self) {
      Events("onLoadingStart", "onLoadingFinish", "onHttpError", "onMessage")

      Prop("source") { (view: PlayerWebView, value: [String: Any]) in
        if let uri = value["uri"] as? String {
          view.sourceUri = uri
        }
      }

      Prop("userAgent") { (view: PlayerWebView, value: String) in
        view.userAgent = value
      }

      Prop("forceLoadUrl") { (view: PlayerWebView, value: String) in
        view.forceLoadUrl = value
      }

      Prop("injectedJavaScriptBeforeContentLoaded") { (view: PlayerWebView, value: String) in
        view.injectedScript = value
      }

      Prop("allowsFullscreenVideo") { (_: PlayerWebView, _: Bool) in
        // Fullscreen is always allowed via WKUIDelegate
      }

      Prop("setSupportMultipleWindows") { (view: PlayerWebView, value: Bool) in
        view.supportMultipleWindows = value
      }

      Prop("referrer") { (view: PlayerWebView, value: String) in
        view.referrer = value
      }

      Prop("javaScriptCanOpenWindowsAutomatically") { (view: PlayerWebView, value: Bool) in
        view.javaScriptCanOpenWindowsAutomatically = value
      }

      // ── Imperative control props (setNativeProps) ──
      Prop("forceReload") { (view: PlayerWebView, _: Double) in
        view.reloadView()
      }

      Prop("forceStop") { (view: PlayerWebView, _: Double) in
        view.stop()
      }

      Prop("injectedJavaScript_") { (view: PlayerWebView, value: String) in
        view.injectJavaScript(value)
      }

      // ── Lifecycle ──
      OnViewDidUpdateProps { _ in
        // Props are handled individually via their didSet observers
      }
    }

    // ── Clear all WebView storage (cookies, cache, localStorage) ──
    AsyncFunction("clearAllState") {
      await clearWebViewState()
    }
  }

  private func clearWebViewState() async {
    // WKWebsiteDataStore removes all data including cookies, cache, localStorage, IndexedDB
    let dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()
    let since = Date.distantPast

    await WKWebsiteDataStore.default().removeData(
      ofTypes: dataTypes,
      modifiedSince: since
    )
  }
}
