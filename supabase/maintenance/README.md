# Manual employee mappings

In HRS Desktop, the authenticated HRS session supplies personal report data.
The current authenticated Supabase user's `public.profiles.employee_id` supplies the
numeric owner. A missing mapping is an actionable pending sync, not a reason to
guess an ID; filling the profile and retrying does not log time in HRS or Jira again.
The desktop app does not assign this field. The optional SQL hardening in this
directory also protects it against older clients and enforces unique assigned
IDs. It is not required by the desktop client and is not run by the repair tool.

## Audit before backfilling

Use the authenticated Supabase CLI with the HRS project ref, **not** the project
dashboard mirror. Use `db query --remote=<HRS-ref> --read-only --file ...` for
the queries in `supabase/audits`. A zero count under the current numeric ID
does not mean a login is unused. Check the auth UUID (`synced_by`), outstanding
invites and related activity. Never merge profiles by name alone.

From the repository root, `node scripts/hrs-report-rekey.mjs --preview-cli /path/to/supabase`
runs only a grouped SELECT. Reports are eligible for repair only with corroborating
upload UUID, unique current mapping/name, a valid old key, and consistent day
snapshots. Disagreeing snapshots are held for comparison with actual HRS records.
No HRS/Jira operations or profile changes are part of this maintenance.

For a separately approved repair, `--emit-reviewed-sql DIGEST REKEY MERGE HOLD`
only **prints** a transaction. Review it before execution. It locks the scope,
rechecks the exact preview, creates private originals and a manifest, rewrites
both the numeric owner and the embedded report key, and removes only copies with
a verified canonical counterpart. It checks other reports, all profiles, seconds
and row counts before commit. The archive remains in schema `hrs_rekey_<digest>`.
`--emit-restore-sql DIGEST` prints a guarded restore transaction; never run it if
the affected rows have changed without a fresh review.

Daily logging, editing and retry use the affected reporting day; browsing old
months does not backfill them. Whole-month reconciliation is explicit. Do not
replay unresolved historical dates until the original HRS day is reviewed.
