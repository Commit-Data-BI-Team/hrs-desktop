import SwiftUI

struct LoadingView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        ZStack {
            AppBackground()
            GlassCard {
                VStack(spacing: 12) {
                    ProgressView()
                    Text(state.loadingMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
