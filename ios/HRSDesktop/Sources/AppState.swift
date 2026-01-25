import Foundation
import WebKit

@MainActor
final class AppState: ObservableObject {
    enum Status {
        case launching
        case signedOut
        case ready
    }

    @Published var status: Status = .launching
    @Published var errorMessage: String? = nil
    @Published var loadingMessage: String = "Preparing your workspace…"
    @Published var duoPending: Bool = false

    private let sessionStore = SessionStore.shared
    private let api = APIClient.shared
    private var sessionObserver: NSObjectProtocol? = nil

    init() {
        sessionObserver = NotificationCenter.default.addObserver(
            forName: .hrsSessionInvalid,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            let reason = notification.userInfo?["reason"] as? String ?? "Session expired."
            Task { @MainActor in
                self?.handleSessionInvalid(reason: reason)
            }
        }
        Task {
            await boot()
        }
    }

    func boot() async {
        status = .launching
        errorMessage = nil
        loadingMessage = "Checking session…"
        guard let cookieHeader = sessionStore.cookieHeader else {
            if canAutoLogin {
                duoPending = true
            }
            status = .signedOut
            return
        }
        api.cookieHeader = cookieHeader
        api.customAuth = sessionStore.customAuth
        do {
            loadingMessage = "Refreshing session…"
            let ok = try await api.checkSession()
            status = ok ? .ready : .signedOut
            if !ok {
                clearSession()
                if canAutoLogin {
                    duoPending = true
                }
            } else {
                duoPending = false
            }
        } catch {
            clearSession()
            if canAutoLogin {
                duoPending = true
                status = .signedOut
            } else {
                errorMessage = error.localizedDescription
                status = .signedOut
            }
        }
    }

    func handleLogin(cookies: [HTTPCookie]) async {
        duoPending = false
        let filtered = cookies.filter { $0.domain.contains("hrs.comm-it.co.il") }
        let header = filtered.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        guard !header.isEmpty else {
            errorMessage = "No session cookies found."
            status = .signedOut
            return
        }
        api.cookieHeader = header
        do {
            let customAuth = try await api.fetchCustomAuth()
            api.customAuth = customAuth
            sessionStore.save(cookieHeader: header, customAuth: customAuth)
            let ok = try await api.checkSession()
            status = ok ? .ready : .signedOut
        } catch {
            duoPending = false
            errorMessage = error.localizedDescription
            clearSession()
            status = .signedOut
        }
    }

    func signOut() {
        duoPending = false
        clearSession()
        status = .signedOut
    }

    private func handleSessionInvalid(reason: String) {
        guard status == .ready else { return }
        if canAutoLogin {
            errorMessage = nil
            duoPending = true
            clearSession()
            status = .signedOut
            return
        }
        errorMessage = reason
        signOut()
    }

    private var canAutoLogin: Bool {
        UserDefaults.standard.bool(forKey: "hrs.autoLoginEnabled")
            && sessionStore.savedCredentials != nil
    }

    private func clearSession() {
        sessionStore.clear()
        api.cookieHeader = nil
        api.customAuth = nil
    }
}
