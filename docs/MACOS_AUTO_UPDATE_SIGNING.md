# macOS automatic-update signing

HRS Desktop uses Squirrel.Mac through `electron-updater`. macOS validates that an incoming app
matches the installed app's designated code-signing requirement before replacing it.

## Production requirement

Every production macOS release must be signed with the same **Developer ID Application**
certificate. The release workflow requires these GitHub Actions repository secrets:

- `CSC_LINK`: the exported Developer ID Application `.p12` file, supplied in a format supported by
  electron-builder (normally a base64-encoded value).
- `CSC_KEY_PASSWORD`: the password used when exporting the `.p12` file.

Never commit the certificate or its password to the repository.

The production workflow sets `HRS_REQUIRE_MAC_SIGNING=1`. The build fails before publishing if the
certificate is absent, and the `afterSign` verification fails unless the resulting app has a
Developer ID Application authority and Team ID.

## Migrating legacy installations

Versions through `1.0.18` were ad-hoc signed. An ad-hoc signature uses a designated requirement
based on a code hash that changes in every build, so those versions cannot automatically install a
different build.

Each Mac must install the first properly Developer-ID-signed version once from its full DMG. This
replaces only `/Applications/HRS Desktop.app`; credentials and application data under the user's
Library remain intact. Automatic updates can then validate and install subsequent releases signed
with the same certificate.

## Local development

Local macOS builds may continue to use ad-hoc signing for launch and UI testing. They are not valid
test sources for cross-version automatic installation. Use a Developer-ID-signed production build
to test the complete updater path.
