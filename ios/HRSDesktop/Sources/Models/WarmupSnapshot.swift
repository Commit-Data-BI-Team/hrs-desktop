import Foundation

struct WarmupSnapshot: Codable {
    let monthKey: String
    let createdAt: Date
    let calendarMinutes: [String: Int]
    let maxDayMinutes: Int
    let trendLabels: [String]
    let hoursTrend: [Double]
    let activeClientsTrend: [Double]
    let weekendDays: [Int]
}
