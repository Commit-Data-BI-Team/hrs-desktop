import Foundation

final class ActivityMonitor {
    static let shared = ActivityMonitor()

    enum CacheScope {
        case workLogs
        case reports
    }

    private let queue = DispatchQueue(label: "hrs.activity.monitor")
    private var lastInteraction: Date = Date()

    private init() {}

    func markInteraction() {
        queue.async {
            self.lastInteraction = Date()
        }
    }

    func adaptiveTTL(for scope: CacheScope) -> TimeInterval {
        let idle = Date().timeIntervalSince(lastInteraction) > 120
        switch scope {
        case .workLogs:
            return idle ? 600 : 120
        case .reports:
            return idle ? 900 : 180
        }
    }
}
