# Seeder OA v0.1.0 validation

## Completed in release build

- Overlay contains actual Next.js page, API routes, D1 migration, R2 file route, FX module, leave-day module, money module and UI.
- TypeScript parser check completed; no syntax errors were found in the overlay. Import-resolution errors are expected when checking the overlay outside the upstream Seeder node_modules tree.
- Removed Cloudflare-specific `fetch(..., { cf: ... })` RequestInit extension so the overlay does not rely on extra ambient TypeScript augmentation.
- OA data is isolated under `oa_*` tables.
- Authentication reuses Seeder `getViewer()` and its owner/admin/member role.
- Manager authorization checks `oa_employee.manager_user_id` server-side.
- Employee published payslips are filtered by logged-in user server-side.
- R2 files are private and retrieved through an authenticated endpoint.
- Expense and payslip FX values are snapshots, not live-computed display-only values.
- Multi-currency amount conversion uses `Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits` for the selected currency rather than assuming every currency always has two decimals.
- Sidebar patch fails explicitly if the expected upstream structure changes.

## Environment limitation

This execution environment cannot resolve `github.com` from `git clone`, so I could not execute upstream `npm ci && npm run build` against a locally cloned Seeder repository here. Current Seeder source interfaces were checked directly from the upstream repository through web retrieval. The deployment script itself runs `npm ci`, migrations and OpenNext deployment and stops immediately on a build/deploy error.
