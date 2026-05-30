# Project Management Expansion

This module expands HRS Desktop from reporting into lightweight project management while preserving the existing Jira workflow.

## Source Ownership

- HRS is the primary operational source for reported hours.
- Jira remains the project execution system and can still receive manual worklogs.
- Dashboards must support `HRS` and `Jira` source toggles for reconciliation and validation.

## Implemented Foundation

- Central customer-to-Jira mapping model.
- One HRS customer can map to multiple Jira project keys and multiple Jira epic keys.
- Mission model for real Jira-backed tasks and virtual UI-only child tasks.
- Mission-to-HRS task association through `hrsTaskIds`, which lets HRS reports drive utilization and caps.
- Planned hours, capped hours, assigned employees, status, timeline, dependencies, and notes.
- Cap validation with utilization thresholds: `50, 60, 70, 80, 90, 100`.
- 70 percent prompt flag for risk workflow.
- Sync/audit log model for every future Jira write or validation decision.

## Current UI

The Reports view now includes a Projects dashboard:

1. Select an HRS customer.
2. Review HRS projects, tasks, and hours reported for the selected period.
3. Create a real mission from an HRS task, or enable `Fictive` to create a virtual child task.
4. Select the original HRS task that feeds utilization.
5. Set the Jira issue key where hours should roll up.
6. Set planned hours and capped hours.
7. Save the mission.

Cap enforcement is active for normal work logging: if a saved mission is linked to the HRS task and the next report would exceed its cap, HRS Desktop blocks the report before submitting it to HRS.

## Sync Rule

Automatic Jira writes must be routed through a reconciliation engine:

1. Load HRS worklogs for employee, date, customer, and task.
2. Resolve the customer mapping to Jira project/epic/issue.
3. Load Jira worklogs for the same employee/date/issue.
4. Compare seconds by employee, task, customer/project, and reporting date.
5. Create a dry-run sync plan.
6. Apply only if sync mode and user policy allow it.
7. Write an audit entry with previous value, new value, source, timestamp, and status.

## Non-Negotiable Safety

Do not directly overwrite Jira worklogs without:

- resolved employee identity,
- resolved target Jira issue,
- cap validation,
- dry-run diff,
- audit entry,
- failure status on partial errors.

## Next UI Surfaces

- Settings: customer/project mapping editor.
- Customer dashboard: timeline, tasks/missions, utilization, remaining hours, employee allocation.
- Reports: source toggle between HRS and Jira.
- Mission editor: virtual task creation and cap management.
- Reconciliation screen: HRS vs Jira differences and planned Jira writes.
