# v0.1.14 → Multi-item Claim: release gates

## Current status: **NO-GO**

The source archive contains the OA overlay, not the full Seeder application or its locked dependencies. Therefore a complete Next.js production build cannot be executed here. A successful TypeScript transpilation syntax check is **not** a type-check or a Next.js build.

## Executed tests

| Check | Result | Evidence |
| --- | --- | --- |
| Python SQLite migration on v0.1.14 migrations 9000–9006 | PASS | `python3 tests/test_migrations.py` |
| Legacy claim and receipt backfill | PASS | test_backfill_and_idempotence |
| Re-running 9007 SQL / duplicate prevention | PASS | test_backfill_and_idempotence |
| Two expense items and three document associations, FK and uniqueness | PASS | test_multi_item_multi_doc_constraints |
| TypeScript/TSX syntax across 29 overlay files | PASS | `node tests/check-ts-syntax.cjs overlay` |
| Full `npm ci && npm run build` on complete Seeder | **BLOCKED** | Full application not included in supplied archive |
| Remote Cloudflare D1/R2 | NOT RUN | Requires staging credentials and resources |
| Functional E2E and security regression | NOT RUN | Requires running app and test users |

## Required release gate

From the root of the unpacked release, after applying the overlay to a **staging** Seeder checkout:

```bash
bash apply-to-existing.sh /absolute/path/to/seeder-oa-app
bash scripts/release-gate.sh /absolute/path/to/seeder-oa-app staging
```

The gate fails until the full Next.js build succeeds and `tests/acceptance-signoff.env` exists with **all** required categories set to `PASS` based on real staging results. Start with `tests/acceptance-signoff.env.example`; never copy it unchanged and claim acceptance.

For production: `bash scripts/release-gate.sh /absolute/path/to/seeder-oa-app production`. This additionally requires verified D1 backup and rollback plan.

### Staging acceptance matrix

1. Remote migration: run the correct D1 migration; check table schema, migration ledger, historical claim and receipt counts, and no FK violations.
2. R2: upload 2 PDFs and 3 images across a single claim; retrieve all as the owner and authorized approver; unauthorized user must receive 403.
3. Multi-item: one claim with 3 expense items and 7 documents; total equals sum of FX-snapshotted item reimbursement values. Check zero/negative amount, invalid currency, duplicate or foreign file IDs, and >20 attachments rejection.
4. Approval: manager → admin flow, reject, cancel, mark paid; no cross-employee access; ensure status history and notifications.
5. Medical Insurance: annual limit, prior paid/submitted/approved claims, payroll currency, year boundary, category corrections, and concurrent submissions. **Concurrency needs special scrutiny** because the current allowance check precedes claim insert and is not serialized.
6. Legacy: old single-item claims, receipts, existing payroll/payslip PDFs, leave records, password reset, and email settings.
7. Regression: verify category reporting correctly aggregates **item categories**. Current implementation still groups `oa_expense_claim.category` and may show multi-category claims as `Other`—this is a known release blocker until corrected and tested.
8. Recovery: restore prior Worker revision, verify D1 export can be restored to an isolated test database, and verify the R2 bucket remains intact.

### Known release blockers

- Full application build unavailable in this environment.
- Category reporting uses the claim header category for mixed-item claims, not per-item category; needs correction.
- Medical annual-limit concurrency requires a server-side strategy/test to prevent two simultaneous claims exceeding allowance.
- Actual remote migration, authorization and workflow integration tests have not been executed.

Do **not** deploy this package to production until all blockers are resolved and gates pass.

## Atomic Medical Insurance allowance
Migration `9008_medical_allowance_atomic.sql` adds SQLite BEFORE INSERT/UPDATE guards for Medical Insurance claims. The D1 database serializes writes, so a second competing claim exceeding the annual limit fails atomically (HTTP 409). Both legacy and multi-item claim APIs use the same guarded header. Apply migration 9008 after 9007. Existing over-limit records are not silently changed: audit them before release. Test with `python3 scripts/test-medical-allowance.py`. Changes to employee payroll currency or allowance require a separate reconciliation policy; do not change payroll currency for an employee with active medical claims without reviewing snapshots.
