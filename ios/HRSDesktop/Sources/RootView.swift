import SwiftUI

struct RootView: View {
    @EnvironmentObject var state: AppState
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var hrs = HRSViewModel()
    @StateObject private var jira = JiraViewModel()
    @State private var isPreparingData = false
    @State private var isDataReady = false

    var body: some View {
        Group {
            switch state.status {
            case .launching:
                LoadingView()
            case .signedOut:
                LoginView()
            case .ready:
                if isDataReady {
                    TabView {
                        NavigationStack {
                            DashboardView()
                        }
                        .tabItem {
                            Label("HRS", systemImage: "clock")
                        }

                        NavigationStack {
                            JiraView()
                        }
                        .tabItem {
                            Label("Jira", systemImage: "link")
                        }
                    }
                    .environmentObject(hrs)
                    .environmentObject(jira)
                } else {
                    LoadingView()
                }
            }
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else { return }
            Task {
                await state.boot()
                if state.status == .ready {
                    await prepareData()
                }
            }
        }
        .onChange(of: state.status) { status in
            if status == .signedOut {
                hrs.reset()
                isPreparingData = false
                isDataReady = false
            } else if status == .ready {
                Task {
                    await prepareData()
                }
            }
        }
    }

    private func prepareData() async {
        guard !isPreparingData else { return }
        isPreparingData = true
        isDataReady = false

        state.loadingMessage = "Loading HRS data…"
        await hrs.load()

        state.loadingMessage = "Loading Jira data…"
        await jira.preloadAllData()

        state.loadingMessage = "Preparing your workspace…"
        isPreparingData = false
        isDataReady = true
    }
}
