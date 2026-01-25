import Foundation
import CryptoKit

final class SecureCache {
    static let shared = SecureCache()

    private let fileManager = FileManager.default
    private let defaults = UserDefaults.standard
    private let crypto = TimeCapsuleCrypto.shared
    private let manifestKey = "hrs.cache.manifest"
    private let baseURL: URL

    private init() {
        let root = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        baseURL = (root ?? fileManager.temporaryDirectory).appendingPathComponent("HRSDesktopCache", isDirectory: true)
        if !fileManager.fileExists(atPath: baseURL.path) {
            try? fileManager.createDirectory(at: baseURL, withIntermediateDirectories: true)
        }
        if let oldKey = crypto.rotateMasterKeyIfNeeded() {
            reencryptAll(using: oldKey, newKey: crypto.masterKey)
        }
    }

    func save<T: Codable>(name: String, monthKey: String, value: T) {
        guard let data = try? JSONEncoder.hrs.encode(value) else { return }
        guard let encrypted = try? crypto.encrypt(data, monthKey: monthKey, masterKey: crypto.masterKey) else { return }
        let meta = CacheMeta(monthKey: monthKey, createdAt: Date())
        guard let metaData = try? JSONEncoder.hrs.encode(meta) else { return }
        try? encrypted.write(to: dataURL(for: name), options: .atomic)
        try? metaData.write(to: metaURL(for: name), options: .atomic)
        updateManifest(with: name)
    }

    func load<T: Codable>(name: String, maxAge: TimeInterval? = nil) -> T? {
        guard let metaData = try? Data(contentsOf: metaURL(for: name)),
              let meta = try? JSONDecoder.hrs.decode(CacheMeta.self, from: metaData) else {
            return nil
        }
        if let maxAge {
            if Date().timeIntervalSince(meta.createdAt) > maxAge {
                return nil
            }
        }
        guard let encrypted = try? Data(contentsOf: dataURL(for: name)) else { return nil }
        guard let decrypted = try? crypto.decrypt(encrypted, monthKey: meta.monthKey, masterKey: crypto.masterKey) else {
            return nil
        }
        return try? JSONDecoder.hrs.decode(T.self, from: decrypted)
    }

    func delete(name: String) {
        try? fileManager.removeItem(at: dataURL(for: name))
        try? fileManager.removeItem(at: metaURL(for: name))
        removeFromManifest(name)
    }

    private func dataURL(for name: String) -> URL {
        baseURL.appendingPathComponent("\(name).enc")
    }

    private func metaURL(for name: String) -> URL {
        baseURL.appendingPathComponent("\(name).meta")
    }

    private func updateManifest(with name: String) {
        var items = manifest
        items.insert(name)
        defaults.set(Array(items), forKey: manifestKey)
    }

    private func removeFromManifest(_ name: String) {
        var items = manifest
        items.remove(name)
        defaults.set(Array(items), forKey: manifestKey)
    }

    private var manifest: Set<String> {
        let items = defaults.array(forKey: manifestKey) as? [String] ?? []
        return Set(items)
    }

    private func reencryptAll(using oldKey: SymmetricKey, newKey: SymmetricKey) {
        for name in manifest {
            guard let metaData = try? Data(contentsOf: metaURL(for: name)),
                  let meta = try? JSONDecoder.hrs.decode(CacheMeta.self, from: metaData),
                  let encrypted = try? Data(contentsOf: dataURL(for: name)) else {
                continue
            }
            guard let decrypted = try? crypto.decrypt(encrypted, monthKey: meta.monthKey, masterKey: oldKey) else {
                continue
            }
            guard let reencrypted = try? crypto.encrypt(decrypted, monthKey: meta.monthKey, masterKey: newKey) else {
                continue
            }
            try? reencrypted.write(to: dataURL(for: name), options: .atomic)
        }
    }
}

private struct CacheMeta: Codable {
    let monthKey: String
    let createdAt: Date
}

final class TimeCapsuleCrypto {
    static let shared = TimeCapsuleCrypto()

    private let keychain = KeychainStore.shared
    private let defaults = UserDefaults.standard
    private let masterKeyKey = "hrs.cache.master"
    private let appVersionKey = "hrs.cache.appVersion"
    private let info = Data("hrs.cache".utf8)

    private(set) var masterKey: SymmetricKey

    private init() {
        if let data = keychain.loadData(key: masterKeyKey) {
            masterKey = SymmetricKey(data: data)
        } else {
            masterKey = TimeCapsuleCrypto.generateKey()
            saveMasterKey()
        }
        if defaults.string(forKey: appVersionKey) == nil {
            defaults.setValue(AppVersion.current, forKey: appVersionKey)
        }
    }

    func rotateMasterKeyIfNeeded() -> SymmetricKey? {
        let storedVersion = defaults.string(forKey: appVersionKey)
        let current = AppVersion.current
        guard storedVersion != current else { return nil }
        let old = masterKey
        masterKey = TimeCapsuleCrypto.generateKey()
        saveMasterKey()
        defaults.setValue(current, forKey: appVersionKey)
        return old
    }

    func encrypt(_ data: Data, monthKey: String, masterKey: SymmetricKey) throws -> Data {
        let key = derivedKey(for: monthKey, masterKey: masterKey)
        let sealed = try AES.GCM.seal(data, using: key)
        guard let combined = sealed.combined else { throw CryptoError.invalidData }
        return combined
    }

    func decrypt(_ data: Data, monthKey: String, masterKey: SymmetricKey) throws -> Data {
        let key = derivedKey(for: monthKey, masterKey: masterKey)
        let box = try AES.GCM.SealedBox(combined: data)
        return try AES.GCM.open(box, using: key)
    }

    private func derivedKey(for monthKey: String, masterKey: SymmetricKey) -> SymmetricKey {
        let salt = Data(monthKey.utf8)
        return HKDF<SHA256>.deriveKey(
            inputKeyMaterial: masterKey,
            salt: salt,
            info: info,
            outputByteCount: 32
        )
    }

    private func saveMasterKey() {
        let data = masterKey.withUnsafeBytes { Data($0) }
        keychain.saveData(data, for: masterKeyKey)
    }

    private static func generateKey() -> SymmetricKey {
        SymmetricKey(size: .bits256)
    }
}

enum CryptoError: Error {
    case invalidData
}

enum AppVersion {
    static var current: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    }
}
