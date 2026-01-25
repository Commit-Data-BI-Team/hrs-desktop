import SwiftUI

struct GlassCard<Content: View>: View {
    var cornerRadius: CGFloat = 18
    var content: () -> Content
    @AppStorage("hrs.oledEnabled") private var oledEnabled = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        let strokeColor = Color.white.opacity(oledEnabled ? 0.08 : 0.12)
        let fillColor = oledEnabled
            ? Color.black.opacity(0.86)
            : Color(red: 0.09, green: 0.11, blue: 0.14).opacity(0.85)
        content()
            .padding()
            .background(
                shape.fill(fillColor)
            )
            .overlay(
                shape.stroke(strokeColor, lineWidth: 1)
            )
            .compositingGroup()
    }
}
