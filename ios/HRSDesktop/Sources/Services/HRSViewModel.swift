import Foundation
import UIKit

@MainActor
final class HRSViewModel: ObservableObject {
    @Published var workLogs: [WorkLog] = []
    @Published var monthlyReport: MonthlyReport? = nil
    @Published var yearlyReport: MonthlyReport? = nil
    @Published var selectedTaskId: Int? = nil
    @Published var logDate: Date = Date()
    @Published var fromTime: Date = Date()
    @Published var toTime: Date = Date()
    @Published var reportingFrom: String = "OFFICE"
    @Published var reportingFromOptions: [String] = ["OFFICE", "HOME", "CLIENT"]
    @Published var comment: String = ""
    @Published var isLoading: Bool = false
    @Published var errorMessage: String? = nil
    @Published var successMessage: String? = nil
    @Published var warmupSnapshot: WarmupSnapshot? = nil
    @Published var loadingStage: String = "Preparing your workspace…"
    @Published var hasLoaded: Bool = false

    private let api = APIClient.shared
    private var loadedMonthKey: String? = nil
    private var monthlyReportsByKey: [String: MonthlyReport] = [:]
    private let recentPrefetchCount = 6
    private let defaultReportingFromOptions = ["OFFICE", "HOME", "CLIENT"]

    init() {
        let calendar = Calendar.current
        let start = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: Date()) ?? Date()
        let end = calendar.date(bySettingHour: 18, minute: 0, second: 0, of: Date()) ?? Date()
        fromTime = start
        toTime = end
        warmupSnapshot = WarmupService.shared.loadSnapshot(
            for: DateFormatter.monthKey.string(from: Date())
        )
    }

    func load(forceRefresh: Bool = false) async {
        if hasLoaded && !forceRefresh { return }
        isLoading = true
        errorMessage = nil
        loadingStage = forceRefresh ? "Refreshing logs and reports…" : "Loading logs and reports…"
        ActivityMonitor.shared.markInteraction()
        do {
            let today = Date()
            let monthRange = MonthRange.forDate(today)
            let yearRange = MonthRange.last12Months(for: today)

            async let logsTask = api.getWorkLogs(date: today, forceRefresh: forceRefresh)
            async let monthlyTask = api.getReports(start: monthRange.start, end: monthRange.end, forceRefresh: forceRefresh)
            async let yearlyTask = api.getReports(start: yearRange.start, end: yearRange.end, forceRefresh: forceRefresh)

            workLogs = try await logsTask
            loadingStage = "Loading monthly reports…"
            monthlyReport = try await monthlyTask
            let currentMonthKey = DateFormatter.monthKey.string(from: today)
            if let monthlyReport {
                monthlyReportsByKey[currentMonthKey] = monthlyReport
                updateReportingFromOptions(with: monthlyReport)
            }
            loadingStage = "Loading yearly trend…"
            yearlyReport = try await yearlyTask
            loadedMonthKey = currentMonthKey
            if selectedTaskId == nil {
                let uniqueTasks = Set(workLogs.map { $0.taskId })
                if uniqueTasks.count == 1 {
                    selectedTaskId = uniqueTasks.first
                }
            }
            loadingStage = "Prefetching recent months…"
            await prefetchMonthlyReports(monthsBack: recentPrefetchCount, from: today)
            loadingStage = "Finalizing…"
            WarmupService.shared.runIfNeeded(
                workLogs: workLogs,
                monthlyReport: monthlyReport,
                yearlyReport: yearlyReport,
                logDate: logDate
            ) { [weak self] snapshot in
                self?.warmupSnapshot = snapshot
            }
        } catch {
            errorMessage = error.localizedDescription
            loadingStage = "Failed to load data."
        }
        hasLoaded = true
        isLoading = false
    }

    func reset() {
        workLogs = []
        monthlyReport = nil
        yearlyReport = nil
        selectedTaskId = nil
        comment = ""
        errorMessage = nil
        successMessage = nil
        warmupSnapshot = nil
        loadingStage = "Preparing your workspace…"
        hasLoaded = false
        loadedMonthKey = nil
        monthlyReportsByKey = [:]
        reportingFrom = "OFFICE"
        reportingFromOptions = defaultReportingFromOptions
    }

    func loadMonthlyReport(for date: Date) async {
        let key = DateFormatter.monthKey.string(from: date)
        if let cached = monthlyReportsByKey[key] {
            monthlyReport = cached
            loadedMonthKey = key
            return
        }
        guard key != loadedMonthKey else { return }
        let range = MonthRange.forDate(date)
        do {
            let report = try await api.getReports(start: range.start, end: range.end)
            monthlyReport = report
            monthlyReportsByKey[key] = report
            loadedMonthKey = key
            updateReportingFromOptions(with: report)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @discardableResult
    func logWork() async -> Bool {
        ActivityMonitor.shared.markInteraction()
        guard let selectedTaskId else {
            errorMessage = "Select a task."
            notify(.error)
            return false
        }
        let duration = TimeUtils.duration(from: fromTime, to: toTime)
        guard duration.minutes > 0 else {
            errorMessage = "Enter a valid time range."
            notify(.error)
            return false
        }
        guard comment.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3 else {
            errorMessage = "Add a short comment."
            notify(.error)
            return false
        }
        errorMessage = nil
        successMessage = nil
        do {
            let existing = existingReports(for: logDate)
            let newItem = LogWorkItem(
                id: Int(Date().timeIntervalSince1970),
                from: DateFormatter.hrsTime.string(from: fromTime),
                to: DateFormatter.hrsTime.string(from: toTime),
                hoursHHMM: duration.hoursHHMM,
                hours: duration.hours,
                comment: comment,
                notSaved: true,
                reportingFrom: reportingFrom,
                taskId: selectedTaskId
            )
            let payload = LogWorkPayload(
                date: DateFormatter.hrsDate.string(from: logDate),
                workLogs: existing + [newItem]
            )
            try await api.logWork(payload: payload)
            successMessage = "Logged successfully."
            comment = ""
            notify(.success)
            api.invalidateCaches(for: logDate)
            await load()
            return true
        } catch {
            errorMessage = error.localizedDescription
            notify(.error)
            return false
        }
    }

    var taskOptions: [WorkLog] {
        var seen: Set<Int> = []
        let unique = workLogs.filter { seen.insert($0.taskId).inserted }
        return unique.sorted { lhs, rhs in
            lhs.projectName + lhs.customerName + lhs.taskName < rhs.projectName + rhs.customerName + rhs.taskName
        }
    }

    var totalHoursText: String {
        let value = monthlyReport?.totalHours ?? 0
        return String(format: "%.1f", value)
    }

    var activeClientsCount: Int {
        let clients = workLogs.map { $0.customerName }
        return Set(clients).count
    }

    func taskLabel(for log: WorkLog) -> String {
        "\(log.projectName) · \(log.customerName) · \(log.taskName)"
    }

    private func notify(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(type)
    }

    private func existingReports(for date: Date) -> [LogWorkItem] {
        guard let report = report(for: date) else { return [] }
        let dateKey = DateFormatter.hrsDate.string(from: date)
        let dayReports = report.days.first { $0.date == dateKey }?.reports ?? []
        return dayReports.enumerated().map { index, report in
            let minutes = TimeUtils.minutes(fromHHMM: report.hoursHHMM)
            let hours = Double(minutes) / 60.0
            return LogWorkItem(
                id: Int(Date().timeIntervalSince1970) + index,
                from: "00:00",
                to: TimeUtils.hhmm(fromMinutes: minutes),
                hoursHHMM: report.hoursHHMM,
                hours: (hours * 100).rounded() / 100,
                comment: report.comment,
                notSaved: true,
                reportingFrom: report.reportingFrom,
                taskId: report.taskId
            )
        }
    }

    private func updateReportingFromOptions(with report: MonthlyReport?) {
        var values = Set<String>()
        if let report {
            for day in report.days {
                for entry in day.reports {
                    if !entry.reportingFrom.isEmpty {
                        values.insert(entry.reportingFrom)
                    }
                }
            }
        }
        values.formUnion(defaultReportingFromOptions)
        values.insert(reportingFrom)
        reportingFromOptions = Array(values).sorted()
    }

    private func prefetchMonthlyReports(monthsBack: Int, from date: Date) async {
        guard monthsBack > 0 else { return }
        let calendar = Calendar.current
        let start = calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
        let months = (0..<monthsBack).compactMap { offset in
            calendar.date(byAdding: .month, value: -offset, to: start)
        }

        await withTaskGroup(of: (String, MonthlyReport)?.self) { group in
            for monthDate in months {
                let key = DateFormatter.monthKey.string(from: monthDate)
                if monthlyReportsByKey[key] != nil { continue }
                let range = MonthRange.forDate(monthDate)
                group.addTask { [api] in
                    do {
                        let report = try await api.getReports(start: range.start, end: range.end)
                        return (key, report)
                    } catch {
                        return nil
                    }
                }
            }

            for await result in group {
                if let (key, report) = result {
                    monthlyReportsByKey[key] = report
                }
            }
        }
    }

    private func report(for date: Date) -> MonthlyReport? {
        let monthKey = DateFormatter.monthKey.string(from: date)
        if let cached = monthlyReportsByKey[monthKey] {
            return cached
        }
        if let monthlyReport, reportMatchesMonth(monthlyReport, monthKey: monthKey) {
            return monthlyReport
        }
        if let yearlyReport, reportMatchesMonth(yearlyReport, monthKey: monthKey) {
            return yearlyReport
        }
        return monthlyReport ?? yearlyReport
    }

    private func reportMatchesMonth(_ report: MonthlyReport, monthKey: String) -> Bool {
        report.days.contains { $0.date.hasPrefix("\(monthKey)-") }
    }
}

enum TimeUtils {
    static func duration(from start: Date, to end: Date) -> (minutes: Int, hours: Double, hoursHHMM: String) {
        let delta = max(0, Int(end.timeIntervalSince(start)))
        let minutes = delta / 60
        let hours = Double(minutes) / 60.0
        return (minutes, hours, hhmm(fromMinutes: minutes))
    }

    static func minutes(fromHHMM value: String) -> Int {
        let parts = value.split(separator: ":").map { Int($0) ?? 0 }
        guard parts.count == 2 else { return 0 }
        return parts[0] * 60 + parts[1]
    }

    static func hhmm(fromMinutes minutes: Int) -> String {
        let h = minutes / 60
        let m = minutes % 60
        return String(format: "%02d:%02d", h, m)
    }
}
