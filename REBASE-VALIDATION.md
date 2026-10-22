# OA v0.1.14 rebase — local integration candidate

Base: user-supplied seeder-oa-v0.1.14 archive (preserved).
Changes:
- migrations/9007_expense_items.sql: item/document tables and legacy backfill.
- API: createExpenseClaim, item hydration in claims and approvals, retains existing approval workflow and medical allowance checks.
- UI: multiple items per claim, multiple receipt files per item, item details in employee and approval views.
- apply-to-existing.sh: default target to the adjacent seeder-oa-app directory.

Checks performed:
- TypeScript TS/TSX syntax transpilation: zero diagnostics (not a full Next.js build).
- SQLite migration test: legacy receipt migration and second-run idempotency passed.
- No full npm ci / Next.js build, live Cloudflare D1/R2, or end-to-end approval test has been performed.

Caution:
- Not production approved. Verify medical category reports, concurrent medical allowance submissions,
  currency conversion, approval steps, and rollback in staging.
- This archive is a local integration candidate; it is NOT yet committed to GitHub.
- Do not run on production without comparing with current deployed code and making a D1 backup.
