# Seeder OA — installation and upgrade guide

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

## Repository layout and script selection

This repository contains an **OA overlay** and a Git submodule `seeder-oa-app/` pointing to upstream Seeder. The overlay is copied into the actual Seeder application; changing the overlay alone does **not** update a deployed Worker.

| Script / file | Actual behavior | When to use |
| --- | --- | --- |
| `install.sh` | A convenience wrapper with hard-coded owner email, production URL, Worker, D1 and R2 names; calls `install-and-deploy.sh`. | **Only** when intentionally provisioning that specific environment; inspect its values first. |
| `install-and-deploy.sh` | Clones Seeder if target has no Git checkout, applies overlay, runs `npm ci`, creates/reuses D1 and R2, rewrites `wrangler.jsonc`, configures secrets, runs remote migrations and deploys. | First-time Cloudflare installation. **Not the default upgrade command.** |
| `apply-to-existing.sh TARGET` | Copies `overlay/.` into an existing Seeder checkout and patches its sidebar. Does **not** migrate the database, install dependencies, build or deploy. | Upgrade or add OA to an existing Seeder app. |
| `patch-sidebar.py` | Called by `apply-to-existing.sh` to add the Office navigation entry. | Internal helper; normally do not run separately. |
| `overlay/migrations/*.sql` | D1 migration sources, copied into the Seeder application's `migrations/` folder by the overlay script. | Applied through the Seeder migration command. |

**Safety notes:** `install.sh` contains environment-specific values. `install-and-deploy.sh` may change production bindings and authentication secrets; rerunning it in a different target directory can generate new secrets. Neither script is a backup/rollback mechanism. Do not use them as an automatic upgrade of an existing production deployment.

## Prerequisites and environment checks

- Node.js **22+**, npm, Git, Python 3; Cloudflare Wrangler login and permissions for the correct account.
- The existing Seeder app must have `package.json`, `wrangler.jsonc`, a working `npm run db:migrate:remote` and `npm run deploy`.
- Confirm the D1 binding is `PM_DB` and the R2 binding is `UPLOADS`. Record the actual Worker name, D1 database ID and R2 bucket before deployment.
- Check `git status` in **both** the OA repository and `seeder-oa-app/`. Updating the submodule to the upstream commit may change the Seeder baseline and should be intentional.
- Back up D1 before applying migrations, and preserve the existing Worker configuration, secrets and R2 data. Use a staging environment first.

## A. First-time Cloudflare installation

From the root of the OA repository:

```bash
node --version
npm --version
npx wrangler login
npx wrangler whoami
# Choose ONE installation method:
bash install-and-deploy.sh
```

The installer prompts for `OWNER_EMAIL` and `APP_URL`, unless supplied through the environment. An explicit configuration example:

```bash
OWNER_EMAIL=admin@example.com \
APP_URL=https://oa.example.com \
WORKER_NAME=company-oa \
D1_NAME=company-oa \
R2_NAME=company-oa-files \
TARGET_DIR="$PWD/seeder-oa-app" \
bash install-and-deploy.sh
```

It performs these operations in order:

1. Validate prerequisites and clone Seeder if the target is not already a Git checkout.
2. Copy OA overlay and patch the application sidebar.
3. Install dependencies using `npm ci`.
4. Authenticate Wrangler, create or find the named D1 database, and create/reuse the R2 bucket.
5. Rewrite Worker and database/bucket names in `wrangler.jsonc`.
6. Configure Worker secrets, retaining generated keys only when `.oa-deploy-secrets` exists in the same target working directory.
7. Run `npm run db:migrate:remote` and `npm run deploy`.

Verify the Worker domain/route in Cloudflare and visit `https://oa.example.com/sign-in` and `https://oa.example.com/oa`. If using a custom domain, bind it to the Worker through Cloudflare. **Do not use the production-specific `install.sh` unless its configured values are exactly intended.**

## B. Upgrade an existing OA deployment (recommended)

**Run the following from the OA repository root.** These commands assume the existing deployed Seeder source is `./seeder-oa-app`; replace that path if your actual deployment uses a different directory. Verify the PR/feature commit has been merged to `main` before updating.

### 1. Inspect and back up

```bash
pwd
git status --short
git checkout main
git pull --ff-only origin main
git submodule status
git -C seeder-oa-app status --short
```

If `seeder-oa-app` is absent, initialize it **only after checking the intended upstream revision**:

```bash
git submodule update --init --recursive
```

Back up the production D1 database **using the correct configured database name** (example below), and keep the resulting SQL file outside the Git checkout:

```bash
mkdir -p "$HOME/oa-backups"
cd seeder-oa-app
npx wrangler d1 export YOUR_D1_DATABASE_NAME --remote --output "$HOME/oa-backups/oa-before-upgrade.sql"
cd ..
```

Also save the existing `seeder-oa-app/wrangler.jsonc`, Worker secret names, and deployed commit identifier. Do not overwrite existing production secrets.

### 2. Apply overlay, install and compile

```bash
bash apply-to-existing.sh ./seeder-oa-app
cd seeder-oa-app
npm ci
npm run build
```

If `npm run build` is not defined by the upstream Seeder package, inspect `package.json` and use its documented OpenNext build command. Stop on any failure; do not deploy an unverified build.

### 3. Apply the D1 migration

This release adds `oa_expense_item` and `oa_expense_item_document`. Its migration source is `overlay/migrations/9999_oa_expense_items.sql`. It converts each existing single-item Claim into one item and links its previous receipt to that item. The migration is designed for existing `oa_expense_claim` and `oa_file` tables.

```bash
# Still inside seeder-oa-app
ls migrations/*oa*
npm run db:migrate:remote
```

**Important:** Check the migration output and the configured D1 target. `npm run db:migrate:remote` is the upstream Seeder script; confirm that it applies the new SQL migration and is not targeting a local or staging database. Do not run the SQL manually after the migration has been recorded as applied.

Verify the two tables and migrated legacy records against the **correct production D1 database**:

```bash
npx wrangler d1 execute YOUR_D1_DATABASE_NAME --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('oa_expense_item','oa_expense_item_document');"
npx wrangler d1 execute YOUR_D1_DATABASE_NAME --remote --command "SELECT COUNT(*) AS claim_count FROM oa_expense_claim;"
npx wrangler d1 execute YOUR_D1_DATABASE_NAME --remote --command "SELECT COUNT(DISTINCT claim_id) AS migrated_claims FROM oa_expense_item;"
```

The number of distinct migrated claim IDs should match the number of claims, assuming there are no pre-existing orphaned or incomplete records. Investigate mismatches before deploying.

### 4. Deploy the existing Worker

```bash
npm run deploy
```

This deploys with the **existing** `wrangler.jsonc` bindings. Do not rerun the first-time installer just to publish the new code.

### 5. Functional acceptance test

- Sign in as a normal employee; submit **one Claim with three items** (for example SGD 35 transport, SGD 80 meals and SGD 120 medical).
- Attach **two or more** PDF/image files to one item; test multiple files on other items. Accepted file types: PDF/JPEG/PNG/WebP, maximum **15 MB per file**.
- Check that the Claim total is SGD 235, all three items appear, and all uploaded documents can be opened.
- Sign in as the employee's manager/admin: verify the three item descriptions, dates, amounts, documents and total, then approve or reject the whole Claim.
- Confirm historical Claims still show their original receipts; verify existing leave, payroll, and employee screens.
- Test invalid uploads, invalid amounts, access permissions and a failed upload before production sign-off.

## C. Apply OA to an existing Seeder installation for the first time

From the OA repository root:

```bash
bash apply-to-existing.sh /absolute/path/to/Seeder
cd /absolute/path/to/Seeder
npm ci
npm run build
npm run db:migrate:remote
npm run deploy
```

Ensure that the existing Seeder Worker already has the required `PM_DB` and `UPLOADS` bindings and all necessary secrets. This method does not provision D1, R2 or secrets.

## Troubleshooting and recovery

- **`package.json not found` / `target is not the Seeder repository`:** pass the actual Seeder app directory, not the OA repository root.
- **Migration not found:** verify `apply-to-existing.sh` copied the SQL file into the application's `migrations/` directory and check the upstream migration script.
- **Wrong Cloudflare account/database:** check `npx wrangler whoami` and `wrangler.jsonc` before running remote migration or deployment.
- **Compilation fails:** do not deploy; retain the current Worker and inspect TypeScript, module imports and the upstream Seeder revision.
- **Migration fails:** stop deployment; retain the backup and inspect the database/migration ledger before retrying. Do not blindly rerun raw SQL.
- **Application fails after deployment:** restore the previous application revision/Worker deployment. Database rollback is **not** automatically performed; restoring a D1 backup is a separate, potentially destructive operation requiring a recovery plan.

**Release validation status:** the multi-item Claim code and migration have been committed, but a complete upstream dependency build and live D1/R2 integration acceptance are not established by this README. Treat the production rollout as requiring the above checks.

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
