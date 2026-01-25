import SwiftUI
import WebKit

struct HRSLoginWebView: UIViewRepresentable {
    var onCookies: ([HTTPCookie]) -> Void
    var credentials: HRSCredentials?
    var autoSubmit: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(onCookies: onCookies, credentials: credentials, autoSubmit: autoSubmit)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore.default()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        if let url = URL(string: "https://hrs.comm-it.co.il/admin/") {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let onCookies: ([HTTPCookie]) -> Void
        private let credentials: HRSCredentials?
        private let autoSubmit: Bool
        private var handled = false
        private var didAutoSubmit = false

        init(onCookies: @escaping ([HTTPCookie]) -> Void, credentials: HRSCredentials?, autoSubmit: Bool) {
            self.onCookies = onCookies
            self.credentials = credentials
            self.autoSubmit = autoSubmit
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard !handled else { return }
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                let sessionCookie = cookies.first { $0.name == "sessionid" && $0.domain.contains("hrs.comm-it.co.il") }
                if sessionCookie != nil {
                    self.handled = true
                    self.onCookies(cookies)
                    return
                }
                guard self.autoSubmit,
                      !self.didAutoSubmit,
                      let credentials = self.credentials else {
                    return
                }
                self.didAutoSubmit = true
                let script = Self.autoLoginScript(username: credentials.username, password: credentials.password)
                webView.evaluateJavaScript(script, completionHandler: nil)
            }
        }

        private static func autoLoginScript(username: String, password: String) -> String {
            let user = jsEscaped(username)
            let pass = jsEscaped(password)
            return """
            (function() {
              const userValue = '\(user)';
              const passValue = '\(pass)';
              const userEl = document.querySelector("input[name='username'], #id_username, input[type='email']");
              const passEl = document.querySelector("input[name='password'], #id_password, input[type='password']");
              if (!userEl || !passEl) { return "no-fields"; }
              userEl.value = userValue;
              passEl.value = passValue;
              userEl.dispatchEvent(new Event('input', { bubbles: true }));
              passEl.dispatchEvent(new Event('input', { bubbles: true }));
              const form = passEl.closest('form');
              if (form) { form.submit(); return "submitted"; }
              const submit = document.querySelector("button[type='submit'], input[type='submit']");
              if (submit) { submit.click(); return "clicked"; }
              return "no-submit";
            })();
            """
        }

        private static func jsEscaped(_ value: String) -> String {
            value
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "")
        }
    }
}
