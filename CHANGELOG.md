# HRS Desktop Changelog

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
