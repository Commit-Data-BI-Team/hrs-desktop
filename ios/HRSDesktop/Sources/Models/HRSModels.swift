import Foundation

struct WorkLog: Codable, Identifiable, Hashable {
    let taskId: Int
    let taskName: String
    let customerName: String
    let projectName: String
    let projectInstance: String?
    let reportingMode: String?
    let commentsRequired: Bool?
    let projectColor: String?
    let isActiveTask: Bool?
    let date: String?

    var id: Int { taskId }

    enum CodingKeys: String, CodingKey {
        case taskId
        case taskName
        case customerName
        case projectName
        case projectInstance
        case reportingMode = "reporting_mode"
        case commentsRequired
        case projectColor
        case isActiveTask
        case date
    }
}

struct WorkReportEntry: Codable, Hashable {
    let taskId: Int
    let taskName: String
    let projectInstance: String
    let hoursHHMM: String
    let comment: String
    let reportingFrom: String

    enum CodingKeys: String, CodingKey {
        case taskId
        case taskName
        case projectInstance
        case hoursHHMM = "hours_HHMM"
        case comment
        case reportingFrom = "reporting_from"
    }
}

struct WorkReportDay: Codable {
    let date: String
    let minWorkLog: Int
    let isHoliday: Bool
    let reports: [WorkReportEntry]
}

struct MonthlyReport: Codable {
    let totalHoursNeeded: Double
    let totalHours: Double
    let closedDate: String
    let totalDays: Int
    let days: [WorkReportDay]
    let weekend: String

    enum CodingKeys: String, CodingKey {
        case totalHoursNeeded
        case totalHours
        case closedDate = "closed_date"
        case totalDays
        case days
        case weekend
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let doubleValue = try? container.decode(Double.self, forKey: .totalHoursNeeded) {
            totalHoursNeeded = doubleValue
        } else if let stringValue = try? container.decode(String.self, forKey: .totalHoursNeeded),
                  let parsed = Double(stringValue) {
            totalHoursNeeded = parsed
        } else {
            totalHoursNeeded = 0
        }
        totalDays = (try? container.decode(Int.self, forKey: .totalDays)) ?? 0
        closedDate = (try? container.decode(String.self, forKey: .closedDate)) ?? ""
        weekend = (try? container.decode(String.self, forKey: .weekend)) ?? "Fri-Sat"
        days = (try? container.decode([WorkReportDay].self, forKey: .days)) ?? []

        if let doubleValue = try? container.decode(Double.self, forKey: .totalHours) {
            totalHours = doubleValue
        } else if let stringValue = try? container.decode(String.self, forKey: .totalHours),
                  let parsed = Double(stringValue) {
            totalHours = parsed
        } else {
            totalHours = 0
        }
    }
}

struct LogWorkItem: Codable {
    let id: Int
    let from: String
    let to: String
    let hoursHHMM: String
    let hours: Double
    let comment: String
    let notSaved: Bool
    let reportingFrom: String
    let taskId: Int

    enum CodingKeys: String, CodingKey {
        case id
        case from
        case to
        case hoursHHMM = "hours_HHMM"
        case hours
        case comment
        case notSaved
        case reportingFrom = "reporting_from"
        case taskId
    }
}

struct LogWorkPayload: Codable {
    let date: String
    let workLogs: [LogWorkItem]
}
