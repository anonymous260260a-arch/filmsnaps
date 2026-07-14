import ExpoModulesCore
import WebKit

class PlayerWebView: ExpoView, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
  let webView: WKWebView

  // Events
  var onLoadingStart: (([String: Any]) -> Void)? = nil
  var onLoadingFinish: ((String) -> Void)? = nil
  var onHttpError: (([String: Any]) -> Void)? = nil
  var onMessage: (([String: Any]) -> Void)? = nil

  // ── Injected script (applied as WKUserScript before page load) ──
  var injectedScript: String = ""

  // ── Referrer header ──
  var referrer: String = ""

  // ── Multiple windows support (ChillFlix) ──
  var supportMultipleWindows: Bool = false

  // ── Allow JS to open windows automatically ──
  var javaScriptCanOpenWindowsAutomatically: Bool = false

  // ── Ad/tracker domain patterns (same as Android) ──
  private let adPatterns: Set<String> = [
    "doubleclick.net", "googleadservices.com", "googlesyndication.com",
    "google-analytics.com", "googletagmanager.com", "pagead2.googlesyndication.com",
    "adnxs.com", "rubiconproject.com", "criteo.com", "outbrain.com", "taboola.com",
    "popads.", "popcash.", "popunder.", "adsterra.com",
    "propellerads.com", "histats.com", "statcounter.com",
    "amazon-adsystem.com", "casalemedia.com", "openx.net",
    "exoclick.com", "juicyads.com", "plugrush.com",
    "trafficjunky.com", "adcash.com", "clickadu.com",
    "adsystem.", "adserver.", "ads."
  ]

  required init(appContext: AppContext? = nil) {
    // ── WebView configuration ──
    let config = WKWebViewConfiguration()
    let preferences = WKWebpagePreferences()
    preferences.allowsContentJavaScript = true
    config.defaultWebpagePreferences = preferences

    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []

    // Enable JS bridge + user script support
    let userContentController = WKUserContentController()
    userContentController.addScriptMessageHandler(
      LeakAwareScriptMessageHandler(handler: nil),
      contentWorld: .page,
      name: "ReactNativeWebView"
    )
    config.userContentController = userContentController

    // Disable data detectors (can interfere with video players)
    config.dataDetectorTypes = []

    let wv = WKWebView(frame: .zero, configuration: config)
    wv.allowsBackForwardNavigationGestures = false
    wv.scrollView.isScrollEnabled = false
    wv.isOpaque = false
    wv.backgroundColor = .black

    webView = wv

    super.init(appContext: appContext)

    wv.navigationDelegate = self
    wv.uiDelegate = self

    addSubview(wv)
    wv.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      wv.topAnchor.constraint(equalTo: topAnchor),
      wv.bottomAnchor.constraint(equalTo: bottomAnchor),
      wv.leadingAnchor.constraint(equalTo: leadingAnchor),
      wv.trailingAnchor.constraint(equalTo: trailingAnchor)
    ])
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  // ── Source URI prop ──
  var sourceUri: String = "" {
    didSet {
      if !sourceUri.isEmpty, let url = URL(string: sourceUri) {
        loadMainUrl(url)
      }
    }
  }

  // ── User-Agent prop ──
  var userAgent: String? = nil {
    didSet {
      if let ua = userAgent {
        webView.customUserAgent = ua
      }
    }
  }

  // ── Force load: imperative navigation ──
  var forceLoadUrl: String = "" {
    didSet {
      if !forceLoadUrl.isEmpty, let url = URL(string: forceLoadUrl) {
        loadMainUrl(url)
      }
    }
  }

  // ── Reload ──
  func reloadView() {
    // Re-apply injected script before reload
    if !injectedScript.isEmpty {
      let script = WKUserScript(source: injectedScript, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .page)
      webView.configuration.userContentController.removeAllUserScripts()
      webView.configuration.userContentController.addUserScript(script)
    }
    webView.reload()
  }

  // ── Stop loading ──
  func stop() {
    webView.stopLoading()
  }

  private func loadMainUrl(_ url: URL) {
    webView.stopLoading()
    // Apply injected script as a WKUserScript before navigation
    if !injectedScript.isEmpty {
      let script = WKUserScript(source: injectedScript, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .page)
      webView.configuration.userContentController.removeAllUserScripts()
      webView.configuration.userContentController.addUserScript(script)
    }
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 30)
    if !referrer.isEmpty {
      request.setValue(referrer, forHTTPHeaderField: "Referer")
    }
    webView.load(request)
  }

  // ── Inject JavaScript (used for seek, etc.) ──
  func injectJavaScript(_ script: String) {
    guard !script.isEmpty else { return }
    webView.evaluateJavaScript(script, in: nil, in: .page) { _ in }
  }

  // ── WKNavigationDelegate ──
  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    if let url = webView.url?.absoluteString {
      onLoadingStart?(["url": url])
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if let url = webView.url?.absoluteString {
      onLoadingFinish?(url)
    }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    let nsError = error as NSError
    if nsError.code == NSURLErrorCancelled { return }
    onHttpError?([
      "statusCode": nsError.code,
      "description": nsError.localizedDescription
    ])
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    let nsError = error as NSError
    if nsError.code == NSURLErrorCancelled { return }
    onHttpError?([
      "statusCode": nsError.code,
      "description": nsError.localizedDescription
    ])
  }

  // ── WKUIDelegate for popups ──
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if navigationAction.targetFrame == nil {
      // ChillFlix opens video in popup — redirect to same webview
      if let url = navigationAction.request.url {
        webView.load(URLRequest(url: url))
      }
    }
    return nil
  }

  // ── WKScriptMessageHandler ──
  func userContentController(_ userContentController: WKUserContentController,
                             didReceive message: WKScriptMessage) {
    if message.name == "ReactNativeWebView" {
      onMessage?(["data": "\(message.body)"])
    }
  }

  // ── Teardown ──
  func cleanup() {
    webView.stopLoading()
    webView.configuration.userContentController.removeScriptMessageHandler(forName: "ReactNativeWebView")
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
  }
}

/// Prevents retain cycles from WKScriptMessageHandler
private class LeakAwareScriptMessageHandler: NSObject, WKScriptMessageHandler {
  weak var handler: WKScriptMessageHandler?

  init(handler: WKScriptMessageHandler?) {
    self.handler = handler
    super.init()
  }

  func userContentController(_ userContentController: WKUserContentController,
                              didReceive message: WKScriptMessage) {
    handler?.userContentController(userContentController, didReceive: message)
  }
}
