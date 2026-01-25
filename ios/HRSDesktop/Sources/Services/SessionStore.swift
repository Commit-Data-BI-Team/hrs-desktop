import Foundation

struct HRSCredentials: Equatable {
    let username: String
    let password: String
}

final class SessionStore {
    static let shared = SessionStore()

    private let keychain = KeychainStore.shared
    private let cookieKey = "hrs.cookieHeader"
    private let authKey = "hrs.customAuth"
    private let usernameKey = "hrs.username"
    private let passwordKey = "hrs.password"

    private init() {}

    var cookieHeader: String? {
        keychain.load(key: cookieKey)
    }

    var customAuth: String? {
        keychain.load(key: authKey)
    }

    var savedCredentials: HRSCredentials? {
        guard let username = keychain.load(key: usernameKey),
              let password = keychain.load(key: passwordKey),
              !username.isEmpty,
              !password.isEmpty else {
            return nil
        }
        return HRSCredentials(username: username, password: password)
    }

    func save(cookieHeader: String, customAuth: String) {
        keychain.save(cookieHeader, for: cookieKey)
        keychain.save(customAuth, for: authKey)
    }

    func saveCredentials(username: String, password: String) {
        keychain.save(username, for: usernameKey)
        keychain.save(password, for: passwordKey)
    }

    func clearCredentials() {
        keychain.delete(key: usernameKey)
        keychain.delete(key: passwordKey)
    }

    func clear() {
        keychain.delete(key: cookieKey)
        keychain.delete(key: authKey)
    }
}
