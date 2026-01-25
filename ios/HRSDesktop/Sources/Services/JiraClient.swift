import Foundation

struct JiraEpic: Identifiable, Hashable, Codable {
    let id: String
    let key: String
    let summary: String
}

struct JiraEpicSummary: Hashable, Codable {
    let estimateSeconds: Int
    let spentSeconds: Int
}

struct JiraTimeTrackingConfig: Hashable, Codable {
    let hoursPerDay: Int
    let daysPerWeek: Int
}

struct JiraWorklogEntry: Identifiable, Hashable, Codable {
    let id: String
    let started: String?
    let seconds: Int
    let authorName: String?
}

struct JiraWorkItem: Identifiable, Hashable, Codable {
    let id: String
    let key: String
    let summary: String
    let subtasks: [JiraWorkSubtask]
    let timespent: Int
    let estimateSeconds: Int
    let assigneeName: String?
    let statusName: String?
    let lastWorklog: JiraWorklogEntry?
    let worklogs: [JiraWorklogEntry]

    var hasSubtasks: Bool { !subtasks.isEmpty }
}

struct JiraWorkSubtask: Identifiable, Hashable, Codable {
    let id: String
    let key: String
    let summary: String
    let timespent: Int
    let estimateSeconds: Int
    let assigneeName: String?
    let lastWorklog: JiraWorklogEntry?
    let worklogs: [JiraWorklogEntry]
}

final class JiraClient {
    static let shared = JiraClient()

    var baseURL: String = ""
    var email: String = ""
    var token: String = ""

    private init() {}

    func configure(baseURL: String, email: String, token: String) {
        var cleaned = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleaned.contains("://") {
            cleaned = "https://\(cleaned)"
        }
        if cleaned.hasSuffix("/") {
            cleaned.removeLast()
        }
        self.baseURL = cleaned
        self.email = email.trimmingCharacters(in: .whitespacesAndNewlines)
        self.token = token.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func fetchEpics(projectKey: String, updatedSince: Date? = nil) async throws -> [JiraEpic] {
        var jql = "project=\(projectKey) AND issuetype=Epic"
        if let updatedSince {
            let dateString = DateFormatter.jiraJqlDate.string(from: updatedSince)
            jql += " AND updated >= \"\(dateString)\""
        }
        jql += " ORDER BY key"
        let url = URL(string: "\(baseURL)/rest/api/3/search/jql")
        guard let url else { throw JiraError.invalidURL }
        let payload = JiraSearchRequest(jql: jql, fields: ["summary"], maxResults: 200)
        let body = try JSONEncoder().encode(payload)
        let data = try await request(url: url, method: "POST", body: body)
        let response = try JSONDecoder().decode(JiraSearchResponse.self, from: data)
        return response.issues.map { issue in
            JiraEpic(id: issue.id, key: issue.key, summary: issue.fields.summary)
        }
    }

    func fetchWorkItems(
        projectKey: String,
        epicKey: String,
        useEpicLink: Bool,
        updatedSince: Date? = nil
    ) async throws -> [JiraWorkItem] {
        let epicClause = useEpicLink ? "\"Epic Link\" = \(epicKey)" : "parent = \(epicKey)"
        let updatedClause = updatedSince.map { " AND updated >= \"\(formatJqlDate($0))\"" } ?? ""
        let jql = "project=\(projectKey) AND \(epicClause)\(updatedClause) ORDER BY key"
        let url = URL(string: "\(baseURL)/rest/api/3/search/jql")
        guard let url else { throw JiraError.invalidURL }
        let payload = JiraSearchRequest(
            jql: jql,
            fields: ["summary", "subtasks", "assignee", "status", "timetracking", "timeoriginalestimate", "timespent", "worklog"],
            maxResults: 200
        )
        let body = try JSONEncoder().encode(payload)
        let data = try await request(url: url, method: "POST", body: body)
        let response = try JSONDecoder().decode(JiraSearchResponse.self, from: data)
        let subtaskKeys = response.issues.flatMap { issue in
            issue.fields.subtasks?.map(\.key) ?? []
        }
        let subtaskDetails = try await fetchIssueDetails(keys: subtaskKeys)
        let subtaskLookup = Dictionary(uniqueKeysWithValues: subtaskDetails.map { ($0.key, $0) })
        return response.issues.map { issue in
            let subtasks = (issue.fields.subtasks ?? []).map { subtask in
                let detail = subtaskLookup[subtask.key]?.fields
                let worklogs = (detail?.worklog?.worklogs ?? []).map { log in
                    JiraWorklogEntry(
                        id: log.id,
                        started: log.started,
                        seconds: log.timeSpentSeconds ?? 0,
                        authorName: log.author?.displayName
                    )
                }
                let spentFromLogs = worklogs.reduce(0) { $0 + $1.seconds }
                let lastWorklog = worklogs.sorted { ($0.started ?? "") > ($1.started ?? "") }.first
                let timespent =
                    detail?.timespent
                    ?? detail?.timetracking?.timeSpentSeconds
                    ?? spentFromLogs
                let estimateSeconds =
                    detail?.timeoriginalestimate
                    ?? detail?.timetracking?.originalEstimateSeconds
                    ?? 0
                return JiraWorkSubtask(
                    id: subtask.id,
                    key: subtask.key,
                    summary: detail?.summary ?? subtask.fields?.summary ?? subtask.key,
                    timespent: timespent,
                    estimateSeconds: estimateSeconds,
                    assigneeName: detail?.assignee?.displayName ?? subtask.fields?.assignee?.displayName,
                    lastWorklog: lastWorklog,
                    worklogs: worklogs
                )
            }
            let worklogs = (issue.fields.worklog?.worklogs ?? []).map { log in
                JiraWorklogEntry(
                    id: log.id,
                    started: log.started,
                    seconds: log.timeSpentSeconds ?? 0,
                    authorName: log.author?.displayName
                )
            }
            let spentFromLogs = worklogs.reduce(0) { $0 + $1.seconds }
            let lastWorklog = worklogs.sorted { ($0.started ?? "") > ($1.started ?? "") }.first
            let timespent =
                issue.fields.timespent
                ?? issue.fields.timetracking?.timeSpentSeconds
                ?? spentFromLogs
            let estimateSeconds =
                issue.fields.timeoriginalestimate
                ?? issue.fields.timetracking?.originalEstimateSeconds
                ?? 0
            return JiraWorkItem(
                id: issue.id,
                key: issue.key,
                summary: issue.fields.summary,
                subtasks: subtasks,
                timespent: timespent,
                estimateSeconds: estimateSeconds,
                assigneeName: issue.fields.assignee?.displayName,
                statusName: issue.fields.status?.name,
                lastWorklog: lastWorklog,
                worklogs: worklogs
            )
        }
    }

    private func formatJqlDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy/MM/dd HH:mm"
        return formatter.string(from: date)
    }

    private func fetchIssueDetails(keys: [String]) async throws -> [JiraIssue] {
        let uniqueKeys = Array(Set(keys)).sorted()
        guard !uniqueKeys.isEmpty else { return [] }
        let chunkSize = 50
        var results: [JiraIssue] = []
        var index = 0
        while index < uniqueKeys.count {
            let end = min(index + chunkSize, uniqueKeys.count)
            let chunk = uniqueKeys[index..<end]
            let quotedKeys = chunk.map { "\"\($0)\"" }.joined(separator: ",")
            let jql = "issuekey in (\(quotedKeys))"
            let url = URL(string: "\(baseURL)/rest/api/3/search/jql")
            guard let url else { throw JiraError.invalidURL }
            let payload = JiraSearchRequest(
                jql: jql,
                fields: ["summary", "assignee", "timetracking", "timeoriginalestimate", "timespent", "worklog"],
                maxResults: chunk.count
            )
            let body = try JSONEncoder().encode(payload)
            let data = try await request(url: url, method: "POST", body: body)
            let response = try JSONDecoder().decode(JiraSearchResponse.self, from: data)
            results.append(contentsOf: response.issues)
            index = end
        }
        return results
    }

    func fetchEpicSummary(epicKey: String) async throws -> JiraEpicSummary {
        let fields = [
            "aggregatetimetracking",
            "aggregatetimeoriginalestimate",
            "aggregatetimespent",
            "timetracking",
            "timeoriginalestimate",
            "timespent"
        ].joined(separator: ",")
        let url = URL(string: "\(baseURL)/rest/api/3/issue/\(epicKey)?fields=\(fields)")
        guard let url else { throw JiraError.invalidURL }
        let data = try await request(url: url, method: "GET", body: nil)
        let response = try JSONDecoder().decode(JiraIssueSummaryResponse.self, from: data)
        let fieldsData = response.fields
        let estimateSeconds =
            fieldsData.timetracking?.originalEstimateSeconds
            ?? fieldsData.timeoriginalestimate
            ?? fieldsData.aggregatetimetracking?.originalEstimateSeconds
            ?? fieldsData.aggregatetimeoriginalestimate
            ?? 0
        let spentSeconds =
            fieldsData.aggregatetimetracking?.timeSpentSeconds
            ?? fieldsData.aggregatetimespent
            ?? fieldsData.timetracking?.timeSpentSeconds
            ?? fieldsData.timespent
            ?? 0
        return JiraEpicSummary(estimateSeconds: estimateSeconds, spentSeconds: spentSeconds)
    }

    func fetchTimeTrackingConfig() async throws -> JiraTimeTrackingConfig {
        let url = URL(string: "\(baseURL)/rest/api/3/configuration")
        guard let url else { throw JiraError.invalidURL }
        let data = try await request(url: url, method: "GET", body: nil)
        let response = try JSONDecoder().decode(JiraConfigurationResponse.self, from: data)
        let config = response.timeTrackingConfiguration
        return JiraTimeTrackingConfig(
            hoursPerDay: config?.workingHoursPerDay ?? 8,
            daysPerWeek: config?.workingDaysPerWeek ?? 5
        )
    }

    func addWorklog(issueKey: String, started: Date, seconds: Int, comment: String) async throws {
        guard !issueKey.isEmpty else { throw JiraError.invalidIssue }
        guard seconds > 0 else { throw JiraError.invalidTime }
        let url = URL(string: "\(baseURL)/rest/api/3/issue/\(issueKey)/worklog")
        guard let url else { throw JiraError.invalidURL }

        let body = JiraWorklogRequest(
            timeSpentSeconds: seconds,
            started: DateFormatter.jiraDate.string(from: started),
            comment: JiraComment.from(text: comment)
        )
        let data = try JSONEncoder().encode(body)
        _ = try await request(url: url, method: "POST", body: data)
    }

    private func request(url: URL, method: String, body: Data?) async throws -> Data {
        guard !baseURL.isEmpty, !email.isEmpty, !token.isEmpty else {
            throw JiraError.missingCredentials
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let auth = Data("\(email):\(token)".utf8).base64EncodedString()
        request.setValue("Basic \(auth)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw JiraError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw JiraError.http(http.statusCode, data)
        }
        return data
    }
}

enum JiraError: Error {
    case missingCredentials
    case invalidURL
    case invalidResponse
    case invalidIssue
    case invalidTime
    case http(Int, Data)
}

private struct JiraSearchResponse: Codable {
    let issues: [JiraIssue]
}

private struct JiraSearchRequest: Codable {
    let jql: String
    let fields: [String]
    let maxResults: Int
}

private struct JiraIssue: Codable {
    let id: String
    let key: String
    let fields: JiraIssueFields
}

private struct JiraIssueFields: Codable {
    let summary: String
    let subtasks: [JiraSubtaskReference]?
    let timetracking: JiraIssueTimeTracking?
    let timeoriginalestimate: Int?
    let timespent: Int?
    let assignee: JiraIssueAssignee?
    let status: JiraIssueStatus?
    let worklog: JiraWorklogContainer?
}

private struct JiraSubtaskReference: Codable {
    let id: String
    let key: String
    let fields: JiraSubtaskFields?
}

private struct JiraSubtaskFields: Codable {
    let summary: String?
    let assignee: JiraIssueAssignee?
}

private struct JiraIssueAssignee: Codable {
    let displayName: String?
}

private struct JiraIssueStatus: Codable {
    let name: String?
}

private struct JiraIssueTimeTracking: Codable {
    let originalEstimateSeconds: Int?
    let timeSpentSeconds: Int?
}

private struct JiraWorklogContainer: Codable {
    let total: Int?
    let worklogs: [JiraIssueWorklog]?
}

private struct JiraIssueWorklog: Codable {
    let id: String
    let started: String?
    let timeSpentSeconds: Int?
    let author: JiraWorklogAuthor?
}

private struct JiraWorklogAuthor: Codable {
    let displayName: String?
}

private struct JiraIssueSummaryResponse: Codable {
    let fields: JiraIssueSummaryFields
}

private struct JiraIssueSummaryFields: Codable {
    let aggregatetimetracking: JiraIssueTimeTracking?
    let aggregatetimeoriginalestimate: Int?
    let aggregatetimespent: Int?
    let timetracking: JiraIssueTimeTracking?
    let timeoriginalestimate: Int?
    let timespent: Int?
}

private struct JiraConfigurationResponse: Codable {
    let timeTrackingConfiguration: JiraTimeTrackingConfiguration?
}

private struct JiraTimeTrackingConfiguration: Codable {
    let workingHoursPerDay: Int?
    let workingDaysPerWeek: Int?
}

private struct JiraWorklogRequest: Codable {
    let timeSpentSeconds: Int
    let started: String
    let comment: JiraComment
}

private struct JiraComment: Codable {
    let type: String
    let version: Int
    let content: [JiraCommentBlock]

    static func from(text: String) -> JiraComment {
        JiraComment(
            type: "doc",
            version: 1,
            content: [
                JiraCommentBlock(
                    type: "paragraph",
                    content: [JiraCommentText(type: "text", text: text)]
                )
            ]
        )
    }
}

private struct JiraCommentBlock: Codable {
    let type: String
    let content: [JiraCommentText]
}

private struct JiraCommentText: Codable {
    let type: String
    let text: String
}

private extension DateFormatter {
    static let jiraDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
        return formatter
    }()

    static let jiraJqlDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy/MM/dd HH:mm"
        return formatter
    }()
}
