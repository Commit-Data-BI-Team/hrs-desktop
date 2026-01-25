# iOS App (SwiftUI)

This folder contains a SwiftUI starter for an iOS version of HRS Desktop.

## Generate the Xcode project

This setup uses XcodeGen to create an `.xcodeproj`.

1. Install Xcode from the App Store.
2. Install XcodeGen (if needed):
   - `brew install xcodegen`
3. Generate (or regenerate) the project:
   - `cd ios`
   - `xcodegen`
4. Open `HRSDesktop.xcodeproj` in Xcode.

If you see “Cannot find 'AppBackground' in scope”, the project was generated
before new Swift files were added. Re-run `xcodegen` or add the missing files
to the target membership in Xcode.
5. Set your Team + Signing in the Xcode project.

## Next steps

- Implement API calls in `Services/APIClient.swift`.
- Build login flow in `Views/LoginView.swift`.
- Build main UI in `Views/DashboardView.swift`.
- Store session + Jira tokens in Keychain.
