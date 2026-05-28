# HRS Desktop Future Upgrade Rules

Use this file before every HRS Desktop release or in-app updater test.

## Release versioning

- Use real semantic versions for tags: `v1.0.0`, `v1.0.1`, `v1.1.0`.
- Do not use short tags like `v1` for updater releases.
- `package.json`, `package-lock.json`, the Git tag, and uploaded artifact names must all match the same version.
- The release tag must point at the commit that contains the version bump and release/build changes.

Recommended flow:

```bash
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release HRS Desktop v<version>"
git tag -a v<version> -m "HRS Desktop v<version>"
git push origin main
git push origin v<version>
```

## macOS signing rule for in-app updates

The macOS updater validates the downloaded app against the installed app's code-signing requirement.

Current local development signing requirement:

```text
identifier "com.b4db1r3.hrsdesktop" and certificate leaf = H"43434b884a335f8543c1a3d397cc876182d02be1"
```

That certificate is the local `frida-cert` identity.

For the next in-app update to work, the new macOS release assets must be signed with the same requirement as the installed app, or the app must be moved to a real Apple Developer ID signing identity and all future releases must keep using that identity.

Do not publish macOS updater assets from an unsigned or ad-hoc CI build. Ad-hoc builds may launch locally, but Squirrel.Mac update validation can fail with errors like:

```text
SQRLCodeSignatureErrorDomain
code failed to satisfy specified code requirement(s)
```

## Local macOS release build with current cert

Until GitHub Actions has a real Developer ID certificate configured, build the macOS release locally and upload those mac assets to the GitHub release.

```bash
rm -rf /tmp/hrs-local-release
HRS_MAC_SIGN_IDENTITY='frida-cert' npm run dist:mac -- --publish never --config.directories.output=/tmp/hrs-local-release
```

Verify the arm64 zip before upload:

```bash
rm -rf /tmp/hrs-release-verify
mkdir -p /tmp/hrs-release-verify
unzip -q "/tmp/hrs-local-release/HRS Desktop-<version>-arm64-mac.zip" -d /tmp/hrs-release-verify
codesign --verify --deep --strict "/tmp/hrs-release-verify/HRS Desktop.app"
codesign -d -r- "/tmp/hrs-release-verify/HRS Desktop.app"
```

The designated requirement must match the installed app's requirement.

Upload with names that match `latest-mac.yml`:

```bash
gh release upload v<version> \
  "/tmp/hrs-local-release/HRS Desktop-<version>-arm64.dmg" \
  "/tmp/hrs-local-release/HRS Desktop-<version>.dmg" \
  "/tmp/hrs-local-release/HRS Desktop-<version>-arm64-mac.zip" \
  "/tmp/hrs-local-release/HRS Desktop-<version>-mac.zip" \
  "/tmp/hrs-local-release/latest-mac.yml" \
  --repo Commit-Data-BI-Team/hrs-desktop \
  --clobber
```

## Release summary rule

Every upgrade handoff must state what changed since the last release.

Use this format:

```text
Release HRS Desktop v<version>

Edited:
- <file or area>: <what changed>

Added:
- <file or area>: <what was added>

Fixed:
- <user-visible issue fixed>

Release notes:
- <short user-facing summary>
```

Do not publish a release or move a tag without a concise summary of the edits and additions since the previous version.

