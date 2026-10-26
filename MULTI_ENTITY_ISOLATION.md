# Seeder OA Multi-Entity Isolation: Implementation Contract

Status: design and security gate; NOT production-enabled.

## Implementation phases and delivery status (2026-10-26)

| Phase | Scope | Status | Release gate |
| --- | --- | --- | --- |
| 1 | Entity registry, membership schema, legacy backfill, server authorization primitives | **Code committed; not deployed** | Review existing employee counts, D1 backup, validate new tables |
| 2 | Entity-scope employees, settings, leave, claims, approvals, payroll, attachments, email and medical allowances | **Phase 2B implementation committed; production and adversarial integration validation pending** | Two-company integration and regression tests must pass before enabling |
| 3 | Entity management and membership assignment for platform administrator; per-user Entity selector and context | Not started | No endpoint leaks another Entity via guessed IDs |
| 4 | Full adversarial integration tests, historical reports/backups, deployment cutover | Not started | Two-tenant isolation and rollback tests pass |

### Phase 1 files
- `overlay/migrations/9010_multi_entity_registry.sql`: additive `oa_entity`, `oa_entity_member`, existing-company registry and employee membership backfill.
- `overlay/lib/oa/entity.ts`: fail-closed server-side membership lookup and list of visible Entities, not yet wired to business requests.
- `update-deploy.sh`: allow only reviewed migration 9010 alongside earlier known migrations; back up production D1 before migration, verify legacy entity afterward.

### Production safety note
**Do not add a second active Entity, expose an Entity selector, or rely on membership tables for isolation yet.** Existing OA API, file, approval, payroll and reporting routes remain single-company and do NOT filter by `entity_id`. Phase 1 preserves their behavior; it is deliberately not a finished security boundary.

### Phase 1 acceptance checks
1. Record D1 backup path and verify export is nonempty before migration.
2. Verify `SELECT COUNT(*) FROM oa_entity WHERE id='legacy-primary'` returns 1.
3. Verify `SELECT COUNT(*) FROM oa_entity_member WHERE entity_id='legacy-primary'` equals the count of existing employees with valid user rows.
4. Verify all existing OA employee, expense, leave, payslip, file and category totals are unchanged before/after phase 1.
5. Run current employee login, expenses, approval and payslip smoke tests; no new company is permitted until Phase 4.

### Design detail requiring care during Phase 2
The current `oa_employee` profile is keyed by `user_id` and the current `oa_settings` row is keyed by constant `id=1`; both require real per-Entity ownership, not a cosmetic UI filter. Legacy attachment keys under `oa/<user_id>/...` must remain accessible to authorized legacy users while new keys should be Entity-prefixed. All mutation routes must scope ownership **before** invoking approval, finance or file operations.

## Phase 2A implementation (code committed, production not verified)

- `9011_entity_ownership_foundation.sql`: adds indexed non-null `entity_id` defaulting to `legacy-primary` on employee, leave, expense claim, expense item, approval step, payslip, file and audit log records. **No ownership changes or deletions**, only legacy labeling.
- `overlay/lib/oa/entity.ts` exposes `requireLegacyOaAccess()`, rejecting unauthorized users and requests for any non-legacy Entity.
- `overlay/app/api/oa/route.ts`: GET/POST fail closed on missing active primary membership, with HTTP 403 rather than unhandled 500; sync and admin employee registration add primary Entity membership.
- `overlay/app/api/oa/files/[id]/route.ts`: upload/download check primary membership; file retrieval SQL also restricts `entity_id`; new R2 uploads are saved under `oa/legacy-primary/...` while old keys remain usable via existing metadata.
- `update-deploy.sh`: reviewed migration 9011 is allowed and verified; backup occurs before pending migrations.

**Still NOT safe to create or use a second Entity:** existing settings, leave types, holidays and expense categories remain global; employee profile keys are not yet composite; most business queries and workflow updates still use global IDs or user IDs. Phase 2B must refactor those with mandatory entity scope, separate category/settings per company, isolate exports and emails, and add adversarial tests **before enabling** Entity creation or a switcher.

### Phase 2A operational acceptance

1. Verify both migrations 9010 and 9011 were backed up, applied, and their row counts match original tables; inspect Cloudflare D1 logs for any migration errors.
2. Verify every legacy row has `entity_id='legacy-primary'` and each active employee belongs to `oa_entity_member`.
3. Verify authorized login and admin employee sync, leave, expense claim, approval, payroll and attachments still work.
4. Verify unassigned authenticated users receive 403 for `/api/oa` and cannot download another user's attachment.
5. Verify requests with `entity_id` not equal to `legacy-primary` receive 403.
6. Do **not** deploy a tenant-selection UI or allow creating a second active Entity while Phase 2B remains incomplete.

## Phase 2B implementation summary (code complete for staging, NOT yet production certified)

The Phase 2B implementation now has entity-aware business API paths, using `resolveBusinessEntityAccess` as the server authorization entry point. The client-supplied `entity_id` selects an entity only **after** validation against current user membership and role; it is never treated as proof of authorization.

| Domain | Implementation |
| --- | --- |
| Employee and manager | `oa_entity_employee` composite `(entity_id,user_id)` key; old `oa_employee` retained and trigger-mirrored for legacy records; manager lookup and admin roster are scoped |
| Settings, categories, holidays and leave catalog | `oa_entity_settings`, `oa_entity_expense_category`, `oa_entity_holiday`, `oa_entity_leave_type`; settings and calendar APIs read entity-specific tables |
| Expense and leave | Claims, claim items, leave requests, medical summaries, history and mutation targets use their owning Entity; receipt/document references verify company |
| Approval | Workflow steps use `company_entity_id` (distinct from business record `entity_id`) and verify source ownership and active company before decisions |
| Payslip | Payroll employee profile lookup, creation, publishing, voiding and listing apply company scope |
| Attachment | Direct R2 download requires server-side membership plus file Entity lookup; uploaded object keys contain company ID |
| Email/audit | Notification settings, email logs, audit logs and recipients are scoped to company context |
| Medical allowance | `9016` restores SQLite-level annual allowance validation partitioned by `entity_id` and user |

**Schema migrations:** `9012_entity_settings_categories.sql`, `9013_entity_employee_profiles.sql`, `9014_email_log_company.sql`, `9015_entity_leave_types.sql`, `9016_entity_medical_allowance.sql`.

**Static gate:** `node scripts/check-phase2b-isolation.mjs overlay` checks critical paths in the reviewed overlay. `update-deploy.sh` now runs the same guard against the applied app before it contacts production D1 and runs backup/migrations. This guard checks implementation shape; it does not substitute for exercised request, authorization, payroll, R2 and migration tests.

**Feature flag:** `OA_MULTI_ENTITY_BUSINESS_ENABLED` is false by default. It MUST remain unset in production while the two-company integration and rollback tests are pending. Existing legacy Entity remains the sole permitted business context.

### Phase 2B remaining release gates

1. Run the full Next.js build on the applied Seeder source, including unit/integration tests.
2. Apply migrations to a **copy** of production D1 and validate row totals, employee profile values, active membership, approvals, reports, payslips, original R2 keys and nonempty settings.
3. Create two test companies and memberships in the isolated copy. For every GET/POST/R2 route, verify forged record IDs or switched `entity_id` yield 403/404; verify same user with two memberships has independent balances and salary.
4. Verify a company's administrator cannot view, approve, pay, void, export or download another company's records.
5. Check race conditions for medical allowance and approval processing, and verify notification recipients and logs are entity-isolated.
6. Audit snapshot and rollback before any production migration. Only after all gates pass consider enabling the flag and Phase 3 UI.

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
