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

## Upgrade an existing v0.1.x installation

```bash
unzip seeder-oa-v0.1.14.zip
cd seeder-oa-v0.1.14

./apply-to-existing.sh /path/to/seeder-oa-app

cd /path/to/seeder-oa-app
npm run db:migrate:remote
npm run build
npm run deploy
```

For the current deployment layout used in earlier releases:

```bash
./apply-to-existing.sh /Users/sklang/Documents/seeder-oa-v0.1.0/seeder-oa-app
cd /Users/sklang/Documents/seeder-oa-v0.1.0/seeder-oa-app
npm run db:migrate:remote
npm run build
npm run deploy
```

v0.1.14 adds migration `9006_medical_insurance_claims.sql`. Existing D1/R2/auth/OA data is preserved; existing employees start with a Medical Insurance allowance of 0 until Admin configures it.


For an existing deployment, configure the encryption secret once before entering a Resend API key in Settings:

```bash
./configure-email-secret.sh /path/to/seeder-oa-app
```

Then deploy the Worker. Fresh installs create `OA_SETTINGS_MASTER_KEY` automatically. Keep `.oa-deploy-secrets` private.

If your package scripts do not expose `db:migrate:remote`, use:

```bash
npx wrangler d1 migrations apply smarten-oa --remote
```

## Fresh install

```bash
npx wrangler login
bash install-and-deploy.sh
```

The installer defaults to the tested Seeder upstream tag `v2.1.0`.

## v0.1.11 payroll UX update

Payroll creation now includes a `Period month` quick selector. Choosing a month fills Period Start and Period End automatically; either date can still be edited manually for custom payroll cycles.

Custom payroll items are edited in a modal dialog rather than an over-compressed inline grid. Each item remains `Name + numeric Amount + Contribution/Deduction` and continues to use the selected payroll currency.
