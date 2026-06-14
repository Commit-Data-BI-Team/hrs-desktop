# HRS Desktop Changelog

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
