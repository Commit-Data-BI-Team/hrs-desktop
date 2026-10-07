# HRS Desktop Changelog

## Unreleased

- Tagged releases can be marked Latest and update Windows in-app while macOS remains a clearly labeled manual DMG installation until Developer ID signing is available.

## 1.0.20

### Shared-task time logging

- Quick Log shared-task and overall-project gauges now retain cumulative hours and contributor totals when switching calendar months; lifetime budget checks use the same all-time totals.
- Fixed Quick Log blocking time entries for shared tasks that have their own Jira work item but no customer-to-Epic mapping. The selected task now keeps its linked Jira issue and allows logging when the HRS task, date, time, and comment are valid.
- Retries macOS installer packaging when GitHub's disk-image utility temporarily reports a busy image; signing and other build failures still stop the release.
- Deliberate version tags can publish verified manual-install packages without advertising an unsigned macOS automatic update; signed releases remain required for in-app updates.

## 1.0.19

### Jira sprint management

- Added a compact Jira Sprint Board directly inside the normal HRS tray window, with status tabs and Supabase contributor totals that do not open another window.
- Added an explicit **Expand** action that opens the existing full board inside the main HRS application window; the expanded view closes with its own top-right **X**.
- Replaced the project and board controls with one searchable selector that automatically combines active and past sprints across the configured Jira projects; future sprints stay hidden.
- Shows the selected sprint's Israel-local start and end dates in both compact and expanded views.
- Shows calendar days remaining until the sprint end and combined mission hours across all sprint tasks, including total Supabase hours used versus the combined task budgets.
- Added a searchable **Reporter** filter sourced from Supabase hours, with each employee's combined sprint hours in the selector and card filtering across every status column.
- Preloads the selected sprint, Jira missions, and Supabase employee totals while other tray tabs are open, caches the last complete view for instant rendering, and refreshes details quietly every minute without clearing the screen into loading states.
- Lets authenticated employees move Jira items from **To Do** to **In Progress** directly from the Sprint Board.
- Added per-reporter **Mark done** confirmations stored in Supabase, including the exact Israel-local confirmation date and time beside every reporting employee.
- Automatically transitions the Jira work item to **Done** only after every employee who reported hours on the shared task has confirmed completion; the consensus is revalidated in the main process before Jira is changed.
- Added expandable Jira task details with the complete description, downloadable attachments and image previews, and the latest Jira comments.

> **Administrator note:** Apply `supabase/migrations/005_sprint_task_completions.sql` before using collaborative sprint completion.
- Keeps active sprints editable and displays completed sprints in a clear read-only history view.
- Uses the authenticated Supabase profile role for access control: managers can drag, transition, and rank Jira cards, while employees receive the complete board as a read-only view.
- Enforces the manager requirement again in the main-process Jira mutation handlers so employee access cannot bypass the disabled UI controls.
- Added drag-and-drop columns for **Backlog**, **To Do**, **In Progress**, and **Done**, with changes saved immediately to Jira.
- Supports moving issues into or out of a sprint, transitioning their Jira status, and reordering cards using Jira rank.
- Resolves Jira cards to their Supabase shared tasks and shows every reporting employee with their individual Supabase hours, total used time, and remaining shared-task budget for the selected sprint dates.
- Added optimistic updates, automatic rollback on Jira errors, a one-click **Undo**, manual refresh, sprint goals, assignees, time progress, and HRS-linked issue badges.
- Keeps each column independently scrollable and adapts the board to smaller Windows and macOS displays without forcing the app fullscreen.

### Local recent-shortcut names

- Added a right-click **Change display name** action to regular HRS recent shortcuts, matching the existing shared-task rename workflow.
- Replaces the complete shortcut label—customer, arrow, and task—with one custom local name, rather than changing only the task portion.
- Limits the alias to that recent-shortcut view; task selectors, reports, HRS logging, Supabase synchronization, and source data keep the original customer, task name, and ID.
- Persists shortcut aliases locally by their stable route and provides a one-click **Restore original** action.

### Simpler Jira and Slack updates

- Rebuilt the customer-update sheet around the message composer and Send action, with compact **Writing tools**, **Delivery**, and **Conversation** disclosures instead of showing every control simultaneously.
- Keeps Jira routing, optional status changes, Slack channel selection, recent threads, attachments, formatting, RTL, and mentions available without overwhelming the default view.
- Moved Jira worklog controls directly below the Task selector and restored comfortable spacing throughout the remaining Quick Log form.
- Makes Jira logging mandatory and non-disableable for fictive/shared tasks, automatically locks the matching Jira work item, and leaves Jira logging off by default for regular HRS tasks.
- Reduced the mandatory fictive-task Jira UI to one read-only **Jira work item** field; the worklog explanation and Required badge stay hidden while enforcement continues internally.
- Removed the verbose Slack posting checklist, bot-scope tutorial, and manual private-channel-ID field; customer mappings now use only channels returned by the normal Slack picker.

### Compact tray header

- Removed the Clockify action from the Quick Log meeting bar and placed the clickable **Missing hours** and **Unreported days** indicators in its former space.
- Reduced the gap between the meeting/status bar and calendar and moved the month, navigation, and calendar content higher in the tray.
- Stacked **Close** above **Pin** on the right edge and reserved navigation space so the Settings icon never overlaps the pin control.
- Collapsed the Overall Project and Shared Task contributor breakdowns by default, keeping only each title, hours, percentage, and gauge visible until its chevron is expanded.
- Removed legacy negative margins that pulled gauges and the duration line into adjacent controls, restoring clear vertical spacing around Task, Jira, gauges, time fields, and comments.
- Fixed the Quick Log **Overall Project** gauge so it keeps the complete Supabase project total, including hours from other tasks in the same project, while the **Shared Task** gauge remains limited to the selected task.
- Made compact Sprint Board columns use a dedicated, visible vertical scroll area so expanded descriptions, attachments, and comments remain reachable without resizing the HRS tray.

### Update reliability

- Checks for updates automatically at every app launch and whenever the tray, Reports, Settings, or Meetings window is opened.
- Keeps the **Update Available** bubble visible without requiring users to press **Check now**, while deduplicating simultaneous background checks.
- Detects incompatible legacy macOS signatures, preserves the release changelog, and offers the correct full Mac installer for the required one-time replacement.
- Requires production macOS releases to use a consistent Developer ID certificate so a broken ad-hoc-signed automatic update cannot be published again.

### Microsoft Teams meeting synchronization

- Fixed meeting sync incorrectly showing Windows Python instructions on macOS.
- Fixed the Python compatibility probe so an installed macOS Python runtime is detected correctly.
- Added explicit macOS Python discovery for Apple, Homebrew, and python.org installations when the bundled runtime is unavailable.
- Made architecture-specific macOS packages embed the complete calendar runtime, matching the Windows installer behavior.
- Detects rejected Microsoft usernames or passwords immediately, shows the real recovery action instead of waiting for a token timeout, and reopens the meeting credentials for correction.
- Verifies DUO server delivery before displaying a push/call success state, detects expired or denied DUO prompts, and tells users to open Duo Mobile manually when phone notifications do not appear.
- Added a **Use Duo passcode** fallback so Microsoft meeting sync can finish headlessly even when Duo push notifications and phone calls are not delivered.
- Replaced the blind post-DUO sleep and 90-second fallback with a bounded redirect watcher that captures Microsoft’s token as soon as Graph Explorer makes its authenticated request.
- Switched meeting authentication to Graph Explorer's native MSAL/PKCE sign-in, handles the post-DUO “Stay signed in?” popup safely, and captures the usable bearer token from the first authenticated Graph request.
- Accepts large real-world attendee lists from company-wide meetings while retaining bounded per-field, per-list, meeting-count, and total-payload validation.
- Added compact yellow **Missing hours** and red **Unreported days** indicators above the tray calendar, with live counts that exclude weekends, future dates, HRS holidays, and Israeli `yomTov` holidays.
- Made each reporting indicator clickable: the chosen category stays bright while unrelated calendar days dim, and clicking it again restores the complete month.
- Replaced the large **Update Jira & Slack** launcher and gauge-level icons with one permanent message bubble beside Task, available for both regular HRS tasks and shared tasks.
- Shared-task selection now automatically enables Jira logging and selects that task's created Jira issue; switching shared tasks switches the work item as well.
- Changed the task-side Jira/Slack bubble to open a smooth in-tray slide-over sheet, preserving the tray's size and scroll position instead of expanding and repositioning the window.
- Suppressed native tray resize/reposition requests while the Jira/Slack sheet mounts, animates, and unmounts, preventing the tray from appearing to close and reopen.
- Expanded Jira from the hard-coded VDA project to **VDA + LSM**: epics, customer mappings, mission creation, worklogs, deletion reconciliation, budgets, and task updates now support either project.

## 1.0.18

### Shared project gauges

- Fixed the **Overall project** gauge so it includes every employee reporting to any shared task in the same customer/project, even when an older report contains mismatched project metadata.
- Reconciles shared-task contributors without double-counting employees already returned by project usage, and refreshes both project and shared-task totals when the Log panel refreshes.
- Keeps each **Shared task** gauge isolated to that task while deriving **Overall project** from the combined hours of every shared task in the project, so later refreshes cannot replace it with an incomplete total.
- Constrained Quick Log fields, gauges, totals, and employee chips to the available tray width on Windows and macOS without horizontal scrolling.
- Moved each gauge's update bubble to the top-right, reserved a dedicated area for the complete hours value, and allowed long project and task names to wrap without truncation.

### Shared task naming

- Added a right-click **Rename shared task** action to recent Quick Log shortcuts.
- Saves the new task name to Supabase and applies it consistently in Quick Log, task selectors, project and task gauges, Reports, and detailed XLSX exports.
- Refreshes historical report labels and connected teammates automatically, while preventing stale cached rows from restoring the previous name.

### Detailed report exports

- Added an **Export XLSX** action directly to the Reports tab for the displayed month.
- Added whole-month and single-customer export scopes with a workbook summary and detailed hour rows.
- Included employee, customer, project, task, start/end times, duration, decimal hours, comments, reporting location, and data source in every available detailed row.
- Shows the actual day-by-day report entries beneath the summary instead of providing aggregate totals alone.
- Added Windows-safe and macOS-safe filenames, customer totals, employee totals, and spreadsheet filters.

## 1.0.17

### Jira and Slack workspace

- Added a compact **Update Jira & Slack** workspace directly inside Quick Log, with independent collapsible Jira and Slack sections.
- Added recent Jira comments and Slack messages with inline replies, refresh controls, correct service names and icons, and downloadable Jira attachments.
- Added Jira status changes, automatic Jira issue selection from the selected shared task with customer-parent fallback, Jira file or image uploads linked to comments, and retry-safe delivery that never reposts a successful destination.
- Added Jira and Slack `@` people search with profile details, shared favorites that appear first, and fast favorite toggles.
- Added message formatting controls, automatic and manual RTL/LTR support, inline images, adjacent image/file attachment actions, and reliable splitting of long Slack messages.

### Project and calendar usability

- Added project favorites that remain at the top of every project list on Windows and macOS.
- Added per-project hiding directly from the project picker and an **Unhide hidden projects** recovery screen in Settings.
- Kept favorite and visibility buttons inside the visible project dropdown without horizontal scrolling, and placed Project, Customer, and Task on separate rows for readability.
- Added Israeli holiday names to calendar cells, dimmed report colors for visible days from the previous month, and greyed visible days from the next month.
- Added a centered **Update Available** bubble above Settings whenever a new release is ready.

### Reporting and reliability

- Prevented historical work reports from counting toward a shared task or global project budget created later in the month, while securely returning complete coworker totals to every authenticated team member.
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
