import SwiftUI

struct PageHeader: View {
    let title: String
    var subtitle: String? = nil

    var body: some View {
        GlassCard(cornerRadius: 22) {
            VStack(spacing: subtitle == nil ? 0 : 6) {
                Text(title)
                    .font(.system(size: 24, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if let subtitle {
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.75))
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 10)
            .padding(.horizontal, 12)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.22, green: 0.58, blue: 0.75).opacity(0.35),
                                Color(red: 0.08, green: 0.16, blue: 0.24).opacity(0.25)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            )
        }
    }
}

struct ThemeToggle: View {
    @Binding var oledEnabled: Bool

    var body: some View {
        HStack(spacing: 0) {
            segment(title: "DARK", isActive: !oledEnabled) {
                oledEnabled = false
            }
            segment(title: "OLED", isActive: oledEnabled) {
                oledEnabled = true
            }
        }
        .padding(3)
        .background(
            Capsule(style: .continuous)
                .fill(Color.white.opacity(0.08))
        )
        .overlay(
            Capsule(style: .continuous)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
        .frame(height: 32)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Theme")
        .accessibilityValue(oledEnabled ? "OLED" : "Dark")
    }

    private func segment(title: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button {
            guard !isActive else { return }
            withAnimation(.easeInOut(duration: 0.15)) {
                action()
            }
        } label: {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(isActive ? Color.white : Color.white.opacity(0.65))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
        }
        .background(
            Group {
                if isActive {
                    Capsule(style: .continuous)
                        .fill(Color.green.opacity(0.25))
                }
            }
        )
        .overlay(
            Group {
                if isActive {
                    Capsule(style: .continuous)
                        .stroke(Color.green.opacity(0.7), lineWidth: 1)
                }
            }
        )
        .contentShape(Capsule(style: .continuous))
        .buttonStyle(.plain)
    }
}
