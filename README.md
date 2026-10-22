# Seeder OA v0.1.0

First deployable Cloudflare-native OA overlay for **Seeder**. English UI, designed for small companies that want Workers + D1 + R2 without a separate VPS/database server.

## v0.1.0 functions

- Employee profile: employee number, department, job title, manager, join date
- Annual leave entitlement and balance
- Annual / sick / unpaid / compassionate leave
- Full-day / AM / PM half-day requests
- Weekends and configured public holidays excluded from leave day calculation
- Manager approval of direct reports; Owner/Admin global approval
- Employee expense reimbursement with receipt upload to private R2
- Original expense currency and reimbursement currency can differ
- Multi-currency payroll/payslips, including **SGD / USD / IDR / CNY** and other valid ISO currency codes
- Base salary, allowances, bonus, commission, employee/employer contribution, tax, other deductions, gross and net salary
- Payslip PDF/image attachment; employee only sees published payslips
- Owner/Admin can mark approved reimbursement as Paid
- Audit log table
- OA Settings and public-holiday UI
- English interface

## Exchange rates

Default FX source is **Frankfurter v2** (`api.frankfurter.dev`). It is a free public API and does not require an API key. The provider publishes current and historical currency data sourced from central banks and official sources.

For an expense such as:

`IDR 1,500,000 → SGD`

OA requests the rate for the **expense date**, then stores a permanent snapshot in D1:

- original amount/currency
- reimbursement amount/currency
- FX rate
- provider date
- source

Payslips also store their own FX snapshot to the company's reporting currency. Historical payroll/claims are therefore not re-valued when the current rate changes.

Default company/reporting currency is **SGD** and can be changed in Office → Settings.

## One-script Cloudflare deployment

Requirements: Node.js 22+, npm, git, Python 3 and a Cloudflare account.

```bash
npx wrangler login
bash install-and-deploy.sh
```

The installer asks only for:

1. Owner email
2. Public OA URL, e.g. `https://oa.example.com`

It then clones current Seeder, applies the OA overlay, creates/reuses D1 and R2, installs dependencies, configures Worker secrets, runs migrations and deploys with OpenNext.

Non-interactive example:

```bash
OWNER_EMAIL=admin@example.com \
APP_URL=https://oa.example.com \
WORKER_NAME=company-oa \
D1_NAME=company-oa \
R2_NAME=company-oa-files \
bash install-and-deploy.sh
```

After deployment:

```text
https://oa.example.com/sign-in   first Owner account
https://oa.example.com/oa        Office / OA
```

For a custom domain, bind the domain to the created Worker in Cloudflare after/before running the installer.

## Add OA to an existing Seeder installation

```bash
bash apply-to-existing.sh /path/to/Seeder
cd /path/to/Seeder
npm run db:migrate:remote
npm run deploy
```

The overlay uses its own `oa_*` tables and does not modify Seeder's existing project/task tables. It reuses Seeder authentication, owner/admin/member roles, D1 binding `PM_DB`, R2 binding `UPLOADS` and the application shell.

## First login workflow

1. Sign in as the configured Seeder Owner.
2. Open **Office**.
3. Employees → **Sync employees** to create OA employee records for existing Seeder users.
4. Set manager, department, annual leave entitlement, payroll currency and reimbursement currency.
5. Settings → add company public holidays and confirm reporting currency.
6. Employees submit leave/expenses.
7. Managers approve from Approvals.
8. Owner/Admin creates and publishes payslips from Payroll.

## Important v0.1 scope

This release provides **payslip records**, not a country-specific statutory payroll engine. It does not automatically calculate Singapore CPF/SDL/SHG/IR8A or Indonesian/Chinese statutory payroll. The relevant contribution/tax fields are present so payroll data can be recorded safely; statutory calculators can be added as a separate module.

File uploads accept PDF/JPEG/PNG/WebP up to 15 MB and are stored in Seeder's private R2 bucket. Download passes through an authenticated route and checks employee/manager/admin access.

## Compatibility baseline

Checked against Seeder `main` on 2026-09-17:

- Seeder package version 2.0.0
- Next.js 16.2.4
- React 19.2.4
- Better Auth 1.6.9
- `@opennextjs/cloudflare` 1.19.4
- Wrangler 4.86.0
- D1 binding `PM_DB`
- R2 binding `UPLOADS`

Seeder upstream remains MIT licensed. Seeder's name/logo are subject to its upstream trademark terms; this package contains only the OA overlay and installer, not a redistributed copy of Seeder.
