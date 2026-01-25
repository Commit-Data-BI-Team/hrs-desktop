import SwiftUI

struct JiraView: View {
    @EnvironmentObject var jira: JiraViewModel
    @EnvironmentObject var hrs: HRSViewModel
    @State private var selectedMappingCustomer: String? = nil
    @State private var showMappingSheet = false
    @State private var epicSearch = ""
    @State private var manualEpicSearch = ""
    @AppStorage("jiraActiveOnly") private var activeOnly = false
    @State private var cachedCustomers: [String] = []
    @State private var cachedActiveCustomers: Set<String> = []
    @AppStorage("jiraAlertsExpanded") private var isAlertsExpanded = true
    @AppStorage("jiraBudgetsExpanded") private var isBudgetsExpanded = true
    @AppStorage("jiraMappingExpanded") private var isMappingExpanded = true
    @State private var didInitialLoad = false
    @AppStorage("jiraBudgetViewMode") private var budgetViewModeRaw = BudgetViewMode.budgets.rawValue
    @AppStorage("jiraShowHours") private var showHours = true
    @AppStorage("jiraSortByProgress") private var sortByProgress = false
    @State private var expandedEpics: Set<String> = []
    @State private var showManualEpicSheet = false
    @State private var selectedPersonFilter: String = "All"
    @State private var isLoadingPeopleView = false
    @State private var didLoadAlertItems = false
    @State private var selectedPersonTrend: PersonTrendSelection? = nil
    @State private var selectedHistoryTask: JiraWorkItem? = nil
    @AppStorage("hrs.oledEnabled") private var oledEnabled = false
    @State private var personStatsCache: [PersonLogStats] = []
    @State private var lastAlertsRefresh: Date = .distantPast

    var body: some View {
        ZStack {
            AppBackground()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    header
                    if jira.isConnected {
                        connectedSection
                        alertsSection
                        budgetsSection
                        mappingSection
                    } else {
                        credentialsSection
                    }
                }
                .padding()
            }
            .scrollIndicators(.hidden)
        }
        .task {
            guard !didInitialLoad else { return }
            didInitialLoad = true
            refreshCustomerCaches()
            if jira.isConnected {
                if jira.epics.isEmpty {
                    await jira.autoLoadEpics()
                }
                await refreshAlertWorkItemsIfNeeded(force: false)
            }
            updatePersonStats()
        }
        .onReceive(hrs.$workLogs) { _ in
            refreshCustomerCaches()
        }
        .onReceive(hrs.$monthlyReport) { _ in
            refreshCustomerCaches()
        }
        .onChange(of: jira.isConnected) { connected in
            if connected {
                Task {
                    await refreshBudgetsAndWorkItems()
                    await refreshAlertWorkItemsIfNeeded(force: true)
                }
            }
        }
        .onChange(of: jira.mappings) { _ in
            Task {
                await refreshBudgetsAndWorkItems()
                await refreshAlertWorkItemsIfNeeded(force: true)
            }
        }
        .onChange(of: jira.manualEpics) { _ in
            Task {
                await refreshBudgetsAndWorkItems()
                await refreshAlertWorkItemsIfNeeded(force: true)
            }
        }
        .onChange(of: isAlertsExpanded) { isExpanded in
            guard isExpanded else { return }
            Task { await refreshAlertWorkItemsIfNeeded(force: true) }
        }
        .onReceive(jira.$workItemsByEpic) { _ in
            updatePersonStats()
        }
        .onChange(of: budgetViewModeRaw) { rawValue in
            let mode = BudgetViewMode(rawValue: rawValue) ?? .budgets
            if mode == .people {
                Task { await loadPeopleViewData() }
            }
        }
        .sheet(item: $selectedPersonTrend) { selection in
            PersonTrendSheet(stats: selection.stats)
        }
        .sheet(item: $selectedHistoryTask) { task in
            HistoryLogsSheet(task: task)
        }
        .sheet(isPresented: $showMappingSheet, onDismiss: {
            selectedMappingCustomer = nil
            epicSearch = ""
        }) {
            if let customer = selectedMappingCustomer {
                JiraEpicSelectionSheet(
                    customer: customer,
                    epics: sortedEpics,
                    selectedKey: jira.mappings[customer],
                    searchText: $epicSearch
                ) { epicKey in
                    jira.setMapping(customer: customer, epicKey: epicKey)
                    epicSearch = ""
                    showMappingSheet = false
                }
            } else {
                Text("No customer selected.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding()
            }
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            PageHeader(
                title: "Jira Integration",
                subtitle: "Connect your Jira account and map HRS customers to epics."
            )
            ThemeToggle(oledEnabled: $oledEnabled)
        }
    }

    private var credentialsSection: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("Connect Jira")
                    .font(.headline)
                TextField("Base URL", text: $jira.baseURL)
                    .textInputAutocapitalization(.never)
                    .textFieldStyle(.roundedBorder)
                TextField("Project key (e.g., VDA)", text: $jira.projectKey)
                    .textInputAutocapitalization(.never)
                    .textFieldStyle(.roundedBorder)
                TextField("Email", text: $jira.email)
                    .textInputAutocapitalization(.never)
                    .textFieldStyle(.roundedBorder)
                SecureField("API token", text: $jira.token)
                    .textFieldStyle(.roundedBorder)

                if let error = jira.errorMessage {
                    errorBanner(error)
                }

                Button {
                    Task { await jira.connect() }
                } label: {
                    Text(jira.isLoading ? "Connecting..." : "Connect")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(jira.email.isEmpty || jira.token.isEmpty || jira.baseURL.isEmpty || jira.projectKey.isEmpty)
            }
        }
    }

    private var budgetsSection: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center, spacing: 12) {
                    Text("Jira project budgets")
                        .font(.headline)
                    Spacer()
                    if isBudgetsExpanded {
                        Button {
                            showManualEpicSheet = true
                        } label: {
                            Image(systemName: "plus")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Color(red: 0.35, green: 0.7, blue: 1.0))
                                .frame(width: 30, height: 30)
                                .background(
                                    Circle()
                                        .fill(Color.white.opacity(oledEnabled ? 0.05 : 0.1))
                                )
                        }
                        .buttonStyle(.plain)
                        .disabled(!jira.isConnected)
                        .accessibilityLabel("Add manual epic")
                    }
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            isBudgetsExpanded.toggle()
                        }
                    } label: {
                        Image(systemName: isBudgetsExpanded ? "chevron.up" : "chevron.down")
                            .font(.footnote.weight(.semibold))
                    }
                    .buttonStyle(.plain)
                }

                if !isBudgetsExpanded {
                    budgetsCollapsedKpis
                } else {
                    Picker("View", selection: $budgetViewModeRaw) {
                        ForEach(BudgetViewMode.allCases, id: \.self) { mode in
                            Text(mode.title).tag(mode.rawValue)
                        }
                    }
                    .pickerStyle(.segmented)

                    HStack(spacing: 12) {
                        Toggle("Show hours", isOn: $showHours)
                            .toggleStyle(.switch)
                        Toggle("Sort by progress", isOn: $sortByProgress)
                            .toggleStyle(.switch)
                    }

                    if let error = jira.budgetError {
                        errorBanner(error)
                    }

                    if budgetItems.isEmpty {
                        Text("Map customers or add manual epics to see budgets.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else if budgetViewModeValue == .people {
                        peopleViewSection
                    } else {
                        budgetListSection
                    }
                }
            }
        }
        .sheet(isPresented: $showManualEpicSheet) {
            ManualEpicAddSheet(
                epics: sortedEpics,
                searchText: $manualEpicSearch
            ) { label, epicKey in
                jira.addManualEpic(label: label, epicKey: epicKey)
            }
        }
    }

    private var connectedSection: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("Connected", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(.green)
                    Spacer()
                    Button("Disconnect") {
                        jira.disconnect()
                    }
                    .foregroundStyle(.red)
                }
                Text("\(jira.email) · \(jira.baseURL) · \(jira.projectKey)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                if let error = jira.errorMessage {
                    errorBanner(error)
                }
            }
        }
    }

    private var budgetViewModeValue: BudgetViewMode {
        BudgetViewMode(rawValue: budgetViewModeRaw) ?? .budgets
    }

    private var mappingSection: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center, spacing: 12) {
                    Text("Jira client mapping")
                        .font(.headline)
                    Spacer()
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            isMappingExpanded.toggle()
                        }
                    } label: {
                        Image(systemName: isMappingExpanded ? "chevron.up" : "chevron.down")
                            .font(.footnote.weight(.semibold))
                    }
                    .buttonStyle(.plain)
                }

                if !isMappingExpanded {
                    mappingCollapsedKpis
                } else {
                    Toggle("Only active clients", isOn: $activeOnly)
                        .toggleStyle(.switch)
                        .tint(Color(red: 0.35, green: 0.7, blue: 1.0))
                    if filteredCustomers.isEmpty {
                        Text(activeOnly ? "No customers with hours this month." : "No customers available yet.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(filteredCustomers, id: \.self) { customer in
                                Button {
                                    selectedMappingCustomer = customer
                                    showMappingSheet = true
                                } label: {
                                    HStack(spacing: 12) {
                                        Text(customer)
                                            .font(.subheadline)
                                            .lineLimit(1)
                                        Spacer()
                                        Text(mappingLabel(for: customer))
                                            .font(.footnote)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                        Image(systemName: "chevron.right")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    .padding(.vertical, 8)
                                }
                                .buttonStyle(.plain)
                                .contentShape(Rectangle())
                                Divider()
                                    .background(surfaceStroke)
                            }
                        }
                    }
                }
            }
        }
    }

    private var filteredCustomers: [String] {
        guard activeOnly else { return cachedCustomers }
        return cachedCustomers.filter { cachedActiveCustomers.contains($0) }
    }

    private var sortedEpics: [JiraEpic] {
        jira.epics.sorted { $0.key < $1.key }
    }

    private var budgetItems: [BudgetEpicItem] {
        var items: [BudgetEpicItem] = []
        let mapped = jira.mappings.sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
        for (customer, epicKey) in mapped where !epicKey.isEmpty {
            items.append(
                BudgetEpicItem(
                    id: "mapped-\(customer)",
                    label: customer,
                    epicKey: epicKey,
                    isManual: false,
                    manualId: nil
                )
            )
        }
        for manual in jira.manualEpics {
            items.append(
                BudgetEpicItem(
                    id: "manual-\(manual.id.uuidString)",
                    label: manual.label,
                    epicKey: manual.epicKey,
                    isManual: true,
                    manualId: manual.id
                )
            )
        }
        return items
    }

    private var sortedBudgetItems: [BudgetEpicItem] {
        guard sortByProgress else { return budgetItems }
        return budgetItems.sorted { lhs, rhs in
            let leftSummary = jira.epicSummaries[lhs.epicKey]
            let rightSummary = jira.epicSummaries[rhs.epicKey]
            let leftKey = progressSortKey(
                spentSeconds: leftSummary?.spentSeconds ?? 0,
                estimateSeconds: leftSummary?.estimateSeconds ?? 0
            )
            let rightKey = progressSortKey(
                spentSeconds: rightSummary?.spentSeconds ?? 0,
                estimateSeconds: rightSummary?.estimateSeconds ?? 0
            )
            return compareProgress(left: leftKey, right: rightKey)
        }
    }

    private var budgetEpicKeys: [String] {
        Array(Set(budgetItems.map { $0.epicKey }))
    }

    private var surfaceFillStrong: Color {
        oledEnabled ? Color.black.opacity(0.78) : Color.white.opacity(0.04)
    }

    private var surfaceFill: Color {
        oledEnabled ? Color.black.opacity(0.75) : Color.white.opacity(0.03)
    }

    private var surfaceFillSoft: Color {
        oledEnabled ? Color.black.opacity(0.7) : Color.white.opacity(0.02)
    }

    private var surfaceStroke: Color {
        Color.white.opacity(oledEnabled ? 0.08 : 0.06)
    }

    private var surfaceStrokeSoft: Color {
        Color.white.opacity(oledEnabled ? 0.07 : 0.05)
    }

    private func mappingLabel(for customer: String) -> String {
        jira.mappings[customer] ?? "Unmapped"
    }

    private func refreshBudgetsAndWorkItems() async {
        await preloadAlertWorkItems()
    }

    private func preloadAlertWorkItems() async {
        guard jira.isConnected else { return }
        guard !didLoadAlertItems else { return }
        didLoadAlertItems = true
        for epicKey in budgetEpicKeys {
            await jira.loadWorkItems(for: epicKey)
        }
    }

    private func refreshAlertWorkItemsIfNeeded(force: Bool) async {
        guard jira.isConnected else { return }
        let now = Date()
        let minInterval: TimeInterval = force ? 30 : 120
        guard now.timeIntervalSince(lastAlertsRefresh) > minInterval else { return }
        lastAlertsRefresh = now
        for epicKey in budgetEpicKeys {
            await jira.loadWorkItems(for: epicKey, forceRefresh: force)
        }
    }

    private var budgetListSection: some View {
        LazyVStack(alignment: .leading, spacing: 12) {
            if jira.isLoadingBudgets {
                ProgressView("Checking Jira estimates...")
                    .font(.footnote)
            }
            ForEach(sortedBudgetItems) { item in
                budgetRow(for: item)
            }
        }
    }

    private var alertsSection: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Jira activity alerts")
                        .font(.headline)
                    Spacer()
                    if isAlertsExpanded {
                        Text("Last 24h")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            isAlertsExpanded.toggle()
                        }
                    } label: {
                        Image(systemName: isAlertsExpanded ? "chevron.up" : "chevron.down")
                            .font(.footnote.weight(.semibold))
                    }
                    .buttonStyle(.plain)
                }

                if !isAlertsExpanded {
                    alertsCollapsedKpis
                } else if personStats.isEmpty {
                    Text("No Jira worklogs loaded yet.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    LazyVStack(spacing: 10) {
                        ForEach(personStats) { stats in
                            let isMissing = isMissingLast24h(stats)
                            Button {
                                selectedPersonTrend = PersonTrendSelection(stats: stats)
                            } label: {
                                EquatableView(
                                    content: AlertRowContent(
                                        name: stats.name,
                                        lastLogLabel: stats.lastLogLabel,
                                        isMissing: isMissing,
                                        oledEnabled: oledEnabled
                                    )
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    private var alertsSummaryText: String {
        if personStats.isEmpty {
            return "No Jira worklogs loaded yet."
        }
        if missingJiraPeople.isEmpty {
            return "Everyone logged work in the last 24h."
        }
        return "\(missingJiraPeople.count) missing of \(personStats.count) people."
    }

    private var alertsCollapsedKpis: some View {
        let total = personStats.count
        let missing = missingJiraPeople.count
        let ok = max(total - missing, 0)
        return HStack(spacing: 10) {
            miniKpiCard(title: "Missing", value: "\(missing)", detail: "Last 24h")
            miniKpiCard(title: "OK", value: "\(ok)", detail: "Logged")
            miniKpiCard(title: "People", value: "\(total)", detail: "Tracked")
        }
    }

    private var budgetSummaryText: String {
        let total = budgetItems.count
        guard total > 0 else { return "Map customers or add manual epics to see budgets." }
        var overBudget = 0
        var noEstimate = 0
        for item in budgetItems {
            guard let summary = jira.epicSummaries[item.epicKey] else { continue }
            if summary.estimateSeconds <= 0 {
                noEstimate += 1
                continue
            }
            let ratio = Double(summary.spentSeconds) / Double(summary.estimateSeconds)
            if ratio >= 1 {
                overBudget += 1
            }
        }
        var parts = ["\(total) epics"]
        if overBudget > 0 {
            parts.append("\(overBudget) over budget")
        }
        if noEstimate > 0 {
            parts.append("\(noEstimate) no estimate")
        }
        return parts.joined(separator: " · ")
    }

    private var budgetSummaryCounts: (total: Int, overBudget: Int, noEstimate: Int, pending: Int) {
        var overBudget = 0
        var noEstimate = 0
        var pending = 0
        for item in budgetItems {
            guard let summary = jira.epicSummaries[item.epicKey] else {
                pending += 1
                continue
            }
            if summary.estimateSeconds <= 0 {
                noEstimate += 1
                continue
            }
            let ratio = Double(summary.spentSeconds) / Double(summary.estimateSeconds)
            if ratio >= 1 {
                overBudget += 1
            }
        }
        return (budgetItems.count, overBudget, noEstimate, pending)
    }

    private var budgetsCollapsedKpis: some View {
        let counts = budgetSummaryCounts
        let pendingDetail = counts.pending > 0 ? "Pending \(counts.pending)" : nil
        return HStack(spacing: 10) {
            miniKpiCard(title: "Epics", value: "\(counts.total)", detail: pendingDetail)
            miniKpiCard(title: "Over", value: "\(counts.overBudget)", detail: "Budget")
            miniKpiCard(title: "No Est", value: "\(counts.noEstimate)", detail: "Set")
        }
    }

    private var mappingSummaryText: String {
        let total = filteredCustomers.count
        if total == 0 {
            return activeOnly ? "No customers with hours this month." : "No customers available yet."
        }
        let mapped = filteredCustomers.filter { !(jira.mappings[$0] ?? "").isEmpty }.count
        return "\(mapped) of \(total) customers mapped."
    }

    private var mappingCollapsedKpis: some View {
        let total = filteredCustomers.count
        let mapped = filteredCustomers.filter { !(jira.mappings[$0] ?? "").isEmpty }.count
        let unmapped = max(total - mapped, 0)
        let active = cachedActiveCustomers.count
        return HStack(spacing: 10) {
            miniKpiCard(title: "Mapped", value: "\(mapped)", detail: "of \(total)")
            miniKpiCard(title: "Unmapped", value: "\(unmapped)", detail: "Remaining")
            miniKpiCard(title: "Active", value: "\(active)", detail: "This month")
        }
    }

    private var peopleViewSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if isLoadingPeopleView {
                ProgressView("Loading Jira tasks...")
                    .font(.footnote)
            }

            if !peopleOptions.isEmpty {
                Picker("Filter", selection: $selectedPersonFilter) {
                    ForEach(peopleOptions, id: \.self) { option in
                        Text(option).tag(option)
                    }
                }
                .pickerStyle(.menu)
            }

            if peopleGroups.isEmpty {
                Text("Load Jira tasks to see people view.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Load Jira tasks") {
                    Task { await loadPeopleViewData() }
                }
                .buttonStyle(.bordered)
            } else {
                ForEach(peopleGroups) { group in
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(group.tasks, id: \.id) { task in
                                taskRow(task.item, epicKey: task.epicKey)
                            }
                        }
                        .padding(.top, 6)
                    } label: {
                        HStack {
                            Text(group.name)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(formatDuration(seconds: group.totalSeconds))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private func budgetRow(for item: BudgetEpicItem) -> some View {
        let summary = jira.epicSummaries[item.epicKey]
        let spent = summary?.spentSeconds ?? 0
        let estimate = summary?.estimateSeconds ?? 0
        let progress = progressValue(spentSeconds: spent, estimateSeconds: estimate)

        return DisclosureGroup(isExpanded: epicExpandedBinding(item.epicKey)) {
            VStack(alignment: .leading, spacing: 12) {
                planningSection(epicKey: item.epicKey)
                budgetTasksSection(epicKey: item.epicKey)
            }
            .padding(.top, 8)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(item.label)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Spacer()
                    if item.isManual, let manualId = item.manualId {
                        Button(role: .destructive) {
                            jira.removeManualEpic(id: manualId)
                        } label: {
                            Image(systemName: "trash")
                                .font(.footnote)
                        }
                        .buttonStyle(.plain)
                    }
                }

                Text("\(item.epicKey) · \(summaryLabel(spentSeconds: spent, estimateSeconds: estimate, hasSummary: summary != nil))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                ProgressView(value: progress)
                    .tint(progressTint(progress))
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(surfaceFillStrong)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.white.opacity(oledEnabled ? 0.1 : 0.08), lineWidth: 1)
                    )
            )
        }
    }

    private func budgetTasksSection(epicKey: String) -> some View {
        let items = sortedWorkItems(for: epicKey)
        return VStack(alignment: .leading, spacing: 10) {
            if items.isEmpty {
                if jira.isLoadingWorkItems {
                    ProgressView("Loading Jira tasks...")
                        .font(.footnote)
                } else {
                    Text("No Tasks To Fetch For Customer.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } else {
                ForEach(items, id: \.id) { item in
                    taskRow(item, epicKey: epicKey)
                }
            }
        }
    }

    private func taskRow(_ item: JiraWorkItem, epicKey: String) -> some View {
        let spent = aggregatedSpent(for: item)
        let estimate = aggregatedEstimate(for: item)
        let progress = progressValue(spentSeconds: spent, estimateSeconds: estimate)
        let eta = expectedEndDate(for: item, epicKey: epicKey)
        let status = taskStatus(for: item, eta: eta)

        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(item.key) · \(item.summary)")
                        .font(.subheadline.weight(.semibold))
                    Text(item.assigneeName ?? "Unassigned")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if let last = lastWorklogLabel(item.lastWorklog) {
                        Text(last)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Button("History") {
                    selectedHistoryTask = item
                }
                .font(.caption.weight(.semibold))
                .buttonStyle(.bordered)
            let jiraStatus = item.statusName?.trimmingCharacters(in: .whitespacesAndNewlines)
            if status != nil || (jiraStatus?.isEmpty == false) {
                VStack(alignment: .trailing, spacing: 4) {
                    if let status {
                        Text(status.label)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(status.color.opacity(0.18))
                            .foregroundStyle(status.color)
                            .clipShape(Capsule())
                    }
                    if let jiraStatus, !jiraStatus.isEmpty {
                        Text(jiraStatus)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }

            Text(summaryLabel(spentSeconds: spent, estimateSeconds: estimate, hasSummary: true))
                .font(.footnote)
                .foregroundStyle(.secondary)

            if let eta {
                Text("ETA · \(dateLabel(eta))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ProgressView(value: progress)
                .tint(progressTint(progress))

            if item.hasSubtasks {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(sortedSubtasks(for: item), id: \.id) { subtask in
                        subtaskRow(subtask)
                    }
                }
                .padding(.leading, 12)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(surfaceFill)
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(surfaceStroke, lineWidth: 1)
                )
        )
    }

    private func subtaskRow(_ subtask: JiraWorkSubtask) -> some View {
        let spent = subtask.timespent
        let estimate = subtask.estimateSeconds
        let progress = progressValue(spentSeconds: spent, estimateSeconds: estimate)

        return VStack(alignment: .leading, spacing: 4) {
            Text("\(subtask.key) · \(subtask.summary)")
                .font(.footnote.weight(.semibold))
            Text(subtask.assigneeName ?? "Unassigned")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let last = lastWorklogLabel(subtask.lastWorklog) {
                Text(last)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(summaryLabel(spentSeconds: spent, estimateSeconds: estimate, hasSummary: true))
                .font(.caption2)
                .foregroundStyle(.secondary)
            ProgressView(value: progress)
                .tint(progressTint(progress))
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(surfaceFillSoft)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(surfaceStrokeSoft, lineWidth: 1)
                )
        )
    }

    private func planningSection(epicKey: String) -> some View {
        let people = epicPeople(for: epicKey)
        let startDate = jira.projectStartDates[epicKey] ?? Date()
        let weeklyHours = weeklyHoursBase

        return VStack(alignment: .leading, spacing: 10) {
            Text("Planning controls")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)

            DatePicker("Project start date", selection: Binding(
                get: { jira.projectStartDates[epicKey] ?? startDate },
                set: { jira.setProjectStartDate(epicKey: epicKey, date: $0) }
            ), displayedComponents: .date)
            .font(.footnote)

            if people.isEmpty {
                Text("No people detected yet.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(people, id: \.self) { person in
                    let percentBinding = Binding<Double>(
                        get: { jira.projectPeoplePercent[epicKey]?[person] ?? 100 },
                        set: { jira.setProjectPersonPercent(epicKey: epicKey, person: person, percent: $0) }
                    )
                    let weeklyLogged = weeklyLoggedSeconds(person: person, epicKey: epicKey)
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(person)
                                .font(.footnote.weight(.semibold))
                            Spacer()
                            Text("\(Int(percentBinding.wrappedValue))%")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Slider(value: percentBinding, in: 0...100, step: 5)
                        Text("Weekly capacity · \(String(format: "%.1f", weeklyHours * percentBinding.wrappedValue / 100.0))h")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("Logged this week · \(formatDuration(seconds: weeklyLogged))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(8)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(surfaceFillSoft)
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(surfaceStroke, lineWidth: 1)
                            )
                    )
                }
            }
        }
    }

    private var weeklyHoursBase: Double {
        let config = jira.timeTrackingConfig
        let hoursPerDay = Double(config?.hoursPerDay ?? 8)
        return hoursPerDay * 5
    }

    private var peopleOptions: [String] {
        let names = peopleGroups.map { $0.name }.sorted()
        return names.isEmpty ? [] : ["All"] + names
    }

    private var peopleGroups: [PersonGroup] {
        var totals: [String: Int] = [:]
        var tasksByPerson: [String: [PersonGroupTask]] = [:]
        let allowed = Set(budgetEpicKeys)
        for (epicKey, items) in jira.workItemsByEpic where allowed.contains(epicKey) {
            for item in items {
                let names = personNames(for: item)
                for name in names {
                    tasksByPerson[name, default: []].append(PersonGroupTask(epicKey: epicKey, item: item))
                }
                for log in item.worklogs {
                    guard let author = log.authorName else { continue }
                    totals[author, default: 0] += log.seconds
                }
                for subtask in item.subtasks {
                    for log in subtask.worklogs {
                        guard let author = log.authorName else { continue }
                        totals[author, default: 0] += log.seconds
                    }
                }
            }
        }
        let groups: [PersonGroup] = tasksByPerson.map { name, tasks in
            let sortedTasks = tasks.sorted {
                if sortByProgress {
                    return compareProgress(
                        left: progressSortKey(
                            spentSeconds: aggregatedSpent(for: $0.item),
                            estimateSeconds: aggregatedEstimate(for: $0.item)
                        ),
                        right: progressSortKey(
                            spentSeconds: aggregatedSpent(for: $1.item),
                            estimateSeconds: aggregatedEstimate(for: $1.item)
                        )
                    )
                }
                return $0.item.key < $1.item.key
            }
            return PersonGroup(
                id: name,
                name: name,
                totalSeconds: totals[name, default: 0],
                tasks: sortedTasks
            )
        }
        let filtered = groups.filter { selectedPersonFilter == "All" || $0.name == selectedPersonFilter }
        return filtered.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func miniKpiCard(title: String, value: String, detail: String?) -> some View {
        let fillStyle = oledEnabled
            ? AnyShapeStyle(Color.black.opacity(0.82))
            : AnyShapeStyle(.ultraThinMaterial)
        let strokeColor = Color.white.opacity(oledEnabled ? 0.08 : 0.12)
        return VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(value)
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(fillStyle)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(strokeColor, lineWidth: 1)
        )
    }

    private func loadPeopleViewData() async {
        if isLoadingPeopleView { return }
        isLoadingPeopleView = true
        let keys = Set(budgetEpicKeys)
        for epicKey in keys {
            await jira.loadWorkItems(for: epicKey)
        }
        isLoadingPeopleView = false
    }

    private func epicExpandedBinding(_ epicKey: String) -> Binding<Bool> {
        Binding(
            get: { expandedEpics.contains(epicKey) },
            set: { isExpanded in
                if isExpanded {
                    expandedEpics.insert(epicKey)
                    Task {
                        await jira.loadEpicSummaries(for: [epicKey])
                        await jira.loadWorkItems(for: epicKey)
                    }
                } else {
                    expandedEpics.remove(epicKey)
                }
            }
        )
    }

    private func sortedWorkItems(for epicKey: String) -> [JiraWorkItem] {
        let items = jira.workItems(for: epicKey)
        guard sortByProgress else { return items.sorted { $0.key < $1.key } }
        return items.sorted {
            compareProgress(
                left: progressSortKey(
                    spentSeconds: aggregatedSpent(for: $0),
                    estimateSeconds: aggregatedEstimate(for: $0)
                ),
                right: progressSortKey(
                    spentSeconds: aggregatedSpent(for: $1),
                    estimateSeconds: aggregatedEstimate(for: $1)
                )
            )
        }
    }

    private func sortedSubtasks(for item: JiraWorkItem) -> [JiraWorkSubtask] {
        guard sortByProgress else { return item.subtasks.sorted { $0.key < $1.key } }
        return item.subtasks.sorted {
            compareProgress(
                left: progressSortKey(spentSeconds: $0.timespent, estimateSeconds: $0.estimateSeconds),
                right: progressSortKey(spentSeconds: $1.timespent, estimateSeconds: $1.estimateSeconds)
            )
        }
    }

    private func summaryLabel(spentSeconds: Int, estimateSeconds: Int, hasSummary: Bool) -> String {
        guard hasSummary else { return "Loading summary…" }
        if estimateSeconds <= 0 {
            return "\(formatDuration(seconds: spentSeconds)) · No estimate"
        }
        let percent = Int((Double(spentSeconds) / Double(estimateSeconds)) * 100)
        return "\(formatDuration(seconds: spentSeconds)) / \(formatDuration(seconds: estimateSeconds)) (\(percent)%)"
    }

    private func progressValue(spentSeconds: Int, estimateSeconds: Int) -> Double {
        guard estimateSeconds > 0 else { return 0 }
        return min(1, Double(spentSeconds) / Double(estimateSeconds))
    }

    private func progressSortKey(spentSeconds: Int, estimateSeconds: Int) -> ProgressSortKey {
        let hasEstimate = estimateSeconds > 0
        let ratio = hasEstimate ? Double(spentSeconds) / Double(estimateSeconds) : 0
        return ProgressSortKey(hasEstimate: hasEstimate, ratio: ratio, spentSeconds: spentSeconds)
    }

    private func aggregatedSpent(for item: JiraWorkItem) -> Int {
        item.timespent + item.subtasks.reduce(0) { $0 + $1.timespent }
    }

    private func aggregatedEstimate(for item: JiraWorkItem) -> Int {
        item.estimateSeconds + item.subtasks.reduce(0) { $0 + $1.estimateSeconds }
    }

    private func compareProgress(left: ProgressSortKey, right: ProgressSortKey) -> Bool {
        if left.hasEstimate != right.hasEstimate {
            return left.hasEstimate && !right.hasEstimate
        }
        if left.hasEstimate && left.ratio != right.ratio {
            return left.ratio > right.ratio
        }
        return left.spentSeconds > right.spentSeconds
    }

    private func progressTint(_ progress: Double) -> Color {
        if progress >= 1 { return .red }
        if progress >= 0.8 { return .orange }
        return .green
    }

    private func formatDuration(seconds: Int) -> String {
        let hours = Double(seconds) / 3600.0
        if showHours {
            return String(format: "%.1fh", hours)
        }
        let config = jira.timeTrackingConfig
        let hoursPerDay = max(config?.hoursPerDay ?? 8, 1)
        let daysPerWeek = max(config?.daysPerWeek ?? 5, 1)
        var remaining = Int(hours.rounded(.down))
        let weekHours = hoursPerDay * daysPerWeek
        let weeks = remaining / weekHours
        remaining = remaining % weekHours
        let days = remaining / hoursPerDay
        let hoursLeft = remaining % hoursPerDay
        return "\(weeks)w \(days)d \(hoursLeft)h"
    }

    private func lastWorklogLabel(_ worklog: JiraWorklogEntry?) -> String? {
        guard let worklog else { return nil }
        let dateLabel = worklog.started.flatMap { JiraDateFormatter.shortDate(from: $0) } ?? "Unknown date"
        let author = worklog.authorName ?? "Unknown"
        return "Last · \(dateLabel) · \(author)"
    }

    private func expectedEndDate(for item: JiraWorkItem, epicKey: String) -> Date? {
        let estimateSeconds = aggregatedEstimate(for: item)
        guard estimateSeconds > 0 else { return nil }
        let spentSeconds = aggregatedSpent(for: item)
        let remainingSeconds = max(estimateSeconds - spentSeconds, 0)
        guard remainingSeconds > 0 else { return Date() }
        let startDate = jira.projectStartDates[epicKey] ?? Date()
        let person = item.assigneeName ?? "Unassigned"
        let percent = jira.projectPeoplePercent[epicKey]?[person] ?? 100
        let hoursPerDay = Double(jira.timeTrackingConfig?.hoursPerDay ?? 8)
        let dailyCapacity = hoursPerDay * max(percent, 0) / 100.0
        guard dailyCapacity > 0 else { return nil }
        let remainingHours = Double(remainingSeconds) / 3600.0
        return addWorkHours(start: startDate, hours: remainingHours, dailyCapacity: dailyCapacity)
    }

    private func taskStatus(for item: JiraWorkItem, eta: Date?) -> TaskStatus? {
        guard let eta else { return nil }
        let estimateSeconds = aggregatedEstimate(for: item)
        let spentSeconds = aggregatedSpent(for: item)
        if estimateSeconds <= 0 { return nil }
        if spentSeconds >= estimateSeconds {
            return TaskStatus(label: "Done", color: .green)
        }
        if Date() > eta {
            return TaskStatus(label: "Delayed", color: .red)
        }
        return TaskStatus(label: "On track", color: .blue)
    }

    private func dateLabel(_ date: Date) -> String {
        JiraDateFormatter.shortDate(from: date)
    }

    private func epicPeople(for epicKey: String) -> [String] {
        let items = jira.workItems(for: epicKey)
        var names: Set<String> = []
        for item in items {
            if let assignee = item.assigneeName {
                names.insert(assignee)
            }
            for log in item.worklogs {
                if let author = log.authorName {
                    names.insert(author)
                }
            }
            for subtask in item.subtasks {
                if let assignee = subtask.assigneeName {
                    names.insert(assignee)
                }
                for log in subtask.worklogs {
                    if let author = log.authorName {
                        names.insert(author)
                    }
                }
            }
        }
        if names.isEmpty {
            return ["Unassigned"]
        }
        return names.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    private func weeklyLoggedSeconds(person: String, epicKey: String) -> Int {
        let items = jira.workItems(for: epicKey)
        let weekRange = currentWorkWeekRange()
        var total = 0
        for item in items {
            for log in item.worklogs {
                guard let author = log.authorName, author == person else { continue }
                guard let started = log.started.flatMap({ JiraDateFormatter.parseJiraDate($0) }) else { continue }
                if started >= weekRange.start && started <= weekRange.end {
                    total += log.seconds
                }
            }
            for subtask in item.subtasks {
                for log in subtask.worklogs {
                    guard let author = log.authorName, author == person else { continue }
                    guard let started = log.started.flatMap({ JiraDateFormatter.parseJiraDate($0) }) else { continue }
                    if started >= weekRange.start && started <= weekRange.end {
                        total += log.seconds
                    }
                }
            }
        }
        return total
    }

    private func currentWorkWeekRange() -> (start: Date, end: Date) {
        var calendar = Calendar.current
        calendar.firstWeekday = 1
        let start = calendar.dateInterval(of: .weekOfYear, for: Date())?.start ?? Date()
        let end = calendar.date(byAdding: .day, value: 4, to: start) ?? start
        let endOfDay = calendar.date(bySettingHour: 23, minute: 59, second: 59, of: end) ?? end
        return (start, endOfDay)
    }

    private func addWorkHours(start: Date, hours: Double, dailyCapacity: Double) -> Date {
        guard hours > 0 else { return start }
        var remaining = hours
        var date = start
        let calendar = Calendar.current
        while remaining > 0 {
            if isWorkday(date) {
                remaining -= dailyCapacity
            }
            date = calendar.date(byAdding: .day, value: 1, to: date) ?? date
        }
        return date
    }

    private func isWorkday(_ date: Date) -> Bool {
        let weekday = Calendar.current.component(.weekday, from: date)
        return weekday >= 1 && weekday <= 5
    }

    private func personNames(for item: JiraWorkItem) -> [String] {
        var names: Set<String> = []
        if let assignee = item.assigneeName {
            names.insert(assignee)
        }
        for log in item.worklogs {
            if let author = log.authorName {
                names.insert(author)
            }
        }
        for subtask in item.subtasks {
            if let assignee = subtask.assigneeName {
                names.insert(assignee)
            }
            for log in subtask.worklogs {
                if let author = log.authorName {
                    names.insert(author)
                }
            }
        }
        if names.isEmpty {
            names.insert("Unassigned")
        }
        return Array(names)
    }

    private var personStats: [PersonLogStats] {
        personStatsCache
    }

    private var missingJiraPeople: [PersonLogStats] {
        personStats.filter { isMissingLast24h($0) }
    }

    private var loggedJiraPeople: [PersonLogStats] {
        personStats.filter { !isMissingLast24h($0) }
    }

    private func isMissingLast24h(_ stats: PersonLogStats) -> Bool {
        guard let lastLog = stats.lastLog else { return true }
        let cutoff = Date().addingTimeInterval(-24 * 60 * 60)
        return lastLog < cutoff
    }

    private func epicDisplayName(for epicKey: String) -> String {
        if let manual = jira.manualEpics.first(where: { $0.epicKey == epicKey }) {
            return manual.label
        }
        if let mapped = jira.mappings.first(where: { $0.value == epicKey }) {
            return mapped.key
        }
        return jira.epicSummary(for: epicKey) ?? epicKey
    }

    private func updatePersonStats() {
        personStatsCache = buildPersonStats()
    }

    private func buildPersonStats() -> [PersonLogStats] {
        var stats: [String: PersonLogStats] = [:]
        let allowed = Set(budgetEpicKeys)
        for (epicKey, items) in jira.workItemsByEpic where allowed.contains(epicKey) {
            let epicLabel = epicDisplayName(for: epicKey)
            for item in items {
                for log in item.worklogs {
                    guard let author = log.authorName else { continue }
                    guard let startedDate = log.started.flatMap({ JiraDateFormatter.parseJiraDate($0) }) else { continue }
                    let day = Calendar.current.startOfDay(for: startedDate)
                    var entry = stats[author] ?? PersonLogStats(
                        id: author,
                        name: author,
                        lastLog: nil,
                        dailySeconds: [:],
                        entries: []
                    )
                    entry.dailySeconds[day, default: 0] += log.seconds
                    if entry.lastLog == nil || startedDate > entry.lastLog! {
                        entry.lastLog = startedDate
                    }
                    entry.entries.append(
                        PersonLogEntry(
                            date: day,
                            epicKey: epicKey,
                            epicLabel: epicLabel,
                            taskKey: item.key,
                            taskSummary: item.summary,
                            seconds: log.seconds
                        )
                    )
                    stats[author] = entry
                }
                for subtask in item.subtasks {
                    for log in subtask.worklogs {
                        guard let author = log.authorName else { continue }
                        guard let startedDate = log.started.flatMap({ JiraDateFormatter.parseJiraDate($0) }) else { continue }
                        let day = Calendar.current.startOfDay(for: startedDate)
                        var entry = stats[author] ?? PersonLogStats(
                            id: author,
                            name: author,
                            lastLog: nil,
                            dailySeconds: [:],
                            entries: []
                        )
                        entry.dailySeconds[day, default: 0] += log.seconds
                        if entry.lastLog == nil || startedDate > entry.lastLog! {
                            entry.lastLog = startedDate
                        }
                        entry.entries.append(
                            PersonLogEntry(
                                date: day,
                                epicKey: epicKey,
                                epicLabel: epicLabel,
                                taskKey: subtask.key,
                                taskSummary: subtask.summary,
                                seconds: log.seconds
                            )
                        )
                        stats[author] = entry
                    }
                }
            }
        }
        return stats.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func refreshCustomerCaches() {
        let items = Set(hrs.workLogs.map { $0.customerName })
        cachedCustomers = items.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
        guard let report = hrs.monthlyReport else {
            cachedActiveCustomers = []
            return
        }
        var lookup: [Int: String] = [:]
        for log in hrs.workLogs {
            if lookup[log.taskId] == nil {
                lookup[log.taskId] = log.customerName
            }
        }
        var customers: Set<String> = []
        for day in report.days {
            for entry in day.reports {
                if let customer = lookup[entry.taskId], !customer.isEmpty {
                    customers.insert(customer)
                }
            }
        }
        cachedActiveCustomers = customers
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
                .font(.footnote.weight(.bold))
            Text(message)
                .font(.footnote)
                .foregroundStyle(.red)
                .multilineTextAlignment(.leading)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.red.opacity(0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.red.opacity(0.35), lineWidth: 1)
                )
        )
    }

}

private struct JiraEpicSelectionSheet: View {
    let customer: String
    let epics: [JiraEpic]
    let selectedKey: String?
    @Binding var searchText: String
    let onSelect: (String?) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Button {
                    onSelect(nil)
                    dismiss()
                } label: {
                    HStack {
                        Text("Unmapped")
                        Spacer()
                        if selectedKey == nil {
                            Image(systemName: "checkmark")
                                .foregroundStyle(.green)
                        }
                    }
                }

                ForEach(filteredEpics, id: \.key) { epic in
                    Button {
                        onSelect(epic.key)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("\(epic.key)")
                                    .font(.subheadline.weight(.semibold))
                                if epic.key == selectedKey {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(.green)
                                }
                            }
                            Text(epic.summary)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle(customer)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var filteredEpics: [JiraEpic] {
        guard !searchText.isEmpty else { return epics }
        return epics.filter {
            $0.key.localizedCaseInsensitiveContains(searchText)
                || $0.summary.localizedCaseInsensitiveContains(searchText)
        }
    }
}

private struct ManualEpicAddSheet: View {
    let epics: [JiraEpic]
    @Binding var searchText: String
    let onAdd: (String, String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var label: String = ""
    @State private var selectedEpicKey: String? = nil

    var body: some View {
        NavigationStack {
            List {
                Section("Manual client") {
                    TextField("Client name", text: $label)
                }

                Section("Select epic") {
                    if epics.isEmpty {
                        Text("Load epics to select one.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(filteredEpics, id: \.key) { epic in
                            Button {
                                selectedEpicKey = epic.key
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(epic.key)
                                            .font(.subheadline.weight(.semibold))
                                        Text(epic.summary)
                                            .font(.footnote)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if selectedEpicKey == epic.key {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundStyle(.green)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle("Manual epic")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        guard let key = selectedEpicKey else { return }
                        onAdd(label, key)
                        searchText = ""
                        dismiss()
                    }
                    .disabled(label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || selectedEpicKey == nil)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var filteredEpics: [JiraEpic] {
        guard !searchText.isEmpty else { return epics }
        return epics.filter {
            $0.key.localizedCaseInsensitiveContains(searchText)
                || $0.summary.localizedCaseInsensitiveContains(searchText)
        }
    }
}

private enum BudgetViewMode: String, CaseIterable {
    case budgets
    case people

    var title: String {
        switch self {
        case .budgets: return "Budgets"
        case .people: return "People"
        }
    }
}

private struct BudgetEpicItem: Identifiable, Hashable {
    let id: String
    let label: String
    let epicKey: String
    let isManual: Bool
    let manualId: UUID?
}

private struct PersonGroup: Identifiable {
    let id: String
    let name: String
    let totalSeconds: Int
    let tasks: [PersonGroupTask]
}

private struct PersonGroupTask: Identifiable {
    let id: String
    let epicKey: String
    let item: JiraWorkItem

    init(epicKey: String, item: JiraWorkItem) {
        self.epicKey = epicKey
        self.item = item
        self.id = "\(epicKey)-\(item.id)"
    }
}

private struct ProgressSortKey {
    let hasEstimate: Bool
    let ratio: Double
    let spentSeconds: Int
}

private struct TaskStatus {
    let label: String
    let color: Color
}

private struct AlertRowContent: View, Equatable {
    let name: String
    let lastLogLabel: String
    let isMissing: Bool
    let oledEnabled: Bool

    static func == (lhs: AlertRowContent, rhs: AlertRowContent) -> Bool {
        lhs.name == rhs.name &&
            lhs.lastLogLabel == rhs.lastLogLabel &&
            lhs.isMissing == rhs.isMissing &&
            lhs.oledEnabled == rhs.oledEnabled
    }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(name)
                    .font(.subheadline.weight(.semibold))
                Text("Last log · \(lastLogLabel)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(isMissing ? "Missing" : "Logged")
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background((isMissing ? Color.red : Color.green).opacity(0.18))
                .foregroundStyle(isMissing ? Color.red : Color.green)
                .clipShape(Capsule())
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(oledEnabled ? Color.black.opacity(0.75) : Color.white.opacity(0.03))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color.white.opacity(oledEnabled ? 0.08 : 0.06), lineWidth: 1)
                )
        )
    }
}

private struct PersonLogStats: Identifiable {
    let id: String
    let name: String
    var lastLog: Date?
    var dailySeconds: [Date: Int]
    var entries: [PersonLogEntry]

    var lastLogLabel: String {
        guard let lastLog else { return "No logs" }
        return JiraDateFormatter.shortDate(from: lastLog)
    }

    var isMissing: Bool {
        guard let lastLog else { return true }
        return lastLog < Self.lastWorkdayCutoff()
    }

    private static func lastWorkdayCutoff() -> Date {
        let calendar = Calendar.current
        var cursor = calendar.startOfDay(for: Date())
        repeat {
            cursor = calendar.date(byAdding: .day, value: -1, to: cursor) ?? cursor
        } while !isWorkday(cursor)
        return calendar.date(bySettingHour: 23, minute: 59, second: 59, of: cursor) ?? cursor
    }

    private static func isWorkday(_ date: Date) -> Bool {
        let weekday = Calendar.current.component(.weekday, from: date)
        return weekday >= 1 && weekday <= 5
    }
}

private struct PersonLogEntry: Identifiable, Hashable {
    let id = UUID()
    let date: Date
    let epicKey: String
    let epicLabel: String
    let taskKey: String
    let taskSummary: String
    let seconds: Int
}

private struct PersonTrendSelection: Identifiable {
    let id = UUID()
    let stats: PersonLogStats
}

private struct PersonTrendSheet: View {
    let stats: PersonLogStats
    @State private var selectedDayLogs: DayLogSelection? = nil

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(stats.name)
                        .font(.title3.weight(.semibold))
                    Text("Last log · \(stats.lastLogLabel)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Last 14 workdays")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.secondary)
                        let barWidth: CGFloat = 18
                        let spacing: CGFloat = 8
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(alignment: .bottom, spacing: spacing) {
                                ForEach(trendDays, id: \.self) { day in
                                    let value = Double(stats.dailySeconds[day] ?? 0) / 3600.0
                                    let height = maxBarHeight * CGFloat(value / maxValue)
                                    Button {
                                        let items = dayLogItems(for: day)
                                        selectedDayLogs = DayLogSelection(person: stats.name, date: day, items: items)
                                    } label: {
                                        VStack(spacing: 6) {
                                            RoundedRectangle(cornerRadius: 4)
                                                .fill(value > 0 ? Color.green : Color.gray.opacity(0.3))
                                                .frame(width: barWidth, height: max(4, height))
                                            Text(JiraDateFormatter.shortDate.string(from: day))
                                                .font(.system(size: 9, weight: .medium))
                                                .foregroundStyle(.secondary)
                                                .monospacedDigit()
                                                .lineLimit(1)
                                                .minimumScaleFactor(0.5)
                                                .allowsTightening(true)
                                                .frame(width: barWidth)
                                        }
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 4)
                        }
                        .frame(height: maxBarHeight + 40)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle("Worklog trend")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
        .sheet(item: $selectedDayLogs) { selection in
            DayLogsSheet(selection: selection)
        }
    }

    private var trendDays: [Date] {
        let calendar = Calendar.current
        var days: [Date] = []
        var cursor = calendar.startOfDay(for: Date())
        while days.count < 14 {
            if isWorkday(cursor) {
                days.append(cursor)
            }
            cursor = calendar.date(byAdding: .day, value: -1, to: cursor) ?? cursor
        }
        return days.reversed()
    }

    private var maxValue: Double {
        let maxSeconds = trendDays.map { stats.dailySeconds[$0] ?? 0 }.max() ?? 0
        return max(1, Double(maxSeconds) / 3600.0)
    }

    private var maxBarHeight: CGFloat {
        120
    }

    private func dayLogItems(for day: Date) -> [DayLogItem] {
        let grouped = Dictionary(grouping: stats.entries.filter { $0.date == day }) { entry in
            "\(entry.epicKey)::\(entry.taskKey)"
        }
        return grouped.values.map { entries in
            let first = entries.first!
            let total = entries.reduce(0) { $0 + $1.seconds }
            return DayLogItem(
                epicLabel: first.epicLabel,
                taskLabel: "\(first.taskKey) · \(first.taskSummary)",
                seconds: total
            )
        }
        .sorted { $0.epicLabel.localizedCaseInsensitiveCompare($1.epicLabel) == .orderedAscending }
    }

    private func isWorkday(_ date: Date) -> Bool {
        let weekday = Calendar.current.component(.weekday, from: date)
        return weekday >= 1 && weekday <= 5
    }
}

private struct DayLogSelection: Identifiable {
    let id = UUID()
    let person: String
    let date: Date
    let items: [DayLogItem]
}

private struct DayLogItem: Identifiable {
    let id = UUID()
    let epicLabel: String
    let taskLabel: String
    let seconds: Int
}

private struct DayLogsSheet: View {
    let selection: DayLogSelection
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if selection.items.isEmpty {
                    Text("No worklogs found for this day.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(selection.items) { item in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.epicLabel)
                                    .font(.footnote.weight(.semibold))
                                Text(item.taskLabel)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(formatHours(item.seconds))
                                .font(.footnote.weight(.semibold))
                        }
                        .padding(.vertical, 6)
                    }

                    HStack {
                        Text("Total")
                            .font(.footnote.weight(.semibold))
                        Spacer()
                        Text(formatHours(totalSeconds))
                            .font(.footnote.weight(.semibold))
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("\(selection.person) · \(JiraDateFormatter.shortDate.string(from: selection.date))")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var totalSeconds: Int {
        selection.items.reduce(0) { $0 + $1.seconds }
    }

    private func formatHours(_ seconds: Int) -> String {
        String(format: "%.1fh", Double(seconds) / 3600.0)
    }
}

private struct HistoryLogsSheet: View {
    let task: JiraWorkItem
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                let data = matrixData
                VStack(alignment: .leading, spacing: 12) {
                    Text("History logs · \(task.key)")
                        .font(.headline)
                    Text(task.summary)
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    if data.peopleKeys.isEmpty || data.rows.isEmpty {
                        Text("No worklogs found for this task.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        ScrollView(.horizontal) {
                            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                                headerRow(data)
                                ForEach(data.rows, id: \.self) { date in
                                    row(for: date, data: data)
                                }
                                totalRow(data)
                            }
                            .padding(8)
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("History logs")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func headerRow(_ data: MatrixData) -> some View {
        let columnWidth: CGFloat = 72
        return GridRow {
            Text("Date").font(.caption.weight(.semibold))
            ForEach(data.peopleKeys, id: \.self) { personKey in
                Text(data.labels[personKey] ?? personKey)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                    .frame(minWidth: columnWidth, alignment: .leading)
            }
            if data.peopleKeys.count > 1 {
                Text("Total")
                    .font(.caption.weight(.semibold))
                    .frame(minWidth: columnWidth, alignment: .leading)
            }
        }
    }

    private func row(for date: Date, data: MatrixData) -> some View {
        let totals = data.matrix[date] ?? [:]
        let rowTotal = totals.values.reduce(0, +)
        let columnWidth: CGFloat = 72
        return GridRow {
            Text(JiraDateFormatter.shortDate.string(from: date))
                .font(.caption)
            ForEach(data.peopleKeys, id: \.self) { personKey in
                Text(formatHours(totals[personKey] ?? 0))
                    .font(.caption)
                    .foregroundStyle(.primary)
                    .frame(minWidth: columnWidth, alignment: .leading)
            }
            if data.peopleKeys.count > 1 {
                Text(formatHours(rowTotal))
                    .font(.caption.weight(.semibold))
                    .frame(minWidth: columnWidth, alignment: .leading)
            }
        }
        .padding(.vertical, 4)
    }

    private func totalRow(_ data: MatrixData) -> some View {
        let totalsByPerson = data.peopleKeys.reduce(into: [String: Int]()) { result, key in
            result[key] = data.matrix.values.reduce(0) { $0 + ($1[key] ?? 0) }
        }
        let grandTotal = totalsByPerson.values.reduce(0, +)
        let columnWidth: CGFloat = 72
        return GridRow {
            Text("Total")
                .font(.caption.weight(.semibold))
            ForEach(data.peopleKeys, id: \.self) { personKey in
                Text(formatHours(totalsByPerson[personKey] ?? 0))
                    .font(.caption.weight(.semibold))
                    .frame(minWidth: columnWidth, alignment: .leading)
            }
            if data.peopleKeys.count > 1 {
                Text(formatHours(grandTotal))
                    .font(.caption.weight(.semibold))
                    .frame(minWidth: columnWidth, alignment: .leading)
            }
        }
        .padding(.vertical, 4)
    }

    private func formatHours(_ seconds: Int) -> String {
        String(format: "%.1fh", Double(seconds) / 3600.0)
    }

    private func normalizedName(_ value: String?) -> String {
        (value ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    private var matrixData: MatrixData {
        var labels: [String: String] = [:]
        var matrix: [Date: [String: Int]] = [:]
        for log in task.worklogs {
            guard let started = log.started.flatMap({ JiraDateFormatter.parseJiraDate($0) }) else { continue }
            let day = Calendar.current.startOfDay(for: started)
            let label = (log.authorName ?? "Unknown").trimmingCharacters(in: .whitespacesAndNewlines)
            let key = normalizedName(label)
            if labels[key] == nil {
                labels[key] = label.isEmpty ? "Unknown" : label
            }
            var dayEntry = matrix[day] ?? [:]
            dayEntry[key, default: 0] += log.seconds
            matrix[day] = dayEntry
        }
        let rows = matrix.keys.sorted(by: >)
        let peopleKeys = labels.keys.sorted {
            (labels[$0] ?? $0).localizedCaseInsensitiveCompare(labels[$1] ?? $1) == .orderedAscending
        }
        return MatrixData(rows: rows, peopleKeys: peopleKeys, labels: labels, matrix: matrix)
    }

    private struct MatrixData {
        let rows: [Date]
        let peopleKeys: [String]
        let labels: [String: String]
        let matrix: [Date: [String: Int]]
    }
}

private enum JiraDateFormatter {
    static let jiraDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
        return formatter
    }()

    static let shortDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "dd/MM"
        return formatter
    }()

    static func parseJiraDate(_ value: String) -> Date? {
        jiraDate.date(from: value)
    }

    static func shortDate(from value: String) -> String {
        guard let date = parseJiraDate(value) else { return value }
        return shortDate.string(from: date)
    }

    static func shortDate(from date: Date) -> String {
        shortDate.string(from: date)
    }
}
