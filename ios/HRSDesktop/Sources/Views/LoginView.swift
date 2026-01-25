import SwiftUI

struct LoginView: View {
    @EnvironmentObject var state: AppState
    @State private var isLoggingIn = false
    @AppStorage("hrs.autoLoginEnabled") private var autoLoginEnabled = false
    @State private var username = ""
    @State private var password = ""
    @State private var showSavedToast = false
    @State private var webViewKey = UUID()

    private var savedCredentials: HRSCredentials? {
        guard autoLoginEnabled else { return nil }
        return SessionStore.shared.savedCredentials
    }

    var body: some View {
        ZStack {
            AppBackground()
            VStack(spacing: 16) {
                VStack(spacing: 6) {
                    Text("HRS Mobile")
                        .font(.title2)
                        .bold()
                    Text("Sign in to connect your account.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if state.duoPending {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Sent DUO to phone for approval.")
                            .font(.footnote.weight(.semibold))
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.white.opacity(0.08))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.white.opacity(0.12), lineWidth: 1)
                    )
                    .transition(.opacity)
                }

                GlassCard {
                    HRSLoginWebView(
                        onCookies: { cookies in
                        guard !isLoggingIn else { return }
                        isLoggingIn = true
                        Task {
                            await state.handleLogin(cookies: cookies)
                            isLoggingIn = false
                        }
                    },
                        credentials: savedCredentials,
                        autoSubmit: autoLoginEnabled
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .id(webViewKey)
                }
                .frame(height: 420)
                .padding(.horizontal)

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Toggle("Auto-login (optional)", isOn: $autoLoginEnabled)
                            .toggleStyle(SwitchToggleStyle())
                        if autoLoginEnabled {
                            VStack(alignment: .leading, spacing: 8) {
                                TextField("HRS email", text: $username)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .textFieldStyle(.roundedBorder)
                                SecureField("HRS password", text: $password)
                                    .textFieldStyle(.roundedBorder)
                                HStack(spacing: 12) {
                                    Button("Save credentials") {
                                        let trimmedUser = username.trimmingCharacters(in: .whitespacesAndNewlines)
                                        let trimmedPass = password.trimmingCharacters(in: .whitespacesAndNewlines)
                                        guard !trimmedUser.isEmpty, !trimmedPass.isEmpty else { return }
                                        SessionStore.shared.saveCredentials(username: trimmedUser, password: trimmedPass)
                                        showSavedToast = true
                                        webViewKey = UUID()
                                    }
                                    .buttonStyle(.borderedProminent)
                                    Button("Clear") {
                                        SessionStore.shared.clearCredentials()
                                        username = ""
                                        password = ""
                                    }
                                    .buttonStyle(.bordered)
                                }
                                if showSavedToast {
                                    Text("Saved in Keychain.")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    .padding(12)
                }
                .padding(.horizontal)

                if let error = state.errorMessage {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            .padding()
        }
        .animation(.easeInOut(duration: 0.2), value: state.duoPending)
        .onAppear {
            if let creds = SessionStore.shared.savedCredentials {
                username = creds.username
                password = creds.password
            }
        }
        .onChange(of: autoLoginEnabled) { _ in
            webViewKey = UUID()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
