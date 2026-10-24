# Seeder OA v0.1.14

Lightweight English OA/HR overlay for Seeder v2.1.0 on Cloudflare Workers + D1 + R2.

## v0.1.14 Medical Insurance annual claim allowance

- Added **Medical Insurance** to Expense categories.
- Admin can correct the category of any employee expense claim from `Approvals → Expense claim records`, including historical paid/rejected/cancelled claims.
- Each employee now has a configurable **Annual Medical Insurance allowance**. The allowance currency always follows the employee's Payroll Currency; there is no separate medical currency setting.
- Medical Insurance submissions are reimbursed in Payroll Currency and reserve annual allowance immediately. `submitted + approved + paid` claims all consume the allowance, so a new claim is rejected when it would exceed the calendar-year limit.
- Overview and Expenses show Medical Insurance **Total allowance / Reimbursed / Pending / Available**. Reimbursed means `paid`; Pending means `submitted + approved`.
- Admin category corrections do not rewrite the original reimbursement amount. When a historical claim is reclassified as Medical Insurance, OA stores a separate allowance-accounting amount converted to Payroll Currency using expense-date FX.
- Expenses now show current-year reimbursement totals by category and currency so category corrections are immediately reflected in reporting.
- Added migration `9006_medical_insurance_claims.sql`.

## v0.1.13 password recovery + email type-safety fix

Seeder OA includes self-service password recovery for email/password accounts. The sign-in form exposes **Forgot password?**, `/forgot-password` sends a reset link, and `/reset-password` accepts a new password. Reset tokens expire after 30 minutes, are one-time use, and a successful reset revokes the user’s existing sessions. Requests for unknown email addresses return the same generic response as valid accounts.

Password-recovery mail reuses the existing Resend sender/API key stored under `Admin → Settings → Email delivery`. It remains available even if optional approval email notifications are switched off. A successful reset also sends a best-effort password-changed confirmation email.

## Main capabilities

- Employee self-service: Leave, Expenses, Payslips.
- Admin OA navigation: Overview, Approvals, Employees, Payroll, Settings.
- Admin HR master data: department, title, manager, annual leave, payroll currency, reimbursement currency, base salary and personal employment details.
- Employees can view HR/payroll information but cannot edit Admin-owned fields.
- Multi-currency expense and reimbursement claims with historical FX snapshots.
- Configurable Leave and Expense approval flows: Manager only, Admin only, or Manager → Admin.
- Multi-currency payslips with HR snapshot fields, generated PDF download, and optional R2 PDF/image attachments.
- Structured custom payroll items: Name + numeric Amount + Contribution/Deduction type.
- Approval email notifications for Leave and Expense submissions/decisions, plus self-service password-reset mail through the same Resend configuration.

## Currency selection

Every financial workflow exposes an explicit currency selector where currency is configurable:

- Employee Payroll Currency
- Employee Reimbursement Currency
- Expense Currency
- Reimbursement Currency
- Payslip Payroll Currency
- OA Reporting/Base Currency

The payslip currency applies to Base Salary, Allowances, Bonus, Commission, Employee Contribution, Employer Contribution, Tax, Other Deductions and all custom payroll items.

When an employee is selected in `Admin → Payroll`, the form automatically loads the employee's Payroll Currency, Base Salary, Employee ID / Staff No. and Join Date from HR master data. Admin may override the payroll currency or salary values for that payslip. Employee identity/employment values are snapshotted into the payslip when the draft is created, so later HR profile changes do not rewrite historical payslips.

## Custom payroll items

In `Admin → Payroll → Create payslip`, click **Add item**.

Each row contains:

```text
Name | Amount | Type
```

Examples:

```text
Housing allowance | 800.00 | Contribution (+)
Transport allowance | 120.00 | Contribution (+)
Staff loan repayment | 200.00 | Deduction (-)
Other deduction | 50.00 | Deduction (-)
```

Rules:

- Amount is numeric only and must be zero or greater.
- Contribution adds the amount to Gross and Net.
- Deduction subtracts the amount from Net.
- The selected payslip currency applies to all custom items.
- Maximum 20 custom items per payslip.

Payroll formula:

```text
Gross = Base Salary
      + Allowances
      + Bonus
      + Commission
      + Custom Contributions

Net = Gross
    - Employee Contribution
    - Tax
    - Other Deductions
    - Custom Deductions
```

Employer Contribution remains displayed separately and does not reduce employee Net pay.

Old v0.1.6 free-text custom fields remain readable on already-created payslips, but all newly created custom items use the structured numeric format above.



## Payslip PDF download

Published payslips and Admin payroll records expose **Download PDF**. The PDF is generated on demand and includes:

- Employee name and email
- Employee ID / Staff No.
- Join Date
- Job Title and Department
- Payroll period and Pay Date
- Payroll Currency
- Base Salary, Allowances, Bonus, Commission
- Employee / Employer Contributions
- Tax and Other Deductions
- Custom Contribution / Deduction items
- Gross and Net Pay
- Notes

The download route is access controlled: the employee can download their own payslip; Admin/Owner can download employee payslips. Generated PDF responses are private/no-store.

## Email delivery and password recovery

`Admin → Settings → Email delivery` supports:

- Enable/disable approval emails. Password-reset delivery remains enabled when mail credentials are configured.
- Provider: Resend (Cloudflare-friendly HTTPS API; no SMTP socket required).
- From name and From email address.
- Optional Reply-To.
- Resend API key, encrypted before storage in D1.
- Test email.
- Recent delivery/failure log.

Events:

- On Leave/Expense submission: confirmation to the submitter and action-required email to the current approver(s).
- After approve/reject: result email to the submitter and confirmation to the approver who acted.
- For multi-step `Manager → Admin`: after Manager approval, the next Admin approver(s) receive an action-required email.

Email delivery is best-effort: an email provider failure is logged but does not roll back the leave/expense submission or approval decision.

Password recovery:

- Sign-in page → **Forgot password?** → `/forgot-password`.
- Reset links expire after 30 minutes and can be used only once.
- Successful reset revokes existing sessions before the user signs in again.
- Unknown email addresses receive the same on-screen response and do not disclose account existence.
- Reset and password-changed emails use the configured Resend sender/API key even when approval notifications are disabled.

The Resend API key is never returned to the browser. It is encrypted with `OA_SETTINGS_MASTER_KEY`, stored in D1, and decrypted only inside the Worker.

## Navigation

Employee / Workspace mode:

- `Office` → `/oa`

Admin mode:

- `Overview` → `/admin/oa`
- `Approvals` → `/admin/oa/approvals`
- `Employees` → `/admin/oa/employees`
- `Payroll` → `/admin/oa/payroll`
- `Settings` → `/admin/oa/settings`

## Installation, updates and deployment (Cloudflare Workers)

The overlay repository is **not** the Next.js app. Run npm commands in `seeder-oa-app/` (which contains `package.json`), not in the overlay repository root.

**Production Worker:** `smarten-oa` owns the custom domain `oa.smartenx.com`. The legacy `seeder-oa` Worker is **not** the production deployment target. `update-deploy.sh` automatically normalizes the application `wrangler.jsonc` Worker `name` from `seeder-oa` to `smarten-oa` before building, refuses any other name, and preserves D1/R2 binding entries. Before the first publish to `smarten-oa`, compare its existing bindings and secrets in Cloudflare Dashboard against the intended configuration; `--keep-vars` does not protect against incorrect bindings or missing secrets. Keep the legacy Worker until login, expenses, attachments and approvals are verified on the custom domain.

### Existing installation: apply and automatically deploy

```bash
cd /Users/sklang/Documents/work/seeder-oa
git pull origin main
bash apply-to-existing.sh /Users/sklang/Documents/work/seeder-oa/seeder-oa-app
```

`apply-to-existing.sh` checks the target Seeder app, removes legacy conflicting OA routes, copies the overlay, patches sidebar, Wrangler free-plan settings, authentication compatibility, OA entry routing and password recovery. **Only after all patch steps succeed**, it invokes `update-deploy.sh` automatically. A failed patch stops the workflow before deployment.

`update-deploy.sh` validates the local `wrangler.jsonc` Worker name and D1 `PM_DB` / R2 `UPLOADS` bindings, checks Cloudflare authentication and lists remote D1 migrations, then runs `npm run build` followed by `npm run deploy`. It **does not apply database migrations**. It refuses default/incomplete resource bindings and stops when its migration-list output matches OA migration filenames; the check is conservative and is **not** a substitute for inspecting the migration history.

For code-only updates without deployment:

```bash
OA_SKIP_DEPLOY=1 bash apply-to-existing.sh /Users/sklang/Documents/work/seeder-oa/seeder-oa-app
```

To publish an already-applied overlay without reapplying it:

```bash
cd /Users/sklang/Documents/work/seeder-oa
bash update-deploy.sh /Users/sklang/Documents/work/seeder-oa/seeder-oa-app
```

### First-time production configuration and preflight

1. Log into the intended Cloudflare account with `npx wrangler whoami` and inspect its resources with `npx wrangler d1 list` and `npx wrangler r2 bucket list`.
2. In `seeder-oa-app/wrangler.jsonc`, set the production Worker `name` to `smarten-oa`, existing D1 `PM_DB` `database_name` and `database_id`, and R2 `UPLOADS` bucket name. Do **not** use the upstream defaults (`seeder`, `seeder-uploads`) or guess a database ID. Confirm which environment is production, especially when both `seeder-oa` and `smarten-oa` resources exist. Use a separate preview database rather than binding preview operations to production.
3. Inspect current remote migration history **before changing any database**:

```bash
cd /Users/sklang/Documents/work/seeder-oa/seeder-oa-app
npx wrangler d1 migrations list PM_DB --remote
npx wrangler d1 execute PM_DB --remote --command="SELECT * FROM d1_migrations ORDER BY id DESC LIMIT 30;"
```

4. Back up the confirmed production D1 database before applying SQL:

```bash
npx wrangler d1 export PM_DB --remote --output=seeder-oa-before-upgrade.sql
ls -lh seeder-oa-before-upgrade.sql
```

5. Review the pending SQL migrations and existing tables. The overlay currently includes `9000_oa_core.sql` through `9008_medical_allowance_atomic.sql`. Legacy installs may contain `9999_oa_expense_items.sql`, which overlaps the itemized-expenses migration; **do not blindly rerun duplicate SQL or edit migration records**. After reviewing and backing up, explicitly run `npm run db:migrate:remote` (equivalent to `wrangler d1 migrations apply PM_DB --remote`) if required.
6. Re-run the deployment script only after confirming the production bindings and migrations. It builds the app and publishes the Worker, but does not create required Secrets, custom domains, or database schema.

**Data safety:** Editing `wrangler.jsonc` by itself does not delete D1 rows or R2 objects. However, deployment can redirect the Worker to another database/bucket, and SQL migrations can alter data. Preserve the original resource IDs and take a verified backup before production changes. `--keep-vars` retains existing Worker variables where supported; it does not guarantee that a brand-new Worker has all required Secrets.

### Email configuration

For an existing deployment, configure the OA settings encryption key before storing a Resend API key:

```bash
cd /Users/sklang/Documents/work/seeder-oa
bash configure-email-secret.sh /Users/sklang/Documents/work/seeder-oa/seeder-oa-app
```

Keep `.oa-deploy-secrets` private. Confirm the production Worker has `OA_SETTINGS_MASTER_KEY` and the expected email sender configuration. Password reset and approval notification emails should be tested after deployment.

### Fresh install and post-deploy acceptance

For a fresh installation, follow the separate bootstrap entry point:

```bash
npx wrangler login
bash install-and-deploy.sh
```

The fresh installer defaults to the tested Seeder upstream tag `v2.1.0`. Before running it, inspect its resource-creation and migration behavior; the existing-install workflow above is preferred when production D1/R2 data already exists.

After deployment, check sign-in and role routing (`/oa-entry` → `/admin/oa` or `/oa`), expense submission and single/bulk approval, Medical Insurance allowance enforcement, payslip PDF download, file access permissions, and password recovery. A successful `next build` proves compilation only, not production data or runtime correctness.

### Troubleshooting

- `database ... could not be found [7404]`: the D1 `database_id` is not present in the logged-in account. Check `wrangler whoami` and the `PM_DB` binding; do not create an empty replacement database over existing data.
- `Worker does not exist [10007]`: the configured Worker name has no deployment in this account. Confirm the intended Worker name before creating a new one.
- Duplicate `/oa` pages: update the overlay and reapply; the obsolete `app/(app)/oa/page.tsx` must not coexist with `app/(oa)/oa/page.tsx`.
- `npm run build` says `package.json` missing: change into `seeder-oa-app`.
- The publish gate refuses deployment: inspect its reported resource binding or pending migration issue; do not bypass the check until verified.

## v0.1.11 payroll UX update

Payroll creation now includes a `Period month` quick selector. Choosing a month fills Period Start and Period End automatically; either date can still be edited manually for custom payroll cycles.

Custom payroll items are edited in a modal dialog rather than an over-compressed inline grid. Each item remains `Name + numeric Amount + Contribution/Deduction` and continues to use the selected payroll currency.
