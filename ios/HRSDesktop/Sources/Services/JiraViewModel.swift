import Foundation

@MainActor
final class JiraViewModel: ObservableObject {
    @Published var email: String
    @Published var token: String
    @Published var baseURL: String
    @Published var projectKey: String
    @Published var epics: [JiraEpic] = []
    @Published var workItemsByEpic: [String: [JiraWorkItem]] = [:]
    @Published var epicSummaries: [String: JiraEpicSummary] = [:]
    @Published var manualEpics: [JiraManualEpic] = []
    @Published var timeTrackingConfig: JiraTimeTrackingConfig? = nil
    @Published var projectStartDates: [String: Date] = [:]
    @Published var projectPeoplePercent: [String: [String: Double]] = [:]
    @Published var isConnected: Bool = false
    @Published var isLoading: Bool = false
    @Published var isLoadingWorkItems: Bool = false
    @Published var isLoadingBudgets: Bool = false
    @Published var errorMessage: String? = nil
    @Published var budgetError: String? = nil
    @Published var mappings: [String: String] = [:]

    private let client = JiraClient.shared
    private let keychain = KeychainStore.shared
    private let defaults = UserDefaults.standard
    private var epicsCache: [JiraEpic] = []
    private var lastEpicsFetch: Date? = nil
    private var epicSummaryFetchDates: [String: Date] = [:]
    private var workItemsFetchDates: [String: Date] = [:]
    private var workItemsCache: [String: JiraWorkItemsCacheEntry] = [:]
    private let workItemsRefreshTTL: TimeInterval = 300

    init() {
        email = defaults.string(forKey: "jiraEmail") ?? ""
        baseURL = defaults.string(forKey: "jiraBaseURL") ?? "https://commit.atlassian.net"
        projectKey = defaults.string(forKey: "jiraProjectKey") ?? "VDA"
        token = keychain.load(key: "jiraToken") ?? ""
        mappings = loadMappings()
        manualEpics = loadManualEpics()
        timeTrackingConfig = loadTimeTrackingConfig()
        projectStartDates = loadProjectStartDates()
        projectPeoplePercent = loadProjectPeoplePercent()
        isConnected = !email.isEmpty && !token.isEmpty && !baseURL.isEmpty
        epicsCache = loadEpicsCache()
        workItemsCache = loadWorkItemsCache()
        if !epicsCache.isEmpty {
            epics = epicsCache
        }
        if !workItemsCache.isEmpty {
            workItemsByEpic = workItemsCache.mapValues { $0.items }
            workItemsFetchDates = workItemsCache.mapValues { $0.fetchedAt }
        }
    }

    func connect() async {
        isLoading = true
        errorMessage = nil
        client.configure(baseURL: baseURL, email: email, token: token)
        do {
            let fetched = try await client.fetchEpics(projectKey: projectKey)
            epics = fetched
            cacheEpics(fetched)
            await refreshTimeTrackingConfig()
            isConnected = true
            saveCredentials()
        } catch {
            errorMessage = readableError(error)
            isConnected = false
        }
        isLoading = false
    }

    func disconnect() {
        isConnected = false
        epics = []
        workItemsByEpic = [:]
        workItemsFetchDates = [:]
        epicSummaries = [:]
        timeTrackingConfig = nil
        token = ""
        keychain.delete(key: "jiraToken")
        workItemsCache = [:]
        defaults.removeObject(forKey: "jiraWorkItemsCache")
    }

    func refreshEpics() async {
        guard isConnected else { return }
        guard shouldRefreshEpics() else {
            epics = epicsCache
            return
        }
        isLoading = true
        errorMessage = nil
        client.configure(baseURL: baseURL, email: email, token: token)
        do {
            let updatedSince = lastEpicsFetch
            let fetched = try await client.fetchEpics(projectKey: projectKey, updatedSince: updatedSince)
            if updatedSince == nil {
                epics = fetched
            } else {
                var merged = epicsCache
                for epic in fetched {
                    if let index = merged.firstIndex(where: { $0.key == epic.key }) {
                        merged[index] = epic
                    } else {
                        merged.append(epic)
                    }
                }
                epics = merged.sorted { $0.key < $1.key }
            }
            cacheEpics(epics)
        } catch {
            errorMessage = readableError(error)
        }
        isLoading = false
    }

    func autoLoadEpics() async {
        guard isConnected else { return }
        if epicsCache.isEmpty {
            await refreshEpics()
        } else {
            epics = epicsCache
        }
        if shouldRefreshEpics() {
            await refreshEpics()
        }
        if timeTrackingConfig == nil {
            await refreshTimeTrackingConfig()
        }
    }

    func preloadAllData() async {
        guard isConnected else { return }
        await autoLoadEpics()
        let keys = Set(
            epics.map { $0.key }
            + mappings.values.filter { !$0.isEmpty }
            + manualEpics.map { $0.epicKey }.filter { !$0.isEmpty }
        )
        let epicKeys = Array(keys).sorted()
        guard !epicKeys.isEmpty else { return }
        await preloadWorkItems(epicKeys: epicKeys)
    }

    private func preloadWorkItems(epicKeys: [String]) async {
        guard isConnected else { return }
        client.configure(baseURL: baseURL, email: email, token: token)
        isLoadingWorkItems = true
        let concurrency = min(4, epicKeys.count)
        var iterator = epicKeys.makeIterator()
        let now = Date()
        let refreshTtl = workItemsRefreshTTL
        let projectKeySnapshot = projectKey
        let cacheSnapshot = workItemsCache
        let fetchDatesSnapshot = workItemsFetchDates
        var results: [String: (items: [JiraWorkItem], fetchedAt: Date)] = [:]
        await withTaskGroup(of: (String, [JiraWorkItem]?, Date?).self) { group in
            func addNext() {
                guard let key = iterator.next() else { return }
                group.addTask {
                    let cached = cacheSnapshot[key]
                    let cachedItems = cached?.items ?? []
                    let cachedDate = cached?.fetchedAt
                    if !cachedItems.isEmpty,
                       let cachedDate,
                       let lastFetch = fetchDatesSnapshot[key],
                       now.timeIntervalSince(lastFetch) <= refreshTtl {
                        return (key, cachedItems, cachedDate)
                    }
                    do {
                        let items = try await JiraClient.shared.fetchWorkItems(
                            projectKey: projectKeySnapshot,
                            epicKey: key,
                            useEpicLink: true,
                            updatedSince: cachedDate
                        )
                        let unique = Dictionary(grouping: items, by: { $0.key })
                            .compactMap { $0.value.first }
                            .sorted { $0.key < $1.key }
                        let merged = cachedDate == nil
                            ? unique
                            : Dictionary(uniqueKeysWithValues: (cachedItems + unique).map { ($0.key, $0) })
                                .map(\.value)
                                .sorted { $0.key < $1.key }
                        return (key, merged, now)
                    } catch {
                        do {
                            let items = try await JiraClient.shared.fetchWorkItems(
                                projectKey: projectKeySnapshot,
                                epicKey: key,
                                useEpicLink: false,
                                updatedSince: cachedDate
                            )
                            let unique = Dictionary(grouping: items, by: { $0.key })
                                .compactMap { $0.value.first }
                                .sorted { $0.key < $1.key }
                            let merged = cachedDate == nil
                                ? unique
                                : Dictionary(uniqueKeysWithValues: (cachedItems + unique).map { ($0.key, $0) })
                                    .map(\.value)
                                    .sorted { $0.key < $1.key }
                            return (key, merged, now)
                        } catch {
                            return (key, cachedItems.isEmpty ? nil : cachedItems, cachedDate)
                        }
                    }
                }
            }
            for _ in 0..<concurrency {
                addNext()
            }
            while let result = await group.next() {
                if let items = result.1, let fetchedAt = result.2 {
                    results[result.0] = (items, fetchedAt)
                }
                addNext()
            }
        }
        for (key, payload) in results {
            workItemsByEpic[key] = payload.items
            workItemsFetchDates[key] = payload.fetchedAt
            workItemsCache[key] = JiraWorkItemsCacheEntry(fetchedAt: payload.fetchedAt, items: payload.items)
        }
        saveWorkItemsCache()
        isLoadingWorkItems = false
    }

    func setMapping(customer: String, epicKey: String?) {
        if let epicKey, !epicKey.isEmpty {
            mappings[customer] = epicKey
        } else {
            mappings.removeValue(forKey: customer)
        }
        saveMappings()
    }

    func addManualEpic(label: String, epicKey: String) {
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedKey = epicKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedLabel.isEmpty, !trimmedKey.isEmpty else { return }
        manualEpics.append(JiraManualEpic(id: UUID(), label: trimmedLabel, epicKey: trimmedKey))
        saveManualEpics()
    }

    func updateManualEpic(id: UUID, epicKey: String?) {
        guard let index = manualEpics.firstIndex(where: { $0.id == id }) else { return }
        if let epicKey, !epicKey.isEmpty {
            manualEpics[index].epicKey = epicKey
        } else {
            manualEpics.remove(at: index)
        }
        saveManualEpics()
    }

    func removeManualEpic(id: UUID) {
        manualEpics.removeAll { $0.id == id }
        saveManualEpics()
    }

    func setProjectStartDate(epicKey: String, date: Date) {
        projectStartDates[epicKey] = date
        saveProjectStartDates()
    }

    func setProjectPersonPercent(epicKey: String, person: String, percent: Double) {
        var entry = projectPeoplePercent[epicKey] ?? [:]
        entry[person] = percent
        projectPeoplePercent[epicKey] = entry
        saveProjectPeoplePercent()
    }

    func clearProjectPersonPercent(epicKey: String, person: String) {
        var entry = projectPeoplePercent[epicKey] ?? [:]
        entry.removeValue(forKey: person)
        projectPeoplePercent[epicKey] = entry
        saveProjectPeoplePercent()
    }

    func mappedEpic(for customer: String?) -> String? {
        guard let customer else { return nil }
        return mappings[customer]
    }

    func addWorklog(issueKey: String, started: Date, seconds: Int, comment: String) async -> Bool {
        isLoading = true
        errorMessage = nil
        client.configure(baseURL: baseURL, email: email, token: token)
        do {
            try await client.addWorklog(issueKey: issueKey, started: started, seconds: seconds, comment: comment)
            isLoading = false
            return true
        } catch {
            errorMessage = readableError(error)
            isLoading = false
            return false
        }
    }

    func loadWorkItems(for epicKey: String, forceRefresh: Bool = false) async {
        guard isConnected else { return }
        let now = Date()
        if !forceRefresh,
           let cached = workItemsByEpic[epicKey],
           !cached.isEmpty,
           !shouldRefreshWorkItems(for: epicKey, now: now) {
            return
        }
        isLoadingWorkItems = true
        errorMessage = nil
        client.configure(baseURL: baseURL, email: email, token: token)
        do {
            let existing = workItemsByEpic[epicKey] ?? workItemsCache[epicKey]?.items ?? []
            let lastFetch = workItemsFetchDates[epicKey]
            let items = try await client.fetchWorkItems(
                projectKey: projectKey,
                epicKey: epicKey,
                useEpicLink: true,
                updatedSince: lastFetch
            )
            let unique = Dictionary(grouping: items, by: { $0.key })
                .compactMap { $0.value.first }
                .sorted { $0.key < $1.key }
            let merged = lastFetch == nil
                ? unique
                : mergeWorkItems(existing: existing, updates: unique)
            workItemsByEpic[epicKey] = merged
            workItemsFetchDates[epicKey] = now
        } catch {
            let message = errorMessageText(from: error)
            if message.contains("Epic Link") {
                do {
                    let existing = workItemsByEpic[epicKey] ?? workItemsCache[epicKey]?.items ?? []
                    let lastFetch = workItemsFetchDates[epicKey]
                    let items = try await client.fetchWorkItems(
                        projectKey: projectKey,
                        epicKey: epicKey,
                        useEpicLink: false,
                        updatedSince: lastFetch
                    )
                    let unique = Dictionary(grouping: items, by: { $0.key })
                        .compactMap { $0.value.first }
                        .sorted { $0.key < $1.key }
                    let merged = lastFetch == nil
                        ? unique
                        : mergeWorkItems(existing: existing, updates: unique)
                    workItemsByEpic[epicKey] = merged
                    workItemsFetchDates[epicKey] = now
                } catch {
                    errorMessage = readableError(error)
                }
            } else {
                errorMessage = readableError(error)
            }
        }
        if let items = workItemsByEpic[epicKey] {
            workItemsCache[epicKey] = JiraWorkItemsCacheEntry(fetchedAt: now, items: items)
            saveWorkItemsCache()
        }
        isLoadingWorkItems = false
    }

    func loadEpicSummaries(for epicKeys: [String]) async {
        guard isConnected else { return }
        let uniqueKeys = Array(Set(epicKeys)).sorted()
        guard !uniqueKeys.isEmpty else { return }
        let now = Date()
        let staleKeys = uniqueKeys.filter { shouldRefreshSummary(for: $0, now: now) }
        guard !staleKeys.isEmpty else { return }
        isLoadingBudgets = true
        budgetError = nil
        client.configure(baseURL: baseURL, email: email, token: token)
        for epicKey in staleKeys {
            do {
                let summary = try await client.fetchEpicSummary(epicKey: epicKey)
                epicSummaries[epicKey] = summary
                epicSummaryFetchDates[epicKey] = now
            } catch {
                budgetError = readableError(error)
            }
        }
        isLoadingBudgets = false
    }

    func refreshTimeTrackingConfig() async {
        guard isConnected else { return }
        client.configure(baseURL: baseURL, email: email, token: token)
        do {
            let config = try await client.fetchTimeTrackingConfig()
            timeTrackingConfig = config
            saveTimeTrackingConfig(config)
        } catch {
            budgetError = readableError(error)
        }
    }

    func workItems(for epicKey: String) -> [JiraWorkItem] {
        workItemsByEpic[epicKey] ?? []
    }

    func epicSummary(for epicKey: String) -> String? {
        epics.first(where: { $0.key == epicKey })?.summary
    }

    private func readableError(_ error: Error) -> String {
        if let jiraError = error as? JiraError {
            switch jiraError {
            case .missingCredentials:
                return "Missing Jira credentials."
            case .invalidURL:
                return "Invalid Jira URL."
            case .invalidIssue:
                return "Missing Jira issue key."
            case .invalidTime:
                return "Invalid worklog duration."
            case .invalidResponse:
                return "Invalid Jira response."
            case .http(let status, let data):
                if let parsed = try? JSONDecoder().decode(JiraErrorResponse.self, from: data) {
                    let message = parsed.errorMessages.joined(separator: " ")
                    return message.isEmpty ? "Jira error \(status)." : message
                }
                return "Jira error \(status)."
            }
        }
        return "Jira error."
    }

    private func errorMessageText(from error: Error) -> String {
        if let jiraError = error as? JiraError {
            switch jiraError {
            case .http(_, let data):
                if let parsed = try? JSONDecoder().decode(JiraErrorResponse.self, from: data) {
                    return parsed.errorMessages.joined(separator: " ")
                }
                return ""
            default:
                return ""
            }
        }
        return ""
    }

    private func saveCredentials() {
        defaults.setValue(email, forKey: "jiraEmail")
        defaults.setValue(baseURL, forKey: "jiraBaseURL")
        defaults.setValue(projectKey, forKey: "jiraProjectKey")
        if !token.isEmpty {
            keychain.save(token, for: "jiraToken")
        }
    }

    private func loadMappings() -> [String: String] {
        guard let data = defaults.data(forKey: "jiraMappings"),
              let mapping = try? JSONDecoder().decode([String: String].self, from: data) else {
            return [:]
        }
        return mapping
    }

    private func saveMappings() {
        guard let data = try? JSONEncoder().encode(mappings) else { return }
        defaults.setValue(data, forKey: "jiraMappings")
    }

    private func loadManualEpics() -> [JiraManualEpic] {
        guard let data = defaults.data(forKey: "jiraManualEpics"),
              let decoded = try? JSONDecoder().decode([JiraManualEpic].self, from: data) else {
            return []
        }
        return decoded
    }

    private func saveManualEpics() {
        guard let data = try? JSONEncoder().encode(manualEpics) else { return }
        defaults.setValue(data, forKey: "jiraManualEpics")
    }

    private func loadTimeTrackingConfig() -> JiraTimeTrackingConfig? {
        guard let data = defaults.data(forKey: "jiraTimeTrackingConfig"),
              let decoded = try? JSONDecoder().decode(JiraTimeTrackingConfig.self, from: data) else {
            return nil
        }
        return decoded
    }

    private func saveTimeTrackingConfig(_ config: JiraTimeTrackingConfig) {
        guard let data = try? JSONEncoder().encode(config) else { return }
        defaults.setValue(data, forKey: "jiraTimeTrackingConfig")
    }

    private func loadProjectStartDates() -> [String: Date] {
        guard let data = defaults.data(forKey: "jiraProjectStartDates"),
              let decoded = try? JSONDecoder().decode([String: Date].self, from: data) else {
            return [:]
        }
        return decoded
    }

    private func saveProjectStartDates() {
        guard let data = try? JSONEncoder().encode(projectStartDates) else { return }
        defaults.setValue(data, forKey: "jiraProjectStartDates")
    }

    private func loadProjectPeoplePercent() -> [String: [String: Double]] {
        guard let data = defaults.data(forKey: "jiraProjectPeoplePercent"),
              let decoded = try? JSONDecoder().decode([String: [String: Double]].self, from: data) else {
            return [:]
        }
        return decoded
    }

    private func saveProjectPeoplePercent() {
        guard let data = try? JSONEncoder().encode(projectPeoplePercent) else { return }
        defaults.setValue(data, forKey: "jiraProjectPeoplePercent")
    }

    private func loadWorkItemsCache() -> [String: JiraWorkItemsCacheEntry] {
        guard let data = defaults.data(forKey: "jiraWorkItemsCache"),
              let decoded = try? JSONDecoder().decode([String: JiraWorkItemsCacheEntry].self, from: data) else {
            return [:]
        }
        return decoded
    }

    private func saveWorkItemsCache() {
        guard let data = try? JSONEncoder().encode(workItemsCache) else { return }
        defaults.setValue(data, forKey: "jiraWorkItemsCache")
    }

    private func mergeWorkItems(existing: [JiraWorkItem], updates: [JiraWorkItem]) -> [JiraWorkItem] {
        var map = Dictionary(uniqueKeysWithValues: existing.map { ($0.key, $0) })
        for item in updates {
            map[item.key] = item
        }
        return map.values.sorted { $0.key < $1.key }
    }

    private func cacheEpics(_ epics: [JiraEpic]) {
        epicsCache = epics
        lastEpicsFetch = Date()
        guard let data = try? JSONEncoder().encode(epics) else { return }
        defaults.setValue(data, forKey: "jiraEpicsCache")
        defaults.setValue(lastEpicsFetch, forKey: "jiraEpicsCacheDate")
    }

    private func loadEpicsCache() -> [JiraEpic] {
        if let date = defaults.object(forKey: "jiraEpicsCacheDate") as? Date {
            lastEpicsFetch = date
        }
        guard let data = defaults.data(forKey: "jiraEpicsCache"),
              let cached = try? JSONDecoder().decode([JiraEpic].self, from: data) else {
            return []
        }
        return cached
    }

    private func shouldRefreshEpics() -> Bool {
        guard let last = lastEpicsFetch else { return true }
        return Date().timeIntervalSince(last) > 3600
    }

    private func shouldRefreshSummary(for epicKey: String, now: Date) -> Bool {
        guard let last = epicSummaryFetchDates[epicKey] else { return true }
        return now.timeIntervalSince(last) > 600
    }

    private func shouldRefreshWorkItems(for epicKey: String, now: Date) -> Bool {
        guard let last = workItemsFetchDates[epicKey] else { return true }
        return now.timeIntervalSince(last) > workItemsRefreshTTL
    }
}

private struct JiraErrorResponse: Codable {
    let errorMessages: [String]
}

private struct JiraWorkItemsCacheEntry: Codable {
    let fetchedAt: Date
    let items: [JiraWorkItem]
}

struct JiraManualEpic: Identifiable, Hashable, Codable {
    let id: UUID
    var label: String
    var epicKey: String
}
