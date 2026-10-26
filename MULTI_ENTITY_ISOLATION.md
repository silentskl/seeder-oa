# Seeder OA Multi-Entity Isolation: Implementation Contract

Status: design and security gate; NOT production-enabled.

## Non-negotiable invariants
1. Existing smarten-oa D1 data remains owned by one legacy entity; no destructive resets.
2. Every business request resolves an authenticated entity membership on the server; client-provided entity_id is never authorization.
3. Every read, write, count, export, attachment and approval operation is constrained to the resolved entity.
4. Platform super-admin is not a bypass for arbitrary record IDs; explicit selection and server-side enforcement are required.
5. Cross-entity access to object IDs returns 404/403 without disclosing record contents.
6. Historic transaction membership never changes merely because a person changes employers.
7. SQLite DB migrations are additive, backed up and verified before API cutover.

## Data model
- oa_entity(id PK, legal_name, display_name, registration_no, base_currency, active, created_at)
- oa_entity_member(entity_id, user_id, role [admin/manager/employee], active, joined_at, PK(entity_id,user_id))
- oa_entity_settings(entity_id PK, base_currency, approval configuration, FX/email configuration)
- oa_employee: migration to composite entity-scoped identity (entity_id,user_id) with per-entity leave, salary, medical and manager data.
- oa_leave_request, oa_expense_claim, oa_expense_item, oa_approval_step, oa_payslip, oa_file, oa_audit_log, oa_expense_category, leave types, holidays, allowance/salary/payroll and generated reports: entity_id constraints and correct composite relationships.
- oa_file storage: oa/<entity_id>/<user_id>/<kind>/<file_id> ; legacy R2 keys remain usable only through entity-authorized metadata.

## Server request policy
- Read active entity from a signed httpOnly session or validated per-request selected entity, never bare query/body.
- Validate membership and role at every request; scope every lookup by entity_id in SQL before returning data.
- Approval actions must verify claim entity, approver entity membership and current workflow step.
- Employee manager must belong to the same entity; roles in Seeder core are not equivalent to unrestricted OA entity admin.
- Audit events include entity_id; FX and category settings are per entity.
- Authorization checks must also apply to attachment downloads and uploads, exports, summaries, payroll generation and notification recipients.

## Rollout
A. Database inventory and backup of production D1 and R2 metadata. Run isolation test suite against a database clone.
B. Add entity + membership tables; backfill all existing records into the legacy entity; verify row counts and referential integrity.
C. Convert underlying helpers/API/approvals/attachments to mandatory entity-context; default-deny missing or wrong membership.
D. Add entity switcher + entity management for platform admin; avoid mixing entity state in browser caches.
E. Enable multi-entity creation only after two-tenant adversarial tests pass.

## Required isolation tests
- Employee A cannot read/change Employee B if assigned to other entity; direct forged IDs return forbidden.
- Entity admin cannot access other company's claims/payslips/leave/attachments even via direct URL.
- Approval, batch approve, upload, reimbursement and category management respect company boundary.
- Export, reports, dashboard totals, notices, R2 keys, and logs do not leak across entity.
- Same user in A and B gets distinct OA profiles, payroll, leave balances and expense claims.
- Existing legacy rows and attachments remain available to the original authorized personnel.
- Switching active entity invalidates stale cache/request state.
- Migration rollback and backup recovery are verified.

## Deployment gate
Do NOT enable any entity switcher or release new-entity creation until all underlying API/SQL/files/approval paths are scoped and tested. A UI-only entity filter is never security isolation.
