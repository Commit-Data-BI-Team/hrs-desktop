import SwiftUI

struct AppBackground: View {
    @AppStorage("hrs.oledEnabled") private var oledEnabled = false
    @Environment(\.displayScale) private var displayScale
    @State private var cachedImage: Image? = nil
    @State private var cachedSize: CGSize = .zero
    @State private var cachedOledEnabled = false

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack {
                if let cachedImage, cachedSize == size, cachedOledEnabled == oledEnabled {
                    cachedImage
                        .resizable()
                        .scaledToFill()
                        .frame(width: size.width, height: size.height)
                        .clipped()
                } else {
                    backgroundLayers
                        .frame(width: size.width, height: size.height)
                        .onAppear {
                            renderBackground(size: size)
                        }
                        .onChange(of: size) { newSize in
                            renderBackground(size: newSize)
                        }
                        .onChange(of: oledEnabled) { _ in
                            renderBackground(size: size)
                        }
                }
            }
        }
        .ignoresSafeArea()
    }

    private var backgroundLayers: some View {
        ZStack {
            if oledEnabled {
                Color.black

                Circle()
                    .fill(Color(red: 0.12, green: 0.55, blue: 0.65).opacity(0.18))
                    .frame(width: 240, height: 240)
                    .blur(radius: 60)
                    .offset(x: -120, y: -240)

                Circle()
                    .fill(Color(red: 0.80, green: 0.48, blue: 0.20).opacity(0.12))
                    .frame(width: 200, height: 200)
                    .blur(radius: 70)
                    .offset(x: 140, y: 240)
            } else {
                LinearGradient(
                    colors: [
                        Color(red: 0.05, green: 0.09, blue: 0.12),
                        Color(red: 0.07, green: 0.12, blue: 0.18)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )

                Circle()
                    .fill(Color(red: 0.16, green: 0.35, blue: 0.42).opacity(0.35))
                    .frame(width: 260, height: 260)
                    .blur(radius: 40)
                    .offset(x: -140, y: -260)

                Circle()
                    .fill(Color(red: 0.20, green: 0.22, blue: 0.40).opacity(0.35))
                    .frame(width: 220, height: 220)
                    .blur(radius: 50)
                    .offset(x: 160, y: 240)
            }
        }
    }

    @MainActor
    private func renderBackground(size: CGSize) {
        guard size.width > 0, size.height > 0 else { return }
        guard cachedSize != size || cachedOledEnabled != oledEnabled || cachedImage == nil else { return }
        cachedSize = size
        cachedOledEnabled = oledEnabled
        cachedImage = nil
        if #available(iOS 16.0, *) {
            let renderer = ImageRenderer(
                content: backgroundLayers.frame(width: size.width, height: size.height)
            )
            renderer.scale = displayScale
            if let uiImage = renderer.uiImage {
                cachedImage = Image(uiImage: uiImage)
            }
        }
    }
}
