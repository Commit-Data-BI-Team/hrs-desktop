# HRS Desktop Release Checklist

## 1. Freeze + tag
- Ensure working tree is clean: `git status`
- Run tests/build:
  - `npm run build`
  - `npm run test:e2e`
- Create release commit and tag:
  - `git add -A`
  - `git commit -m "release: <version>"`
  - `git tag -a v<version> -m "HRS Desktop v<version>"`

## 2. Build artifacts
- macOS: `npm run dist:mac`
- Windows: `npm run dist:win` (recommended on Windows CI runner)

## 3. Cross-platform parity smoke (macOS + Windows)
- Tray icon appears immediately after launch.
- Left click tray icon opens tray window; right click context menu shows only `Quit`.
- Clicking outside tray closes tray window.
- Quick Log:
  - Calendar navigation works (`Prev`; no future month navigation).
  - Day click opens day reports editor; edit/delete works.
  - Tooltip on day hover shows grouped customer info + total hours.
- Reports:
  - Mapped projects render immediately.
  - Expanding mapped project shows tasks and subtasks (no infinite loading).
  - Contributor chips and progress bars render.
- Settings:
  - Access (HRS + Jira) in one tab.
  - Jira mapping section supports reported-this-month + manual mapping.
  - Customer display-name rename reflects across UI.
- Meetings:
  - Fetch progress is visible.
  - Meeting rows render and can log.
- Clockify:
  - Clock history renders.
  - Floating timer opens from tray.

## 4. Security checks
- Verify logs redact secrets:
  - tokens/passwords/cookies/auth headers must not appear in:
    - macOS: `~/Library/Application Support/hrs-desktop/logs/main.log`
    - temp log: `/tmp/hrs-desktop-main.log`
- Verify log rotation:
  - `main.log`, `main.log.1`, ... files created after size threshold.
- IPC strict validation:
  - Unknown fields rejected.
  - Invalid enum/range/type payloads rejected without side effects.

## 5. Publish
- Push commit + tag:
  - `git push`
  - `git push --tags`
- Attach `dist/` artifacts to release notes.

