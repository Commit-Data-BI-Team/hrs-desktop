import SwiftUI

@main
struct HRSDesktopApp: App {
    @StateObject private var state = AppState()

    init() {
        PerformanceMonitor.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
        }
    }
}
