# Seeder OA Multi-Entity Isolation: Implementation Contract

Status: design and security gate; NOT production-enabled.

## Implementation phases and delivery status (2026-10-26)

| Phase | Scope | Status | Release gate |
| --- | --- | --- | --- |
| 1 | Entity registry, membership schema, legacy backfill, server authorization primitives | **Code committed; not deployed** | Review existing employee counts, D1 backup, validate new tables |
| 2 | Entity-scope employees, settings, leave, claims, approvals, payroll, attachments, email and medical allowances | **Phase 2B implementation committed; production and adversarial integration validation pending** | Two-company integration and regression tests must pass before enabling |
| 3 | Entity management, member assignment and per-user Entity switching | **Code committed; not deployed** | Frontend build and staged end-to-end validation |
| 4 | Cross-tenant isolation verification, backup integrity and deployment cutover | **Security fixes, source checks and test tools committed; staging execution and production cutover pending** | Live two-tenant tests plus rollback verification |

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

**Migration integrity gate:** `update-deploy.sh` rejects publishing if any legacy employee lacks either an active `oa_entity_member` mapping or an `oa_entity_employee` scoped profile. The legacy user's manager status comes from `oa_entity_employee` rather than the old single-company `oa_employee` table.

**Feature flag:** `OA_MULTI_ENTITY_BUSINESS_ENABLED` is false by default. It MUST remain unset in production while the two-company integration and rollback tests are pending. Existing legacy Entity remains the sole permitted business context.

### Phase 2B remaining release gates

1. Run the full Next.js build on the applied Seeder source, including unit/integration tests.
2. Apply migrations to a **copy** of production D1 and validate row totals, employee profile values, active membership, approvals, reports, payslips, original R2 keys and nonempty settings.
3. Create two test companies and memberships in the isolated copy. For every GET/POST/R2 route, verify forged record IDs or switched `entity_id` yield 403/404; verify same user with two memberships has independent balances and salary.
4. Verify a company's administrator cannot view, approve, pay, void, export or download another company's records.
5. Check race conditions for medical allowance and approval processing, and verify notification recipients and logs are entity-isolated.
6. Audit snapshot and rollback before any production migration. Only after all gates pass consider enabling the flag and Phase 3 UI.

## Phase 3 — company management and company switcher (implementation committed)

- `overlay/app/api/oa/entities/route.ts`: authenticated list of active memberships; separate management listing for platform super administrators or company administrators. Company creation requires global platform-admin status, flag enabled and a D1 transactional batch. The creator becomes the company's admin.
- New companies receive **standard starter** categories and leave types, rather than copying confidential custom configuration from the existing company.
- Entity-admin membership updates require authorization on the **target** Entity, an existing user, a valid role and an active Entity. Deactivation/demotion cannot remove the last active admin. Create/update/member changes are audit-logged.
- `overlay/components/oa/oa-console.tsx`: company selector, company management, employee authorization and active/inactive member controls; every ordinary OA GET, POST and upload submits the selected `entity_id`.
- Switching Entity **remounts the OA workspace** so old employee, payroll, expense and approval state is discarded. The active selection is stored in the browser session and revalidated against current server membership.
- Direct file and payslip PDF links include the selected Entity. Source URL choice is never authorization: the backend validates active membership on every request.
- All write operations in company management stay disabled while `OA_MULTI_ENTITY_BUSINESS_ENABLED` is not true; read-only member audits remain accessible.

## Phase 4 — security audit and automated verification

**Vulnerability fixed during Phase 4 review:** `overlay/app/api/oa/payslips/[id]/pdf/route.ts` previously queried by payslip ID alone and treated global Seeder admins as entitled to any PDF. It now checks Entity membership, restricts the payslip query to the selected Entity, uses the correct company's employee profile and settings, and checks Entity admin role. All PDF download links include the Entity.

**Additional Phase 4 database protection (`9017_entity_database_guards.sql`):** SQLite triggers now prevent removal of the last active Entity admin, forbid cross-company Claim/ExpenseItem/Document joins, reject mismatched receipt and leave/payslip attachments, and reject ApprovalSteps linked to records belonging to another Entity. The deployment script explicitly whitelists migration 9017 and refuses release unless all 14 triggers are installed. The offline verifier also checks preexisting relationships for mismatches.

**Management UX:** company administrators can enroll existing Seeder users by exact email, change the role of current Entity members, and activate/deactivate membership without reading another Entity's roster. Company creation uses default catalog entries instead of cloning Legacy Entity's customized configuration. Company and membership mutations are audit-logged.

**Checks committed:**
- `scripts/check-phase2b-isolation.mjs`: Phase 2B implementation structural checks.
- `scripts/check-phase34-release.mjs`: Phase 3/4 static checks for switcher, backend permissions, PDF/R2 direct download protection, management controls, and feature flag. `update-deploy.sh` executes both static checks **before** contacting Cloudflare.
- `scripts/test-phase4-http.mjs`: read-only two-company black-box authorization suite, for a disposable **staging** environment with A-only/B-only accounts. Requires test cookies and foreign file/PDF fixtures. The suite refuses to run against `oa.smartenx.com` and requires that staging multi-Entity business access is enabled and memberships are exclusive.
- `scripts/verify-phase4-db.py`: reads an exported D1 SQL snapshot locally in memory, checks legacy profile/membership backfill, Entity ownership of all sensitive tables, claim/item consistency, admin existence, foreign keys and entity-scoped medical triggers. Does not mutate the production database.

### Required Phase 4 acceptance execution

**Do not mistake committed test scripts for executed tests.** There is no staging URL, authenticated A-only/B-only fixtures or exported D1 snapshot accessible in this implementation session, so **Phase 4 is NOT certified**.

1. Apply the reviewed overlay to a temporary Seeder checkout and run the complete Next.js build and existing OA tests. Run `node scripts/check-phase2b-isolation.mjs /path/to/app` and `node scripts/check-phase34-release.mjs /path/to/app`.
2. Export and restore a copy of production D1 to a disposable staging database. Verify legacy row totals, existing payslips, attachments and medical balances. Run `python3 scripts/verify-phase4-db.py /path/to/staging-export.sql` after migration.
3. Create two separate company fixtures and two users with *exclusive* membership. Attach one receipt and one payslip to company B, then supply `PHASE4_BASE_URL`, `PHASE4_ENTITY_A`, `PHASE4_ENTITY_B`, `PHASE4_USER_A_COOKIE`, `PHASE4_USER_B_COOKIE`, `PHASE4_FILE_B` and `PHASE4_PAYSLIP_B` to `node scripts/test-phase4-http.mjs`.
4. Exercise authorized create/edit/delete/approve/reject/mark-paid/payroll issuance for **both** companies; verify direct record-ID substitution, batch approvals and notification recipient isolation. These are state-changing tests and must run only on staging fixtures.
5. Demonstrate rollback against a restored snapshot, document results and only then consider enabling the production feature flag, authorizing new Entity creation and initiating the production rollout.

**Current state:** Phase 3 code implemented; Phase 4 audit found and fixed a PDF authorization gap, and automated test scripts/deploy checks exist. Real staging tests, CI build and production migration/deployment have **not** been executed or verified here. `OA_MULTI_ENTITY_BUSINESS_ENABLED` must stay unset/false in production.

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
