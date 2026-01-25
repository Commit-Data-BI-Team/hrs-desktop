import Foundation

extension Notification.Name {
    static let hrsSessionInvalid = Notification.Name("hrsSessionInvalid")
}

final class APIClient {
    static let shared = APIClient()

    enum APIError: LocalizedError {
        case missingSession
        case missingCustomAuth
        case invalidResponse
        case http(Int)
        case customAuthNotFound

        var errorDescription: String? {
            switch self {
            case .missingSession:
                return "Missing session. Please login again."
            case .missingCustomAuth:
                return "Missing CustomAuth key. Please login again."
            case .invalidResponse:
                return "Unexpected response from server."
            case .http(let code):
                return "Server error (\(code))."
            case .customAuthNotFound:
                return "CustomAuth key not found."
            }
        }
    }

    private let baseURL = URL(string: "https://hrs.comm-it.co.il")!
    private let cache = SecureCache.shared
    private let activity = ActivityMonitor.shared
    private var workLogsCache: [String: CachedValue<[WorkLog]>] = [:]
    private var reportsCache: [String: CachedValue<MonthlyReport>] = [:]
    var cookieHeader: String?
    var customAuth: String?

    private init() {}

    func checkSession() async throws -> Bool {
        let today = Date()
        _ = try await getWorkLogs(date: today, forceRefresh: true)
        Task { await refreshCustomAuthIfPossible() }
        return true
    }

    func getWorkLogs(date: Date, forceRefresh: Bool = false) async throws -> [WorkLog] {
        let dateString = DateFormatter.hrsDate.string(from: date)
        let cacheKey = "workLogs-\(dateString)"
        if !forceRefresh {
            let ttl = activity.adaptiveTTL(for: .workLogs)
            if let cached = workLogsCache[cacheKey], cached.isValid(ttl: ttl) {
                return cached.value
            }
            if let cached: [WorkLog] = cache.load(name: cacheKey, maxAge: ttl) {
                workLogsCache[cacheKey] = CachedValue(value: cached, timestamp: Date())
                return cached
            }
        }
        let url = baseURL.appendingPathComponent("/api/user_work_logs/")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "date", value: dateString)]
        guard let finalURL = components?.url else { throw APIError.invalidResponse }
        let data = try await request(finalURL, requiresCustomAuth: false)
        let decoded = try JSONDecoder.hrs.decode([WorkLog].self, from: data)
        let monthKey = DateFormatter.monthKey.string(from: date)
        workLogsCache[cacheKey] = CachedValue(value: decoded, timestamp: Date())
        cache.save(name: cacheKey, monthKey: monthKey, value: decoded)
        return decoded
    }

    func getReports(start: String, end: String, forceRefresh: Bool = false) async throws -> MonthlyReport {
        let cacheKey = "reports-\(start)-\(end)"
        if !forceRefresh {
            let ttl = activity.adaptiveTTL(for: .reports)
            if let cached = reportsCache[cacheKey], cached.isValid(ttl: ttl) {
                return cached.value
            }
            if let cached: MonthlyReport = cache.load(name: cacheKey, maxAge: ttl) {
                reportsCache[cacheKey] = CachedValue(value: cached, timestamp: Date())
                return cached
            }
        }
        let url = baseURL.appendingPathComponent("/api/getReports/")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "startDate", value: start),
            URLQueryItem(name: "endDate", value: end)
        ]
        guard let finalURL = components?.url else { throw APIError.invalidResponse }
        let data = try await request(finalURL, requiresCustomAuth: true)
        let decoded = try JSONDecoder.hrs.decode(MonthlyReport.self, from: data)
        let startDate = DateFormatter.hrsDate.date(from: start) ?? Date()
        let monthKey = DateFormatter.monthKey.string(from: startDate)
        reportsCache[cacheKey] = CachedValue(value: decoded, timestamp: Date())
        cache.save(name: cacheKey, monthKey: monthKey, value: decoded)
        return decoded
    }

    func logWork(payload: LogWorkPayload) async throws {
        let url = baseURL.appendingPathComponent("/api/log_work/")
        let body = try JSONEncoder.hrs.encode(payload)
        _ = try await request(url, method: "POST", body: body, requiresCustomAuth: true)
    }

    func invalidateCaches(for date: Date) {
        let dateString = DateFormatter.hrsDate.string(from: date)
        let workLogsKey = "workLogs-\(dateString)"
        workLogsCache.removeValue(forKey: workLogsKey)
        cache.delete(name: workLogsKey)

        let range = MonthRange.forDate(date)
        let reportsKey = "reports-\(range.start)-\(range.end)"
        reportsCache.removeValue(forKey: reportsKey)
        cache.delete(name: reportsKey)

        let yearly = MonthRange.last12Months(for: date)
        let yearlyKey = "reports-\(yearly.start)-\(yearly.end)"
        reportsCache.removeValue(forKey: yearlyKey)
        cache.delete(name: yearlyKey)
    }

    func fetchCustomAuth() async throws -> String {
        guard let cookieHeader else { throw APIError.missingSession }
        let url = baseURL.appendingPathComponent("/admin/reactuserreporting/")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("text/html", forHTTPHeaderField: "Accept")
        request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 || http.statusCode == 403 {
            notifySessionInvalid(reason: "Session expired.")
            throw APIError.missingSession
        }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode) }
        guard let html = String(data: data, encoding: .utf8) else { throw APIError.invalidResponse }
        if let key = CustomAuthExtractor.extract(from: html) { return key }
        throw APIError.customAuthNotFound
    }

    private func request(
        _ url: URL,
        method: String = "GET",
        body: Data? = nil,
        requiresCustomAuth: Bool,
        retryOnAuthFailure: Bool = true
    ) async throws -> Data {
        guard let cookieHeader else {
            notifySessionInvalid(reason: "Missing session.")
            throw APIError.missingSession
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
        if requiresCustomAuth {
            if customAuth == nil && retryOnAuthFailure {
                if await refreshCustomAuthIfPossible() {
                    return try await self.request(
                        url,
                        method: method,
                        body: body,
                        requiresCustomAuth: requiresCustomAuth,
                        retryOnAuthFailure: false
                    )
                }
            }
            guard let customAuth else {
                notifySessionInvalid(reason: "Missing CustomAuth.")
                throw APIError.missingCustomAuth
            }
            request.setValue(customAuth, forHTTPHeaderField: "CustomAuth")
        }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 || http.statusCode == 403 {
            notifySessionInvalid(reason: "Session expired.")
            throw APIError.missingSession
        }
        if requiresCustomAuth && http.statusCode == 404 {
            if retryOnAuthFailure, await refreshCustomAuthIfPossible() {
                return try await self.request(
                    url,
                    method: method,
                    body: body,
                    requiresCustomAuth: requiresCustomAuth,
                    retryOnAuthFailure: false
                )
            }
            notifySessionInvalid(reason: "Session expired.")
            throw APIError.missingSession
        }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode) }
        return data
    }

    @discardableResult
    private func refreshCustomAuthIfPossible() async -> Bool {
        guard let cookieHeader else { return false }
        do {
            let newAuth = try await fetchCustomAuth()
            customAuth = newAuth
            SessionStore.shared.save(cookieHeader: cookieHeader, customAuth: newAuth)
            return true
        } catch {
            return false
        }
    }

    private func notifySessionInvalid(reason: String) {
        NotificationCenter.default.post(
            name: .hrsSessionInvalid,
            object: nil,
            userInfo: ["reason": reason]
        )
    }
}

private struct CachedValue<T> {
    let value: T
    let timestamp: Date

    func isValid(ttl: TimeInterval) -> Bool {
        Date().timeIntervalSince(timestamp) < ttl
    }
}

enum MonthRange {
    static func forDate(_ date: Date) -> (start: String, end: String) {
        let calendar = Calendar.current
        let startDate = calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
        let endDate = calendar.date(byAdding: DateComponents(month: 1, day: -1), to: startDate) ?? date
        return (DateFormatter.hrsDate.string(from: startDate), DateFormatter.hrsDate.string(from: endDate))
    }

    static func last12Months(for date: Date) -> (start: String, end: String) {
        let calendar = Calendar.current
        let currentStart = calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
        let startDate = calendar.date(byAdding: .month, value: -11, to: currentStart) ?? currentStart
        let endDate = calendar.date(byAdding: DateComponents(month: 1, day: -1), to: currentStart) ?? date
        return (DateFormatter.hrsDate.string(from: startDate), DateFormatter.hrsDate.string(from: endDate))
    }
}

enum CustomAuthExtractor {
    static func extract(from html: String) -> String? {
        let pattern = "key=([0-9a-fA-F]{20,64})"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(html.startIndex..<html.endIndex, in: html)
        if let match = regex.firstMatch(in: html, range: range), match.numberOfRanges > 1 {
            let keyRange = match.range(at: 1)
            if let range = Range(keyRange, in: html) {
                return String(html[range])
            }
        }
        return nil
    }
}

extension JSONDecoder {
    static let hrs: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .useDefaultKeys
        return decoder
    }()
}

extension JSONEncoder {
    static let hrs: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted]
        return encoder
    }()
}

extension DateFormatter {
    static let hrsDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static let monthKey: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM"
        return formatter
    }()

    static let monthShort: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "MMM"
        return formatter
    }()

    static let monthYear: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "MMMM yyyy"
        return formatter
    }()

    static let hrsTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter
    }()
}
