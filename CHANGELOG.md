# HRS Desktop Changelog

## Unreleased

## 1.0.17

### Jira and Slack workspace

- Added a compact **Update Jira & Slack** workspace directly inside Quick Log, with independent collapsible Jira and Slack sections.
- Added recent Jira comments and Slack messages with inline replies, refresh controls, correct service names and icons, and downloadable Jira attachments.
- Added Jira status changes, automatic Jira issue selection from the selected shared task with customer-parent fallback, and Jira file or image uploads linked to comments.
- Added Jira and Slack `@` people search with profile details, shared favorites that appear first, and fast favorite toggles.
- Added message formatting controls, automatic and manual RTL/LTR support, inline images, and adjacent image/file attachment actions.

### Project and calendar usability

- Added project favorites that remain at the top of every project list on Windows and macOS.
- Added per-project hiding directly from the project picker and an **Unhide hidden projects** recovery screen in Settings.
- Kept favorite and visibility buttons inside the visible project dropdown without horizontal scrolling, and placed Project, Customer, and Task on separate rows for readability.
- Added Israeli holiday names to calendar cells, dimmed report colors for visible days from the previous month, and greyed visible days from the next month.
- Added a centered **Update Available** bubble above Settings whenever a new release is ready.

### Reporting and reliability

- Prevented historical work reports from counting toward a shared task or global project budget created later in the month.
- Improved shared report identity handling so real employee names are displayed instead of automated-test labels.
- Hardened headless Chrome startup and Microsoft Graph token capture for Windows meeting synchronization without opening an unnecessary browser window.
- Removed the experimental missing-customer email request while a fast, administrator-free delivery method is evaluated.

> **Administrator note:** Apply `supabase/migrations/004_usage_date_boundaries.sql` to the connected Supabase project so task and global-project gauges respect their creation dates.

## 1.0.16

### Highlights

- Added reliable, fully headless Microsoft meeting sync on Windows and macOS, with a bundled Python runtime and pinned dependencies in the Windows full installer.
- Added separate shared gauges for overall project hours and selected fictive-task hours, including each employee's hours and percentage contribution.
- Combined coworkers in Cross projects whenever they report to the same customer and project, even when they use different tasks.
- Made personal HRS reports and team Supabase hours load automatically and stay visible through temporary sync or network failures.
- Refreshes project and task gauges after reporting, meeting logging, synchronization, editing, and deletion, while enforcing both caps independently.
- Preserves saved HRS credentials during temporary outages, provides a normal Login to HRS recovery action, and prevents competing sign-in attempts.
- Prevents every tray and application window from opening fullscreen or maximized and safely fits windows to the usable monitor area.
- Isolates automated test sessions from production Supabase and removes the synthetic Acme Labs, Northwind, and Globex report data.

> **Administrator note:** Apply `supabase/migrations/003_global_project_hours.sql` to the connected Supabase project before using global project budgets.

## 1.0.15

### Reliable Microsoft meeting sync

- Captures the complete Microsoft Graph access token from the authenticated calendar request instead of relying on the shortened token shown by Graph Explorer.
- Keeps Microsoft meeting sync fully headless on Windows and macOS without opening a visible Chrome window.
- Searches nested Microsoft/DUO authentication frames and shows the in-app choice between **Send DUO push** and **Make a call**.
- Improved meeting authentication errors so employees receive a short, actionable message instead of a Python traceback.
- Applied the same meeting authentication flow on Windows and macOS.

### Supabase email confirmation

- Added a safe local confirmation page for the `localhost:3000` link already used by the Supabase project.
- Keeps the app ready to receive the email redirect on both Windows and macOS while HRS Desktop is open.
- Added an explicit **Sign in** action after confirmation so a user is never trapped on the confirmation state.
- Applied the correct confirmation redirect to both new sign-ups and resent confirmation emails.

## 1.0.14

### Automatic shared project reporting

- Kept personal Hours, Logged days, and Missing KPIs sourced from Live HRS while loading team cross-project data automatically from Supabase.
- Removed the need for employees to choose an HRS/Supabase source in the tray Reports page.
- Combined coworkers when both reported to the same **customer and project**, even when they selected different tasks.
- Added the project name and each employee's task breakdown to Cross projects so combined totals remain easy to audit.
- Continued to hide the employee-count badge when only one employee is visible.

### Shared project gauges and caps

- Updated the Quick Log gauge to use the combined Supabase total for the selected customer and project across all visible contributors and tasks.
- Refreshes project usage after Supabase sync and whenever the Quick Log tray is reopened or refocused.
- Enforces and displays one combined project cap when multiple capped fictive tasks belong to the same customer and project.
- Keeps the existing local or shared-task calculation as a safe fallback when Supabase is unavailable.

## 1.0.13

### Sticky and responsive tray

- Added a persistent **Pin tray** toggle that keeps the tray open when notifications or other applications take focus on Windows and macOS.
- Added an explicit **Close tray** button while preserving tray-icon and main-window dismissal behavior.
- Added a matching **Keep tray open** option to the tray context menu.
- Protected pinned windows from delayed blur events that could otherwise close the tray unexpectedly.
- Made the tray grow and shrink automatically with the visible content on Windows and macOS.
- Removed unnecessary outer scrolling whenever the content fits within the current monitor's usable area.
- Kept a safe scrolling fallback for content that is taller than the available screen.

### Employee project view

- Hid the employee-count badge when the filtered project view contains only one employee.
- Kept cross-project results limited to projects with two or more visible reporting employees.

## 1.0.12

### Reliable first login and upgrades

- Fixed the first-login credentials flow on Windows and macOS so entering or saving a password no longer enables **Auto-login** by itself.
- Prevented failed automatic login attempts from repeatedly refreshing and resubmitting the HRS login page; the app now falls back to a visible manual login.
- Improved session detection after a successful HRS login so startup waits briefly for the authenticated cookie before continuing.
- Added a one-time upgrade migration that preserves the saved HRS username and password while resetting **Auto-login** to off for users upgrading from the affected version.

### Windows installer safety

- The standard **HRS Desktop Setup 1.0.12.exe** installer now upgrades the existing installation in place using the same application identity and previous install location.
- Existing application data and saved credentials are retained during an upgrade; the old application files are replaced by the new version.
- Removed the alternate installation-directory choice to avoid accidental side-by-side installations.

## 1.0.11

### Shared team tasks and gauges

- Added shared fictive tasks backed by Supabase, so a task created once is visible to every connected team member.
- Combined reported time from all contributors into the same shared progress and cap gauges.
- Preserved the original HRS task for reporting while keeping the shared task, Jira mapping, notes, milestones, and caps synchronized.
- Added automatic migration of existing local fictive tasks into the shared task list.

### Meetings and DUO sign-in

- Added **Send DUO push** and **Make a call** choices directly inside meeting sync when DUO verification is required.
- Added fictive and shared-task selection when logging meetings, including shared gauge updates and the task's Jira target.
- Routed logged meetings to the customer's mapped Slack channel with the meeting, employee, task, Jira, and progress details.
- Fixed packaged meeting sync on macOS Python 3.9 and LibreSSL environments, while retaining Windows Python launcher support.

### Reliable report deletion

- Made single and bulk report deletion reconcile HRS, Supabase, shared gauges, local task mappings, and linked Jira worklogs in a controlled order.
- Added exact Jira worklog recovery by date, time, duration, and comment when an older local link is missing.
- When Jira denies worklog deletion, HRS and Supabase deletion now continue and clearly report that the Jira worklog was kept.
- Added persistent Supabase reconciliation retries so temporary sync failures are retried after restart instead of leaving gauges stale.

### Integration and platform improvements

- Validated Slack channel mappings before saving them and added actionable errors when the bot is missing from a channel.
- Refreshed Jira work-item caches after worklog changes so displayed totals update promptly.
- Hardened Electron bundling for optional WebSocket native modules on both macOS and Windows.

> **Administrator note:** Apply `supabase/migrations/002_shared_fictive_tasks.sql` to the connected Supabase project before enabling shared fictive tasks.

## 1.0.10

- Fixed Windows GitHub Actions release installs by making the macOS-only `electron-liquid-glass` native package optional.
- Kept `liquid-glass-react` available for the renderer while preserving React 18 through npm peer-dependency compatibility settings.
- Kept the app runtime behavior unchanged from the Reports internal-project release.
- Updated release metadata to version `1.0.10` for macOS and Windows auto-update validation.

## 1.0.9

- Fixed GitHub Actions npm install failures by committing npm peer-dependency resolution for the existing React 18 and `liquid-glass-react` dependency combination.
- Kept the app runtime unchanged from the Reports internal-project release.
- Updated release metadata to version `1.0.9` for macOS and Windows auto-update validation.

## 1.0.8

- Moved Comm-IT Corp and Valinor report rows out of Individual projects into a separate Internal projects section.
- Added a Reports checkbox to show or hide Internal projects when internal customer rows exist.
- Kept Cross projects focused on external customer work by continuing to exclude Comm-IT Corp and Valinor from shared-project matching.
- Preserved the existing employee, customer, task, and hours breakdown inside the new Internal projects section.
- Updated release metadata to version `1.0.8` for macOS and Windows auto-update validation.

## 1.0.7

- Temporarily hid the Agenda page from the tray navigation on both macOS and Windows without deleting the Agenda code or backend IPC.
- Temporarily hid the OpenAI Agenda settings card while keeping saved configuration and Agenda implementation intact for later re-enable.
- Hardened packaged Python script resolution so Windows portable builds can run `agenda_fetch.py` and related scripts after self-extraction.
- Added a packaged-script fallback that copies Python scripts from the app bundle into a stable runtime scripts directory when direct script paths are unavailable.
- Improved Python discovery for Windows by supporting the Python launcher through `py -3`, while keeping macOS behavior unchanged.
- Preserved the shared virtual environment flow for meeting and agenda automation across macOS and Windows.
- Kept Microsoft Graph meeting sync and HRS reporting available while Agenda is hidden.
- Kept Supabase shared reports, Slack notifications, Jira mapping, fictive tasks, Quick Log, Reports, Employees, Settings, and update UI available.
- Updated release metadata to version `1.0.7` for macOS and Windows auto-update validation.
