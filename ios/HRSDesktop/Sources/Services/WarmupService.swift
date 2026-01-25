import Foundation

final class WarmupService {
    static let shared = WarmupService()

    private let cache = SecureCache.shared
    private let defaults = UserDefaults.standard
    private let lastRunKey = "hrs.warmup.lastRun"

    private init() {}

    func loadSnapshot(for monthKey: String) -> WarmupSnapshot? {
        cache.load(name: "warmup-\(monthKey)")
    }

    func runIfNeeded(
        workLogs: [WorkLog],
        monthlyReport: MonthlyReport?,
        yearlyReport: MonthlyReport?,
        logDate: Date,
        completion: @escaping @MainActor (WarmupSnapshot) -> Void
    ) {
        guard shouldRun() else { return }
        Task.detached(priority: .utility) { [cache] in
            guard let monthlyReport, let yearlyReport else { return }
            let snapshot = WarmupService.buildSnapshot(
                workLogs: workLogs,
                monthlyReport: monthlyReport,
                yearlyReport: yearlyReport,
                logDate: logDate
            )
            cache.save(name: "warmup-\(snapshot.monthKey)", monthKey: snapshot.monthKey, value: snapshot)
            await MainActor.run {
                completion(snapshot)
            }
            self.defaults.setValue(Date(), forKey: self.lastRunKey)
        }
    }

    private func shouldRun() -> Bool {
        guard let last = defaults.object(forKey: lastRunKey) as? Date else { return true }
        return !Calendar.current.isDateInToday(last)
    }

    private static func buildSnapshot(
        workLogs: [WorkLog],
        monthlyReport: MonthlyReport,
        yearlyReport: MonthlyReport,
        logDate: Date
    ) -> WarmupSnapshot {
        let monthKey = DateFormatter.monthKey.string(from: logDate)
        var calendarMinutes: [String: Int] = [:]
        for day in monthlyReport.days {
            let minutes = day.reports.reduce(0) { partial, entry in
                partial + TimeUtils.minutes(fromHHMM: entry.hoursHHMM)
            }
            calendarMinutes[day.date] = minutes
        }
        let maxDayMinutes = calendarMinutes.values.max() ?? 0

        let calendar = Calendar.current
        let currentStart = calendar.date(from: calendar.dateComponents([.year, .month], from: logDate)) ?? logDate
        let start = calendar.date(byAdding: .month, value: -11, to: currentStart) ?? currentStart
        let monthStarts = (0..<12).compactMap { offset in
            calendar.date(byAdding: .month, value: offset, to: start)
        }
        let trendLabels = monthStarts.map { DateFormatter.monthShort.string(from: $0).uppercased() }
        let monthKeys = monthStarts.map { DateFormatter.monthKey.string(from: $0) }

        var taskLookup: [Int: WorkLog] = [:]
        for log in workLogs {
            if taskLookup[log.taskId] == nil {
                taskLookup[log.taskId] = log
            }
        }

        var hoursByMonth: [String: Int] = [:]
        var clientsByMonth: [String: Set<String>] = [:]
        for day in yearlyReport.days {
            guard let date = DateFormatter.hrsDate.date(from: day.date) else { continue }
            let key = DateFormatter.monthKey.string(from: date)
            for entry in day.reports {
                hoursByMonth[key, default: 0] += TimeUtils.minutes(fromHHMM: entry.hoursHHMM)
                let name = taskLookup[entry.taskId]?.customerName ?? entry.projectInstance
                if !name.isEmpty {
                    clientsByMonth[key, default: []].insert(name)
                }
            }
        }

        let hoursTrend = monthKeys.map { key in
            Double(hoursByMonth[key] ?? 0) / 60.0
        }
        let activeClientsTrend = monthKeys.map { key in
            Double(clientsByMonth[key]?.count ?? 0)
        }

        let weekendDays = parseWeekendDays(from: monthlyReport.weekend)

        return WarmupSnapshot(
            monthKey: monthKey,
            createdAt: Date(),
            calendarMinutes: calendarMinutes,
            maxDayMinutes: maxDayMinutes,
            trendLabels: trendLabels,
            hoursTrend: hoursTrend,
            activeClientsTrend: activeClientsTrend,
            weekendDays: weekendDays
        )
    }

    private static func parseWeekendDays(from weekend: String) -> [Int] {
        let map: [String: Int] = [
            "sun": 1, "mon": 2, "tue": 3, "wed": 4, "thu": 5, "fri": 6, "sat": 7
        ]
        let parts = weekend.lowercased().split(separator: "-").map { String($0.prefix(3)) }
        let values = parts.compactMap { map[$0] }
        return values.isEmpty ? [6, 7] : values
    }
}
