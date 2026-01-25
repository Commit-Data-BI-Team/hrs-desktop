import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var hrs: HRSViewModel
    @EnvironmentObject var jira: JiraViewModel
    @EnvironmentObject var state: AppState
    @State private var period: Period = .month
    @State private var renderPhase: RenderPhase = .kpis
    @State private var warmupApplied = false
    @State private var logToJira = false
    @State private var jiraStatus: String? = nil
    @State private var jiraTaskKey: String? = nil
    @State private var jiraSubtaskKey: String? = nil
    @State private var showJiraTaskSheet = false
    @State private var showJiraSubtaskSheet = false
    @State private var jiraTaskSearch = ""
    @State private var jiraSubtaskSearch = ""
    @State private var calendarDaysCache: [CalendarDay] = []
    @State private var maxDayMinutesCache: Int = 0
    @State private var weekendDaysCache: Set<Int> = [6, 7]
    @State private var monthTitleCache: String = ""
    @State private var weekdaySymbolsCache: [String] = []
    @State private var trendLabelsCache: [String] = []
    @State private var hoursTrendCache: [Double] = []
    @State private var activeClientsTrendCache: [Double] = []
    @State private var yearlyMinutesCache: [String: Int] = [:]
    @State private var selectedProject: String? = nil
    @State private var selectedCustomer: String? = nil
    @State private var projectSearch = ""
    @State private var customerSearch = ""
    @State private var taskSearch = ""
    @State private var showProjectSheet = false
    @State private var showCustomerSheet = false
    @State private var showTaskSheet = false
    @AppStorage("hrsKpiCollapsed") private var hrsKpiCollapsed = false
    @AppStorage("hrsCalendarCollapsed") private var hrsCalendarCollapsed = false
    @AppStorage("hrs.oledEnabled") private var oledEnabled = false

    enum Period: String, CaseIterable, Identifiable {
        case day = "Day"
        case week = "Week"
        case month = "Month"

        var id: String { rawValue }
    }

    enum RenderPhase: Int {
        case kpis = 0
        case calendar = 1
        case logs = 2
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AppBackground()
                if hrs.hasLoaded {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 16) {
                            if let error = hrs.errorMessage {
                                GlassCard {
                                    Label(error, systemImage: "exclamationmark.triangle.fill")
                                        .font(.footnote)
                                        .foregroundStyle(.red)
                                }
                            }
                            header
                            periodPicker
                            stats
                            if renderPhase.rawValue >= RenderPhase.calendar.rawValue {
                                calendarView
                            }
                            if renderPhase.rawValue >= RenderPhase.logs.rawValue {
                                dailyReports
                                logForm
                            }
                            signOutButton
                        }
                        .padding()
                    }
                    .scrollIndicators(.hidden)
                }

                if !hrs.hasLoaded {
                    loadingOverlay
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .task {
                if !hrs.hasLoaded {
                    await hrs.load()
                    startProgressiveRender()
                } else if renderPhase.rawValue == RenderPhase.kpis.rawValue {
                    startProgressiveRender()
                }
                refreshCalendarData()
                refreshTrendData()
            }
            .onChange(of: hrs.workLogs) { _ in
                syncSelections()
                refreshTrendData()
            }
            .onChange(of: hrs.logDate) { newValue in
                ActivityMonitor.shared.markInteraction()
                warmupApplied = false
                refreshCalendarData()
                refreshTrendData()
                Task {
                    await hrs.loadMonthlyReport(for: newValue)
                    refreshCalendarData()
                    refreshTrendData()
                }
            }
            .onReceive(hrs.$monthlyReport) { _ in
                refreshCalendarData()
            }
            .onReceive(hrs.$yearlyReport) { _ in
                refreshTrendData()
            }
            .onReceive(hrs.$warmupSnapshot) { _ in
                warmupApplied = false
                refreshCalendarData()
                refreshTrendData()
            }
            .onChange(of: selectedProject) { _ in
                ActivityMonitor.shared.markInteraction()
                syncSelections()
            }
            .onChange(of: selectedCustomer) { _ in
                ActivityMonitor.shared.markInteraction()
                syncSelections()
                jiraTaskKey = nil
                jiraSubtaskKey = nil
                loadJiraWorkItemsIfNeeded()
            }
            .onChange(of: period) { _ in
                ActivityMonitor.shared.markInteraction()
            }
            .onChange(of: jira.isConnected) { isConnected in
                if !isConnected {
                    logToJira = false
                }
            }
            .onChange(of: logToJira) { isOn in
                if isOn {
                    loadJiraWorkItemsIfNeeded()
                } else {
                    jiraTaskKey = nil
                    jiraSubtaskKey = nil
                }
            }
            .onChange(of: jiraTaskKey) { _ in
                jiraSubtaskKey = nil
            }
            .onChange(of: hrsCalendarCollapsed) { _ in
                refreshCalendarData()
            }
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            PageHeader(title: "HRS Mobile")
            ThemeToggle(oledEnabled: $oledEnabled)
        }
    }

    private var periodPicker: some View {
        Picker("Period", selection: $period) {
            ForEach(Period.allCases) { item in
                Text(item.rawValue).tag(item)
            }
        }
        .pickerStyle(.segmented)
    }

    private var stats: some View {
        ZStack {
            if hasData {
                kpiContent
            } else {
                kpiContent
                    .blur(radius: 8)
            }

            if !hasData {
                GlassCard {
                    VStack(spacing: 6) {
                        Label("No data for this period", systemImage: "nosign")
                            .font(.headline)
                        Text("Log hours to unlock KPIs.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 6)
                }
                .frame(maxWidth: 260)
            }
        }
    }

    private var kpiContent: some View {
        VStack(spacing: 12) {
            HStack(spacing: 8) {
                Label("Key metrics", systemImage: "waveform.path.ecg")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        hrsKpiCollapsed.toggle()
                    }
                } label: {
                    Image(systemName: hrsKpiCollapsed ? "chevron.down" : "chevron.up")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(6)
                        .background(
                            Circle()
                                .fill(Color.white.opacity(0.08))
                        )
                }
                .buttonStyle(.plain)
            }

            if hrsKpiCollapsed {
                compactKpis
            } else {
                expandedKpis
            }
        }
    }

    private var logForm: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("Log work", systemImage: "checkmark.seal.fill")
                        .font(.headline)
                    Spacer()
                    if hrs.isLoading {
                        Label("Loading", systemImage: "arrow.triangle.2.circlepath")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                HStack {
                    Image(systemName: "calendar")
                        .foregroundStyle(.secondary)
                    DatePicker("Date", selection: $hrs.logDate, displayedComponents: .date)
                        .datePickerStyle(.compact)
                }

                HStack(spacing: 12) {
                    HStack {
                        Image(systemName: "clock")
                            .foregroundStyle(.secondary)
                        DatePicker("From", selection: $hrs.fromTime, displayedComponents: .hourAndMinute)
                            .labelsHidden()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    HStack {
                        Image(systemName: "clock.fill")
                            .foregroundStyle(.secondary)
                        DatePicker("To", selection: $hrs.toTime, displayedComponents: .hourAndMinute)
                            .labelsHidden()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Reporting from")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Picker("Reporting from", selection: $hrs.reportingFrom) {
                        ForEach(hrs.reportingFromOptions, id: \.self) { option in
                            Text(reportingFromLabel(option)).tag(option)
                        }
                    }
                    .pickerStyle(.menu)
                }

                taskSelectors

                TextField("Comment", text: $hrs.comment)
                    .textFieldStyle(.roundedBorder)

                if let error = hrs.errorMessage {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
                if let success = hrs.successMessage {
                    Label(success, systemImage: "checkmark.circle.fill")
                        .font(.footnote)
                        .foregroundStyle(.green)
                }
                if let jiraStatus {
                    Label(jiraStatus, systemImage: "bolt.fill")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                HStack {
                    Toggle("Log to Jira", isOn: $logToJira)
                        .toggleStyle(.switch)
                        .tint(Color(red: 0.35, green: 0.7, blue: 1.0))
                        .disabled(!jira.isConnected)
                    Spacer()
                }
                if logToJira {
                    if let epicKey = jira.mappedEpic(for: jiraCustomerSelection) {
                        let epicName = jira.epicSummary(for: epicKey) ?? "Unknown epic"
                        Text("Jira epic: \(epicKey) · \(epicName)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        jiraTaskSelectors()
                    } else {
                        Text("Map this customer in the Jira tab to enable logging.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                } else if !jira.isConnected {
                    Text("Connect Jira in the Jira tab to enable logging.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Button {
                    Task { await submitLogWork() }
                } label: {
                    Text("Log work")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(hrs.comment.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
            }
        }
    }

    private var signOutButton: some View {
        Button("Sign out") {
            state.signOut()
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.red)
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.top, 12)
    }

    private var calendarView: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("Monthly reports", systemImage: "calendar")
                        .font(.headline)
                    Spacer()
                    HStack(spacing: 12) {
                        Button(action: {
                            hrsCalendarCollapsed ? shiftWeek(by: -1) : shiftMonth(by: -1)
                        }) {
                            Image(systemName: "chevron.left")
                        }
                        .buttonStyle(.plain)
                        Text(hrsCalendarCollapsed ? weekRangeText : monthTitle)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        Button(action: {
                            hrsCalendarCollapsed ? shiftWeek(by: 1) : shiftMonth(by: 1)
                        }) {
                            Image(systemName: "chevron.right")
                        }
                        .buttonStyle(.plain)
                    }
                    .foregroundStyle(.secondary)
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            hrsCalendarCollapsed.toggle()
                        }
                    } label: {
                        Image(systemName: hrsCalendarCollapsed ? "chevron.down" : "chevron.up")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(6)
                            .background(
                                Circle()
                                    .fill(Color.white.opacity(0.08))
                            )
                    }
                    .buttonStyle(.plain)
                }

                if hrsCalendarCollapsed {
                    LazyVGrid(columns: calendarColumns, spacing: 8) {
                        ForEach(weekdaySymbols, id: \.self) { symbol in
                            Text(symbol)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity)
                        }

                        ForEach(weekDays) { day in
                            calendarCell(for: day, allowOutOfMonth: true)
                        }
                    }
                    .contentShape(Rectangle())
                    .highPriorityGesture(weekScrollGesture)
                } else {
                    LazyVGrid(columns: calendarColumns, spacing: 8) {
                        ForEach(weekdaySymbols, id: \.self) { symbol in
                            Text(symbol)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity)
                        }

                        ForEach(calendarDays) { day in
                            calendarCell(for: day)
                        }
                    }
                }
            }
        }
    }

    private var dailyReports: some View {
        let groups = groupedSelectedDayReports
        return Group {
            if !groups.isEmpty {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Label("Logged today", systemImage: "list.bullet.rectangle")
                                .font(.headline)
                            Spacer()
                            Text(DateFormatter.hrsDate.string(from: hrs.logDate))
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }

                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(groups) { group in
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(group.project)
                                                .font(.subheadline.weight(.semibold))
                                            if !group.customer.isEmpty {
                                                Text(group.customer)
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                            }
                                        }
                                        Spacer()
                                        Text(TimeUtils.hhmm(fromMinutes: group.totalMinutes))
                                            .font(.caption.weight(.semibold))
                                            .padding(.horizontal, 10)
                                            .padding(.vertical, 5)
                                            .background(Capsule().fill(Color.green.opacity(0.18)))
                                            .foregroundStyle(Color.green.opacity(0.95))
                                    }

                                    VStack(alignment: .leading, spacing: 6) {
                                        ForEach(Array(group.entries.enumerated()), id: \.offset) { _, entry in
                                            HStack(alignment: .top, spacing: 10) {
                                                Text(entry.hoursHHMM)
                                                    .font(.caption.weight(.semibold))
                                                    .foregroundStyle(.secondary)
                                                    .frame(width: 54, alignment: .leading)
                                                VStack(alignment: .leading, spacing: 2) {
                                                    Text(entry.taskName)
                                                        .font(.caption.weight(.semibold))
                                                    if !entry.comment.isEmpty {
                                                        Text(entry.comment)
                                                            .font(.caption2)
                                                            .foregroundStyle(.secondary)
                                                    }
                                                    Text(reportingFromLabel(entry.reportingFrom))
                                                        .font(.caption2)
                                                        .foregroundStyle(Color.white.opacity(0.55))
                                                }
                                                Spacer()
                                            }
                                        }
                                    }
                                }
                                .padding(12)
                                .background(
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .fill(oledEnabled ? Color.black.opacity(0.25) : Color.white.opacity(0.03))
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    private var loadingOverlay: some View {
        GlassCard {
            VStack(spacing: 12) {
                ProgressView()
                Text(hrs.loadingStage)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var taskSelectors: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Project")
                .font(.caption)
                .foregroundStyle(.secondary)
            selectionButton(
                title: selectedProject ?? "Select a project",
                isEnabled: true
            ) {
                showProjectSheet = true
            }

            Text("Customer")
                .font(.caption)
                .foregroundStyle(.secondary)
            selectionButton(
                title: selectedCustomer ?? "Select a customer",
                isEnabled: selectedProject != nil
            ) {
                showCustomerSheet = true
            }

            Text("Task")
                .font(.caption)
                .foregroundStyle(.secondary)
            selectionButton(
                title: selectedTaskTitle,
                isEnabled: selectedCustomer != nil
            ) {
                showTaskSheet = true
            }
        }
        .sheet(isPresented: $showProjectSheet) {
            StringSelectionSheet(
                title: "Project",
                items: projectOptions,
                searchText: $projectSearch
            ) { selection in
                selectedProject = selection
                projectSearch = ""
            }
        }
        .sheet(isPresented: $showCustomerSheet) {
            StringSelectionSheet(
                title: "Customer",
                items: customerOptions,
                searchText: $customerSearch
            ) { selection in
                selectedCustomer = selection
                customerSearch = ""
            }
        }
        .sheet(isPresented: $showTaskSheet) {
            TaskSelectionSheet(
                items: taskOptions,
                searchText: $taskSearch
            ) { selection in
                hrs.selectedTaskId = selection.taskId
                taskSearch = ""
            }
        }
    }

    private func selectionButton(title: String, isEnabled: Bool, action: @escaping () -> Void) -> some View {
        let fillColor = oledEnabled
            ? Color(white: 0.1).opacity(isEnabled ? 0.9 : 0.7)
            : Color.white.opacity(isEnabled ? 0.06 : 0.03)
        let strokeColor = oledEnabled
            ? Color.white.opacity(isEnabled ? 0.08 : 0.05)
            : Color.white.opacity(isEnabled ? 0.08 : 0.04)
        return Button(action: action) {
            HStack {
                Text(title)
                    .foregroundStyle(isEnabled ? .primary : .secondary)
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(fillColor)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(strokeColor, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
    }

    private func reportingFromLabel(_ value: String) -> String {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        switch normalized {
        case "OFFICE":
            return "Office"
        case "HOME":
            return "Home"
        case "CLIENT":
            return "Customer"
        default:
            return normalized
                .lowercased()
                .replacingOccurrences(of: "_", with: " ")
                .split(separator: " ")
                .map { $0.prefix(1).uppercased() + $0.dropFirst() }
                .joined(separator: " ")
        }
    }

    private func calendarCell(for day: CalendarDay, allowOutOfMonth: Bool = false) -> some View {
        let isSelected = calendar.isDate(day.date, inSameDayAs: hrs.logDate)
        let isWeekend = weekendDays.contains(calendar.component(.weekday, from: day.date))
        let isInteractive = day.isCurrentMonth || allowOutOfMonth
        let missingHighlightExcludedDays: Set<Int> = [6, 7]
        let weekday = calendar.component(.weekday, from: day.date)
        let today = calendar.startOfDay(for: Date())
        let isFuture = calendar.startOfDay(for: day.date) > today
        let isMissingHours = day.minutes == 0
            && isInteractive
            && day.isCurrentMonth
            && !isFuture
            && !missingHighlightExcludedDays.contains(weekday)
        let intensity = day.minutes > 0 && maxDayMinutes > 0
            ? sqrt(Double(day.minutes) / Double(maxDayMinutes))
            : 0
        let highlightColor = Color(red: 0.35, green: 0.8, blue: 0.9).opacity(0.15 + 0.45 * intensity)
        let missingColor = Color(red: 0.86, green: 0.22, blue: 0.28).opacity(0.18)
        let label = day.minutes > 0 ? String(format: "%.1fh", Double(day.minutes) / 60.0) : nil
        let baseFill = oledEnabled
            ? Color.white.opacity(day.isCurrentMonth ? 0.04 : 0.02)
            : Color.white.opacity(day.isCurrentMonth ? 0.05 : 0.02)

        return Button {
            hrs.logDate = day.date
        } label: {
            VStack(spacing: 4) {
                Text("\(day.day)")
                    .font(.subheadline.weight(isSelected ? .bold : .semibold))
                    .foregroundStyle(isInteractive ? .primary : .secondary)
                if let label {
                    Text(label)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Color.white.opacity(0.12)))
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(baseFill)
            )
            .overlay(
                Group {
                    if isMissingHours {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(missingColor)
                    }
                    if day.minutes > 0 && isInteractive && !isWeekend {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(highlightColor)
                    }
                }
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.white.opacity(0.65) : Color.clear, lineWidth: 1.2)
            )
        }
        .buttonStyle(.plain)
        .disabled(!isInteractive)
    }

    private func shiftMonth(by value: Int) {
        let start = monthStart
        guard let newDate = calendar.date(byAdding: .month, value: value, to: start) else { return }
        hrs.logDate = newDate
    }

    private func shiftWeek(by value: Int) {
        guard let newDate = calendar.date(byAdding: .weekOfYear, value: value, to: hrs.logDate) else { return }
        hrs.logDate = newDate
    }

    private func kpiCard<Content: View>(@ViewBuilder _ content: @escaping () -> Content) -> some View {
        GlassCard {
            content()
                .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
        }
        .frame(maxWidth: .infinity)
    }

    private var expandedKpis: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                kpiCard {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 6) {
                            Image(systemName: "chart.bar")
                            Text("TOTAL HOURS")
                                .textCase(.uppercase)
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        Text(totalHoursText)
                            .font(.system(size: 32, weight: .bold))
                        TrendSparkline(
                            values: hoursTrend,
                            labels: trendLabels,
                            color: Color(red: 0.4, green: 0.85, blue: 0.9)
                        ) { value in
                            String(format: "%.1fh", value)
                        }
                    }
                }
                kpiCard {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 6) {
                            Image(systemName: "person.2.fill")
                            Text("ACTIVE CLIENTS")
                                .textCase(.uppercase)
                                .lineLimit(1)
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        Text("\(activeClientsCount)")
                            .font(.system(size: 26, weight: .bold))
                        TrendSparkline(
                            values: activeClientsTrend,
                            labels: trendLabels,
                            color: Color(red: 0.45, green: 0.75, blue: 1.0)
                        ) { value in
                            "\(Int(value))"
                        }
                    }
                }
            }

            GlassCard {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Top clients · \(period.rawValue)", systemImage: "star.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if topClients.isEmpty {
                        Text("No client activity yet.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(topClients.enumerated()), id: \.offset) { index, item in
                            HStack {
                                Text("\(index + 1). \(item.name)")
                                    .font(.subheadline)
                                    .lineLimit(1)
                                Spacer()
                                Text(item.hours)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var compactKpis: some View {
        let topClient = topClients.first
        return HStack(spacing: 10) {
            miniKpiCard(
                title: "Total hours",
                value: totalHoursText,
                detail: period.rawValue
            )
            miniKpiCard(
                title: "Active clients",
                value: "\(activeClientsCount)",
                detail: period.rawValue
            )
            miniKpiCard(
                title: "Top client",
                value: topClient?.name ?? "No data",
                detail: topClient?.hours
            )
        }
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

    private func startProgressiveRender() {
        renderPhase = .kpis
        Task {
            try? await Task.sleep(nanoseconds: 140_000_000)
            withAnimation(.easeInOut(duration: 0.2)) {
                renderPhase = .calendar
            }
            try? await Task.sleep(nanoseconds: 140_000_000)
            withAnimation(.easeInOut(duration: 0.2)) {
                renderPhase = .logs
            }
        }
    }

    private func applyWarmupIfAvailable() -> Bool {
        guard !warmupApplied else { return true }
        guard let snapshot = hrs.warmupSnapshot else { return false }
        let currentKey = DateFormatter.monthKey.string(from: hrs.logDate)
        guard snapshot.monthKey == currentKey else { return false }
        monthTitleCache = DateFormatter.monthYear.string(from: monthStart)
        let symbols = calendar.shortStandaloneWeekdaySymbols
        let startIndex = calendar.firstWeekday - 1
        let reordered = Array(symbols[startIndex...] + symbols[..<startIndex])
        weekdaySymbolsCache = reordered.map { $0.uppercased() }
        weekendDaysCache = Set(snapshot.weekendDays)
        maxDayMinutesCache = snapshot.maxDayMinutes
        calendarDaysCache = buildCalendarDays(
            start: monthStart,
            minutesByDate: snapshot.calendarMinutes
        )
        trendLabelsCache = snapshot.trendLabels
        hoursTrendCache = snapshot.hoursTrend
        activeClientsTrendCache = snapshot.activeClientsTrend
        warmupApplied = true
        return true
    }

    private func refreshCalendarData() {
        let start = monthStart
        let report = hrs.monthlyReport
        let weekendString = report?.weekend
        var minutesByDate: [String: Int] = [:]
        let monthKey = DateFormatter.monthKey.string(from: start)
        let reportMatchesMonth = report?.days.contains { $0.date.hasPrefix("\(monthKey)-") } ?? false
        if let report, reportMatchesMonth {
            for day in report.days {
                let minutes = day.reports.reduce(0) { sum, entry in
                    sum + TimeUtils.minutes(fromHHMM: entry.hoursHHMM)
                }
                minutesByDate[day.date] = minutes
            }
        } else if !yearlyMinutesCache.isEmpty {
            for (key, minutes) in yearlyMinutesCache where key.hasPrefix("\(monthKey)-") {
                minutesByDate[key] = minutes
            }
        }

        if applyWarmupIfAvailable(), PerformanceMonitor.shared.shouldDeferHeavyWork {
            return
        }

        let compute = {
            let monthTitle = DateFormatter.monthYear.string(from: start)
            let symbols = calendar.shortStandaloneWeekdaySymbols
            let startIndex = calendar.firstWeekday - 1
            let reordered = Array(symbols[startIndex...] + symbols[..<startIndex])
            let weekdaySymbols = reordered.map { $0.uppercased() }

            let weekendDays: Set<Int>
            if let weekendString {
                let map: [String: Int] = [
                    "sun": 1, "mon": 2, "tue": 3, "wed": 4, "thu": 5, "fri": 6, "sat": 7
                ]
                let parts = weekendString.lowercased().split(separator: "-").map { String($0.prefix(3)) }
                let values = parts.compactMap { map[$0] }
                weekendDays = values.isEmpty ? [6, 7] : Set(values)
            } else {
                weekendDays = [6, 7]
            }

            let maxDayMinutes = minutesByDate.values.max() ?? 0
            let startWeekday = calendar.component(.weekday, from: start)
            let leading = (startWeekday - calendar.firstWeekday + 7) % 7
            let daysInMonth = calendar.range(of: .day, in: .month, for: start)?.count ?? 30

            var days: [CalendarDay] = []
            for offset in 0..<leading {
                let date = calendar.date(byAdding: .day, value: offset - leading, to: start) ?? start
                let dayNumber = calendar.component(.day, from: date)
                days.append(CalendarDay(date: date, day: dayNumber, isCurrentMonth: false, minutes: 0))
            }

            for day in 1...daysInMonth {
                let date = calendar.date(bySetting: .day, value: day, of: start) ?? start
                let key = DateFormatter.hrsDate.string(from: date)
                let minutes = minutesByDate[key] ?? 0
                days.append(CalendarDay(date: date, day: day, isCurrentMonth: true, minutes: minutes))
            }

            let remaining = 42 - days.count
            if remaining > 0 {
                for offset in 0..<remaining {
                    let date = calendar.date(byAdding: .day, value: offset + daysInMonth, to: start) ?? start
                    let dayNumber = calendar.component(.day, from: date)
                    days.append(CalendarDay(date: date, day: dayNumber, isCurrentMonth: false, minutes: 0))
                }
            }
            return (monthTitle, weekdaySymbols, weekendDays, maxDayMinutes, days)
        }

        let apply: (String, [String], Set<Int>, Int, [CalendarDay]) -> Void = { title, symbols, weekendDays, maxMinutes, days in
            monthTitleCache = title
            weekdaySymbolsCache = symbols
            weekendDaysCache = weekendDays
            maxDayMinutesCache = maxMinutes
            calendarDaysCache = days
        }

        if PerformanceMonitor.shared.shouldDeferHeavyWork {
            Task.detached(priority: .utility) {
                let result = compute()
                await MainActor.run {
                    apply(result.0, result.1, result.2, result.3, result.4)
                }
            }
        } else {
            let result = compute()
            apply(result.0, result.1, result.2, result.3, result.4)
        }
    }

    private func buildCalendarDays(start: Date, minutesByDate: [String: Int]) -> [CalendarDay] {
        let startWeekday = calendar.component(.weekday, from: start)
        let leading = (startWeekday - calendar.firstWeekday + 7) % 7
        let daysInMonth = calendar.range(of: .day, in: .month, for: start)?.count ?? 30

        var days: [CalendarDay] = []
        for offset in 0..<leading {
            let date = calendar.date(byAdding: .day, value: offset - leading, to: start) ?? start
            let dayNumber = calendar.component(.day, from: date)
            days.append(CalendarDay(date: date, day: dayNumber, isCurrentMonth: false, minutes: 0))
        }

        for day in 1...daysInMonth {
            let date = calendar.date(bySetting: .day, value: day, of: start) ?? start
            let key = DateFormatter.hrsDate.string(from: date)
            let minutes = minutesByDate[key] ?? 0
            days.append(CalendarDay(date: date, day: day, isCurrentMonth: true, minutes: minutes))
        }

        let remaining = 42 - days.count
        if remaining > 0 {
            for offset in 0..<remaining {
                let date = calendar.date(byAdding: .day, value: offset + daysInMonth, to: start) ?? start
                let dayNumber = calendar.component(.day, from: date)
                days.append(CalendarDay(date: date, day: dayNumber, isCurrentMonth: false, minutes: 0))
            }
        }
        return days
    }

    private func refreshTrendData() {
        let logDate = hrs.logDate
        let yearlyDays = hrs.yearlyReport?.days ?? []
        let workLogs = hrs.workLogs

        if applyWarmupIfAvailable(), PerformanceMonitor.shared.shouldDeferHeavyWork {
            return
        }

        let compute = {
            let calendar = Calendar.current
            let currentStart = calendar.date(from: calendar.dateComponents([.year, .month], from: logDate)) ?? logDate
            let start = calendar.date(byAdding: .month, value: -11, to: currentStart) ?? currentStart
            let monthStarts = (0..<12).compactMap { offset in
                calendar.date(byAdding: .month, value: offset, to: start)
            }
            let labels = monthStarts.map { DateFormatter.monthShort.string(from: $0).uppercased() }
            let monthKeys = monthStarts.map { DateFormatter.monthKey.string(from: $0) }

            var taskLookup: [Int: WorkLog] = [:]
            for log in workLogs {
                if taskLookup[log.taskId] == nil {
                    taskLookup[log.taskId] = log
                }
            }

            var hoursByMonth: [String: Int] = [:]
            var clientsByMonth: [String: Set<String>] = [:]
            var minutesByDate: [String: Int] = [:]
            for day in yearlyDays {
                guard let date = DateFormatter.hrsDate.date(from: day.date) else { continue }
                let key = DateFormatter.monthKey.string(from: date)
                let dayMinutes = day.reports.reduce(0) { sum, entry in
                    sum + TimeUtils.minutes(fromHHMM: entry.hoursHHMM)
                }
                minutesByDate[day.date] = dayMinutes
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
            return (labels, hoursTrend, activeClientsTrend, minutesByDate)
        }

        let apply: ([String], [Double], [Double], [String: Int]) -> Void = { labels, hoursTrend, clientsTrend, minutesByDate in
            trendLabelsCache = labels
            hoursTrendCache = hoursTrend
            activeClientsTrendCache = clientsTrend
            yearlyMinutesCache = minutesByDate
        }

        if PerformanceMonitor.shared.shouldDeferHeavyWork {
            Task.detached(priority: .utility) {
                let result = compute()
                await MainActor.run {
                    apply(result.0, result.1, result.2, result.3)
                }
            }
        } else {
            let result = compute()
            apply(result.0, result.1, result.2, result.3)
        }
    }

    private func submitLogWork() async {
        jiraStatus = nil
        let jiraComment = hrs.comment
        let duration = TimeUtils.duration(from: hrs.fromTime, to: hrs.toTime)
        let started = combine(date: hrs.logDate, time: hrs.fromTime)
        let hrsSuccess = await hrs.logWork()
        guard hrsSuccess else { return }
        guard logToJira else { return }
        guard jira.isConnected else {
            jiraStatus = "Jira not connected."
            return
        }
        guard let epicKey = jira.mappedEpic(for: jiraCustomerSelection) else {
            jiraStatus = "Map this customer in Jira."
            return
        }
        let issueKey = jiraSubtaskKey ?? jiraTaskKey ?? epicKey
        let jiraSuccess = await jira.addWorklog(
            issueKey: issueKey,
            started: started,
            seconds: duration.minutes * 60,
            comment: jiraComment
        )
        jiraStatus = jiraSuccess ? "Logged to Jira." : (jira.errorMessage ?? "Jira worklog failed.")
    }

    private func combine(date: Date, time: Date) -> Date {
        let calendar = Calendar.current
        let dateComponents = calendar.dateComponents([.year, .month, .day], from: date)
        let timeComponents = calendar.dateComponents([.hour, .minute], from: time)
        var merged = DateComponents()
        merged.year = dateComponents.year
        merged.month = dateComponents.month
        merged.day = dateComponents.day
        merged.hour = timeComponents.hour
        merged.minute = timeComponents.minute
        return calendar.date(from: merged) ?? date
    }

    private func loadJiraWorkItemsIfNeeded() {
        guard logToJira, jira.isConnected, let epicKey = jira.mappedEpic(for: jiraCustomerSelection) else { return }
        Task { await jira.loadWorkItems(for: epicKey) }
    }
}

private extension DashboardView {
    struct TaskRow: Identifiable {
        let id: Int
        let title: String
        let subtitle: String
    }

    struct ReportGroup: Identifiable {
        let id: String
        let project: String
        let customer: String
        let totalMinutes: Int
        let entries: [WorkReportEntry]
    }

    struct CalendarDay: Identifiable {
        let id: String
        let date: Date
        let day: Int
        let isCurrentMonth: Bool
        let minutes: Int

        init(date: Date, day: Int, isCurrentMonth: Bool, minutes: Int) {
            self.date = date
            self.day = day
            self.isCurrentMonth = isCurrentMonth
            self.minutes = minutes
            self.id = DateFormatter.hrsDate.string(from: date)
        }
    }

    var taskLookup: [Int: WorkLog] {
        var lookup: [Int: WorkLog] = [:]
        for log in hrs.workLogs {
            if lookup[log.taskId] == nil {
                lookup[log.taskId] = log
            }
        }
        return lookup
    }

    var jiraCustomerSelection: String? {
        if let selectedCustomer {
            return selectedCustomer
        }
        if let id = hrs.selectedTaskId, let log = taskLookup[id] {
            return log.customerName
        }
        return nil
    }

    var periodDates: (start: Date, end: Date)? {
        let calendar = Calendar.current
        switch period {
        case .day:
            let start = calendar.startOfDay(for: hrs.logDate)
            return (start, start)
        case .week:
            var weekCalendar = calendar
            weekCalendar.firstWeekday = 1
            guard let interval = weekCalendar.dateInterval(of: .weekOfYear, for: hrs.logDate) else {
                let start = calendar.startOfDay(for: hrs.logDate)
                return (start, start)
            }
            return (interval.start, calendar.date(byAdding: .second, value: -1, to: interval.end) ?? interval.end)
        case .month:
            guard let interval = calendar.dateInterval(of: .month, for: hrs.logDate) else { return nil }
            return (interval.start, calendar.date(byAdding: .second, value: -1, to: interval.end) ?? interval.end)
        }
    }

    var periodEntries: [WorkReportEntry] {
        guard let report = activeReport,
              let range = periodDates else { return [] }
        return report.days
            .filter { day in
                guard let date = DateFormatter.hrsDate.date(from: day.date) else { return false }
                return date >= range.start && date <= range.end
            }
            .flatMap { $0.reports }
    }

    var selectedDayReports: [WorkReportEntry] {
        guard let report = activeReport else { return [] }
        let key = DateFormatter.hrsDate.string(from: hrs.logDate)
        return report.days.first(where: { $0.date == key })?.reports ?? []
    }

    var groupedSelectedDayReports: [ReportGroup] {
        var groups: [String: (project: String, customer: String, minutes: Int, entries: [WorkReportEntry])] = [:]

        for entry in selectedDayReports {
            let meta = taskLookup[entry.taskId]
            let project = meta?.projectName ?? entry.projectInstance
            let customer = meta?.customerName ?? ""
            let key = "\(project)||\(customer)"
            let minutes = TimeUtils.minutes(fromHHMM: entry.hoursHHMM)

            if var existing = groups[key] {
                existing.minutes += minutes
                existing.entries.append(entry)
                groups[key] = existing
            } else {
                groups[key] = (project, customer, minutes, [entry])
            }
        }

        return groups.values
            .map { value in
                let sortedEntries = value.entries.sorted {
                    TimeUtils.minutes(fromHHMM: $0.hoursHHMM) > TimeUtils.minutes(fromHHMM: $1.hoursHHMM)
                }
                return ReportGroup(
                    id: "\(value.project)||\(value.customer)",
                    project: value.project,
                    customer: value.customer,
                    totalMinutes: value.minutes,
                    entries: sortedEntries
                )
            }
            .sorted { lhs, rhs in
                if lhs.totalMinutes != rhs.totalMinutes { return lhs.totalMinutes > rhs.totalMinutes }
                return lhs.project.localizedCaseInsensitiveCompare(rhs.project) == .orderedAscending
            }
    }

    var totalHoursText: String {
        let hours = Double(periodMinutes) / 60.0
        return String(format: "%.1f", hours)
    }

    var hasData: Bool {
        periodMinutes > 0
    }

    var activeClientsCount: Int {
        let names = periodEntries.map { entry in
            taskLookup[entry.taskId]?.customerName ?? entry.projectInstance
        }.filter { !$0.isEmpty }
        return Set(names).count
    }

    var topClients: [(name: String, hours: String)] {
        var totals: [String: Int] = [:]
        for entry in periodEntries {
            let name = taskLookup[entry.taskId]?.customerName ?? entry.projectInstance
            totals[name, default: 0] += TimeUtils.minutes(fromHHMM: entry.hoursHHMM)
        }
        return totals
            .sorted { $0.value > $1.value }
            .prefix(4)
            .map { key, minutes in
                let hours = Double(minutes) / 60.0
                return (key, String(format: "%.1fh", hours))
            }
    }

    var periodTasks: [TaskRow] {
        let rows = periodEntries.map { entry -> TaskRow in
            let lookup = taskLookup[entry.taskId]
            let project = lookup?.projectName ?? entry.projectInstance
            let customer = lookup?.customerName ?? "Client"
            let title = project.isEmpty ? entry.taskName : project
            let subtitle = "\(customer) · \(entry.taskName)"
            return TaskRow(id: entry.taskId, title: title, subtitle: subtitle)
        }
        var deduped: [Int: TaskRow] = [:]
        for row in rows {
            if deduped[row.id] == nil {
                deduped[row.id] = row
            }
        }
        return Array(deduped.values)
    }

    var periodMinutes: Int {
        periodEntries.reduce(0) { sum, entry in
            sum + TimeUtils.minutes(fromHHMM: entry.hoursHHMM)
        }
    }

    var recentTitle: String {
        switch period {
        case .day:
            return "Today's tasks"
        case .week:
            return "This week's tasks"
        case .month:
            return "This month's tasks"
        }
    }

    var calendar: Calendar {
        var cal = Calendar.current
        cal.firstWeekday = 1
        return cal
    }

    var monthStart: Date {
        calendar.date(from: calendar.dateComponents([.year, .month], from: hrs.logDate)) ?? hrs.logDate
    }

    var monthTitle: String {
        monthTitleCache
    }

    var calendarColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 8), count: 7)
    }

    var weekdaySymbols: [String] {
        weekdaySymbolsCache
    }

    var minutesByDateLookup: [String: Int] {
        guard let report = activeReport else { return [:] }
        var lookup: [String: Int] = [:]
        for day in report.days {
            let minutes = day.reports.reduce(0) { sum, entry in
                sum + TimeUtils.minutes(fromHHMM: entry.hoursHHMM)
            }
            lookup[day.date] = minutes
        }
        return lookup
    }

    var maxDayMinutes: Int {
        maxDayMinutesCache
    }

    var weekendDays: Set<Int> {
        weekendDaysCache
    }

    var calendarDays: [CalendarDay] {
        calendarDaysCache
    }

    var weekDays: [CalendarDay] {
        guard let interval = calendar.dateInterval(of: .weekOfYear, for: hrs.logDate) else { return [] }
        return (0..<7).compactMap { offset in
            guard let date = calendar.date(byAdding: .day, value: offset, to: interval.start) else { return nil }
            let dayNumber = calendar.component(.day, from: date)
            let key = DateFormatter.hrsDate.string(from: date)
            let minutes = yearlyMinutesCache[key] ?? minutesByDateLookup[key] ?? 0
            let isCurrentMonth = calendar.isDate(date, equalTo: monthStart, toGranularity: .month)
            return CalendarDay(date: date, day: dayNumber, isCurrentMonth: isCurrentMonth, minutes: minutes)
        }
    }

    var activeReport: MonthlyReport? {
        let monthKey = DateFormatter.monthKey.string(from: hrs.logDate)
        if let report = hrs.monthlyReport, reportMatchesMonth(report, monthKey: monthKey) {
            return report
        }
        if let report = hrs.yearlyReport, reportMatchesMonth(report, monthKey: monthKey) {
            return report
        }
        return hrs.monthlyReport ?? hrs.yearlyReport
    }

    func reportMatchesMonth(_ report: MonthlyReport, monthKey: String) -> Bool {
        report.days.contains { $0.date.hasPrefix("\(monthKey)-") }
    }

    var weekRangeText: String {
        guard let interval = calendar.dateInterval(of: .weekOfYear, for: hrs.logDate) else {
            return monthTitle
        }
        let start = interval.start
        let end = calendar.date(byAdding: .day, value: 6, to: start) ?? interval.end
        let startMonth = DateFormatter.monthShort.string(from: start)
        let endMonth = DateFormatter.monthShort.string(from: end)
        let startDay = calendar.component(.day, from: start)
        let endDay = calendar.component(.day, from: end)
        if startMonth == endMonth {
            return "\(startMonth) \(startDay)–\(endDay)"
        }
        return "\(startMonth) \(startDay)–\(endMonth) \(endDay)"
    }

    var weekScrollGesture: some Gesture {
        DragGesture(minimumDistance: 24)
            .onEnded { value in
                let vertical = value.translation.height
                let horizontal = value.translation.width
                guard abs(vertical) > abs(horizontal), abs(vertical) > 24 else { return }
                withAnimation(.easeInOut(duration: 0.2)) {
                    shiftWeek(by: vertical < 0 ? 1 : -1)
                }
            }
    }

    var trendLabels: [String] {
        trendLabelsCache
    }

    var hoursTrend: [Double] {
        hoursTrendCache
    }

    var activeClientsTrend: [Double] {
        activeClientsTrendCache
    }

    var projectOptions: [String] {
        let items = Set(hrs.workLogs.map { $0.projectName })
        return items.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    var customerOptions: [String] {
        guard let selectedProject else { return [] }
        let items = Set(hrs.workLogs.filter { $0.projectName == selectedProject }.map { $0.customerName })
        return items.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    var taskOptions: [WorkLog] {
        guard let selectedProject, let selectedCustomer else { return [] }
        let scoped = hrs.workLogs.filter {
            $0.projectName == selectedProject && $0.customerName == selectedCustomer
        }
        let active = scoped.filter { $0.isActiveTask != false }
        let candidates = active.isEmpty ? scoped : active
        var seen: Set<Int> = []
        let unique = candidates.filter { seen.insert($0.taskId).inserted }
        return unique.sorted { lhs, rhs in
            lhs.taskName.localizedCaseInsensitiveCompare(rhs.taskName) == .orderedAscending
        }
    }

    var selectedTaskTitle: String {
        guard let id = hrs.selectedTaskId,
              let log = taskLookup[id] else {
            return "Select a task"
        }
        return log.taskName
    }

    var selectedJiraTask: JiraWorkItem? {
        guard let jiraTaskKey else { return nil }
        return jiraWorkItems.first { $0.key == jiraTaskKey }
    }

    var selectedJiraSubtask: JiraWorkSubtask? {
        guard let jiraSubtaskKey else { return nil }
        return selectedJiraTask?.subtasks.first { $0.key == jiraSubtaskKey }
    }

    var jiraWorkItems: [JiraWorkItem] {
        guard let epicKey = jira.mappedEpic(for: jiraCustomerSelection) else { return [] }
        return jira.workItems(for: epicKey)
    }

    @ViewBuilder
    func jiraTaskSelectors() -> some View {
        let items = jiraWorkItems
        VStack(alignment: .leading, spacing: 8) {
            Text("Jira task (optional)")
                .font(.caption)
                .foregroundStyle(.secondary)
            selectionButton(
                title: selectedJiraTask?.summary ?? "Select a Jira task",
                isEnabled: !items.isEmpty
            ) {
                showJiraTaskSheet = true
            }

            if let selected = selectedJiraTask, selected.hasSubtasks {
                Text("Has subtasks")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text("Jira subtask (optional)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                selectionButton(
                    title: selectedJiraSubtask?.summary ?? "Select a Jira subtask",
                    isEnabled: true
                ) {
                    showJiraSubtaskSheet = true
                }
            }
        }
        .sheet(isPresented: $showJiraTaskSheet) {
            JiraWorkItemSelectionSheet(
                items: items,
                searchText: $jiraTaskSearch
            ) { selection in
                jiraTaskKey = selection?.key
                jiraTaskSearch = ""
            }
        }
        .sheet(isPresented: $showJiraSubtaskSheet) {
            JiraSubtaskSelectionSheet(
                items: selectedJiraTask?.subtasks ?? [],
                searchText: $jiraSubtaskSearch
            ) { selection in
                jiraSubtaskKey = selection?.key
                jiraSubtaskSearch = ""
            }
        }
    }

    func syncSelections() {
        if let selectedProject, !projectOptions.contains(selectedProject) {
            self.selectedProject = nil
            self.selectedCustomer = nil
            hrs.selectedTaskId = nil
        }

        if selectedProject == nil, projectOptions.count == 1 {
            selectedProject = projectOptions[0]
        }

        if let selectedCustomer, !customerOptions.contains(selectedCustomer) {
            self.selectedCustomer = nil
            hrs.selectedTaskId = nil
        }

        if selectedCustomer == nil, customerOptions.count == 1 {
            selectedCustomer = customerOptions[0]
        }

        let availableTasks = taskOptions
        let taskIds = Set(availableTasks.map { $0.taskId })
        if let selectedTask = hrs.selectedTaskId, !taskIds.contains(selectedTask) {
            hrs.selectedTaskId = nil
        }
        if hrs.selectedTaskId == nil, availableTasks.count == 1 {
            hrs.selectedTaskId = availableTasks[0].taskId
        }
    }
}

struct StatCard: View {
    let title: String
    let value: String

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 6) {
                Text(title.uppercased())
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.title3)
                    .bold()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct TrendSparkline: View {
    let values: [Double]
    let labels: [String]
    let color: Color
    let valueFormatter: (Double) -> String
    @State private var activeIndex: Int? = nil

    var body: some View {
        GeometryReader { geo in
            let points = normalizedPoints(in: geo.size)
            let linePath = Path { path in
                guard points.count > 1, let first = points.first else { return }
                path.move(to: first)
                for point in points.dropFirst() {
                    path.addLine(to: point)
                }
            }
            let fillPath = Path { path in
                guard points.count > 1, let first = points.first, let last = points.last else { return }
                path.move(to: first)
                for point in points.dropFirst() {
                    path.addLine(to: point)
                }
                path.addLine(to: CGPoint(x: last.x, y: geo.size.height))
                path.addLine(to: CGPoint(x: first.x, y: geo.size.height))
                path.closeSubpath()
            }

            ZStack {
                fillPath
                    .fill(
                        LinearGradient(
                            colors: [color.opacity(0.25), color.opacity(0.02)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )

                linePath
                    .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))

                ForEach(points.indices, id: \.self) { index in
                    Circle()
                        .fill(color.opacity(0.25))
                        .frame(width: 4, height: 4)
                        .position(points[index])
                }

                if let activeIndex, activeIndex < points.count {
                    let point = points[activeIndex]
                    Circle()
                        .fill(color)
                        .frame(width: 7, height: 7)
                        .position(point)

                    let label = labels.count == values.count ? labels[activeIndex] : ""
                    let valueText = valueFormatter(values[activeIndex])
                    let tooltipX = min(max(point.x, 36), geo.size.width - 36)
                    let tooltipY = max(point.y - 16, 10)

                    VStack(spacing: 2) {
                        Text(label)
                            .font(.caption2.weight(.semibold))
                        Text(valueText)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.white.opacity(0.9))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.white.opacity(0.4), lineWidth: 1)
                    )
                    .foregroundStyle(.black)
                    .position(x: tooltipX, y: tooltipY)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        guard values.count > 1, geo.size.width > 1 else {
                            activeIndex = nil
                            return
                        }
                        activeIndex = closestIndex(for: value.location.x, width: geo.size.width)
                    }
                    .onEnded { _ in
                        activeIndex = nil
                    }
            )
        }
        .frame(height: 28)
        .drawingGroup()
    }

    private func closestIndex(for x: CGFloat, width: CGFloat) -> Int {
        guard values.count > 1 else { return 0 }
        let clampedX = min(max(0, x), width)
        let step = width / CGFloat(values.count - 1)
        return min(values.count - 1, max(0, Int((clampedX / step).rounded())))
    }

    private func normalizedPoints(in size: CGSize) -> [CGPoint] {
        guard values.count > 1, size.width > 1, size.height > 1 else {
            let midY = max(1, size.height * 0.6)
            return [
                CGPoint(x: 0, y: midY),
                CGPoint(x: max(1, size.width), y: midY)
            ]
        }
        let minValue = values.min() ?? 0
        let maxValue = values.max() ?? 1
        let range = max(maxValue - minValue, 1)
        return values.enumerated().map { index, value in
            let x = size.width * CGFloat(index) / CGFloat(values.count - 1)
            let normalized = (value - minValue) / range
            let y = size.height - (size.height * CGFloat(normalized))
            return CGPoint(x: x, y: y)
        }
    }
}

private struct StringSelectionSheet: View {
    let title: String
    let items: [String]
    @Binding var searchText: String
    let onSelect: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(filteredItems, id: \.self) { item in
                    Button(item) {
                        onSelect(item)
                        dismiss()
                    }
                }
            }
            .listStyle(.plain)
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var filteredItems: [String] {
        guard !searchText.isEmpty else { return items }
        return items.filter { $0.localizedCaseInsensitiveContains(searchText) }
    }
}

private struct TaskSelectionSheet: View {
    let items: [WorkLog]
    @Binding var searchText: String
    let onSelect: (WorkLog) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(filteredItems, id: \.taskId) { log in
                    Button {
                        onSelect(log)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(log.taskName)
                                .font(.body)
                            Text("\(log.projectName) · \(log.customerName)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle("Task")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var filteredItems: [WorkLog] {
        guard !searchText.isEmpty else { return items }
        return items.filter {
            $0.taskName.localizedCaseInsensitiveContains(searchText)
                || $0.projectName.localizedCaseInsensitiveContains(searchText)
                || $0.customerName.localizedCaseInsensitiveContains(searchText)
        }
    }
}

private struct JiraWorkItemSelectionSheet: View {
    let items: [JiraWorkItem]
    @Binding var searchText: String
    let onSelect: (JiraWorkItem?) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Button("No Jira task (optional)") {
                    onSelect(nil)
                    dismiss()
                }
                .foregroundStyle(.secondary)

                ForEach(filteredItems, id: \.key) { item in
                    Button {
                        onSelect(item)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(item.key) · \(item.summary)")
                                .font(.body)
                            if item.hasSubtasks {
                                Text("Has subtasks")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle("Jira task")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var filteredItems: [JiraWorkItem] {
        guard !searchText.isEmpty else { return items }
        return items.filter {
            $0.key.localizedCaseInsensitiveContains(searchText)
                || $0.summary.localizedCaseInsensitiveContains(searchText)
        }
    }
}

private struct JiraSubtaskSelectionSheet: View {
    let items: [JiraWorkSubtask]
    @Binding var searchText: String
    let onSelect: (JiraWorkSubtask?) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Button("No Jira subtask (optional)") {
                    onSelect(nil)
                    dismiss()
                }
                .foregroundStyle(.secondary)

                ForEach(filteredItems, id: \.key) { item in
                    Button {
                        onSelect(item)
                        dismiss()
                    } label: {
                        Text("\(item.key) · \(item.summary)")
                    }
                }
            }
            .listStyle(.plain)
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle("Jira subtask")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var filteredItems: [JiraWorkSubtask] {
        guard !searchText.isEmpty else { return items }
        return items.filter {
            $0.key.localizedCaseInsensitiveContains(searchText)
                || $0.summary.localizedCaseInsensitiveContains(searchText)
        }
    }
}
