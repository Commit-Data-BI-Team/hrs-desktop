# HRS Desktop Changelog

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
