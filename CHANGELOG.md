# Changelog

## v0.1.14

- Added `Medical Insurance` Expense category.
- Added per-employee annual Medical Insurance claim allowance in Payroll Currency.
- Added backend annual allowance enforcement for Medical Insurance submissions. Submitted, approved and paid claims reserve the allowance; rejected/cancelled claims do not.
- Added Overview Medical Insurance cards: Total allowance, Reimbursed, Pending and Available.
- Added current-year Expense totals by category and reimbursement currency.
- Added Admin category correction for expense claims across all statuses.
- Historical claims reclassified as Medical Insurance receive a separate Payroll-Currency allowance-accounting snapshot using expense-date FX; original reimbursement values are not rewritten.
- Added migration `9006_medical_insurance_claims.sql`.

## v0.1.13

- Fix TypeScript narrowing in `lib/oa/email.ts` introduced by the password-reset `ignoreEnabled` path.
- Explicitly handle a missing `oa_settings` row before reading email provider configuration.
- Keep password reset email behavior unchanged: account recovery can send even when optional OA notification emails are disabled.
- No database migration changes.

## v0.1.12

- Added self-service **Forgot password / Reset password** flow for email/password accounts.
- Added `/forgot-password` and `/reset-password` pages using Better Auth’s native reset-token flow.
- Reset links expire after 30 minutes and are one-time use.
- Successful password reset revokes all existing sessions for that user.
- Unknown email addresses receive the same generic reset-request response to avoid account enumeration.
- Password-reset and password-changed emails reuse the existing encrypted Resend configuration in Admin → Settings.
- Password recovery is independent of the optional approval-email switch; approval notifications can be disabled without disabling account recovery.
- Added a best-effort password-changed confirmation email after a successful reset.
- Added idempotent `patch-password-reset.py` for Seeder v2.1.0 auth and sign-in UI integration.
- No new D1 migration; Better Auth’s existing verification table stores reset tokens.

## v0.1.11

- Unified employee and administrator post-login experience around the OA interface.
- Successful email/password, invitation, first-owner and Google sign-in flows now use the role-aware `/oa-entry` route instead of Seeder `/projects`.
- `/oa-entry` sends Owner/Admin users to `/admin/oa` and regular employees to `/oa`.
- Existing non-admin sessions that open legacy Seeder `(app)` routes are redirected to `/oa` before project/sidebar data is loaded. This also reduces unnecessary CPU work on Cloudflare Workers Free.
- Employee OA uses the same `OaShell` layout as Admin OA. The OA shell no longer exposes a Seeder workspace link; the product presents a consistent OA-first interface.
- Managers now receive an `Approvals` item in the employee OA sidebar and can process only approval steps assigned to them.
- Added `/oa/approvals` self-service route for managers.
- No D1 schema changes; existing D1/R2/auth/payroll/leave/expense data are preserved.
- Includes all v0.1.10 payroll employee snapshot and PDF payslip functionality.
