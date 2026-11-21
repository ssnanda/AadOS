import SwiftUI
import UIKit
import WebKit

@MainActor
final class BrowserModel: ObservableObject {
    @Published var canGoBack = false
    @Published var canGoForward = false
    @Published var isLoading = false
    @Published var progress = 0.0
    @Published var errorMessage: String?

    fileprivate weak var webView: WKWebView? {
        didSet { if oldValue !== webView { requestedURL = nil } }
    }
    private var pendingURL: URL?
    /// The configured server URL last sent to the web view. Compared instead of
    /// `webView.url`, which changes on server redirects (e.g. `/` → `/login`);
    /// comparing against it re-issued the load on every SwiftUI update, causing
    /// an endless reload loop and a blank screen.
    private var requestedURL: URL?

    func load(_ url: URL?, force: Bool = false) {
        pendingURL = url
        guard let webView, let url else { return }
        guard force || requestedURL != url else { return }
        requestedURL = url
        webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
    }

    func reload() {
        errorMessage = nil
        if webView?.url != nil { webView?.reload() } else { load(pendingURL, force: true) }
    }

    func goBack() { webView?.goBack() }
    func goForward() { webView?.goForward() }
}

struct AadOSWebView: UIViewRepresentable {
    let url: URL
    @ObservedObject var browser: BrowserModel

    func makeCoordinator() -> Coordinator { Coordinator(browser: browser) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.scrollView.contentInsetAdjustmentBehavior = .automatic
        context.coordinator.observe(view)
        browser.webView = view
        browser.load(url)
        return view
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        browser.webView = webView
        browser.load(url)
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.stopObserving(webView)
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        private let browser: BrowserModel
        private var observations: [NSKeyValueObservation] = []

        init(browser: BrowserModel) { self.browser = browser }

        func observe(_ view: WKWebView) {
            observations = [
                view.observe(\.estimatedProgress, options: [.initial, .new]) { [weak browser] view, _ in
                    Task { @MainActor in browser?.progress = view.estimatedProgress }
                },
                view.observe(\.canGoBack, options: [.initial, .new]) { [weak browser] view, _ in
                    Task { @MainActor in browser?.canGoBack = view.canGoBack }
                },
                view.observe(\.canGoForward, options: [.initial, .new]) { [weak browser] view, _ in
                    Task { @MainActor in browser?.canGoForward = view.canGoForward }
                }
            ]
        }

        func stopObserving(_ view: WKWebView) {
            observations.removeAll()
            if browser.webView === view { browser.webView = nil }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            browser.isLoading = true
            browser.errorMessage = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            browser.isLoading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            fail(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            fail(error)
        }

        private func fail(_ error: Error) {
            browser.isLoading = false
            let code = (error as NSError).code
            if code != NSURLErrorCancelled { browser.errorMessage = error.localizedDescription }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = navigationAction.request.url else { decisionHandler(.cancel); return }
            if navigationAction.targetFrame == nil || !["http", "https"].contains(target.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(target)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
