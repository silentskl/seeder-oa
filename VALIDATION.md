# Validation — Seeder OA v0.1.14


## v0.1.14 Medical Insurance checks

- Expense category list includes `Medical Insurance`.
- Admin employee editor persists Annual Medical Insurance allowance in the employee Payroll Currency.
- Medical Insurance submission forces reimbursement currency to Payroll Currency.
- Submission succeeds when projected yearly committed claims are within the limit and returns HTTP 409 when the new claim would exceed it.
- Allowance accounting counts `paid` as Reimbursed and `submitted + approved` as Pending; rejected/cancelled claims do not consume Available.
- Admin can reclassify any expense claim without rewriting the claim's reimbursement amount. Reclassification to Medical Insurance stores a separate expense-date FX snapshot for allowance accounting.
- Overview exposes Total allowance / Reimbursed / Pending / Available.
- Employee Expenses page exposes current-year totals by category/currency.

Validation performed for this release:

- Password recovery uses Better Auth 1.6.9 native `requestPasswordReset` / `resetPassword` flow.
- Sign-in mode exposes **Forgot password?** without changing first-owner or invitation flows.
- `/forgot-password` returns a generic success message for reset requests.
- `/reset-password` validates new/confirm password and handles missing, invalid, or expired tokens.
- Reset token lifetime is configured to 30 minutes and successful reset revokes prior sessions.
- Reset delivery reuses the existing encrypted Resend sender/API-key configuration and is independent of the approval-email toggle.
- Password-changed confirmation email is best-effort and cannot roll back a completed password reset.
- `patch-password-reset.py` is designed to be idempotent and refuses to patch if expected Seeder v2.1.0 anchors are missing.
- D1 migrations are `9000` through `9006`; `9006` adds Medical Insurance allowance/accounting fields and the category/date index.
- Existing D1/R2/auth/payroll/leave/expense data is preserved by the overlay upgrade.
- Shell script syntax (`install-and-deploy.sh`, `apply-to-existing.sh`, `configure-email-secret.sh`) is checked before packaging.
- Python patch script syntax is checked before packaging.
- `lib/oa/email.ts` was additionally checked under TypeScript `strict` mode with `emailSettings(): Promise<EmailSettings | null>` to verify the nullable settings path is fully narrowed before provider fields are accessed.

A full OpenNext/Cloudflare production build should still be executed on the deployment machine with the actual Seeder v2.1.0 checkout and Cloudflare bindings using `npm run build` / `npm run deploy`.
