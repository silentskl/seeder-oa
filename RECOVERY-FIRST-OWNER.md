# First Owner recovery — Seeder OA v0.1.3

Seeder 2.1.0 creates a migration-owned sentinel user:

```text
id:    vcs-bot
email: git-integration@seeder.local
```

This is not an employee and has no credential account. Older OA release overlays allowed it to make Seeder believe a real user already existed, so `/sign-in` showed the normal login form and a configured `OWNER_EMAIL` received `Invalid email or password`.

v0.1.3 patches both sides of the bootstrap decision:

1. the `/sign-in` UI ignores `vcs-bot` when deciding whether the first-owner form is available;
2. Better Auth's server-side create hook ignores `vcs-bot` when deciding whether first-owner signup is still allowed.

Do **not** delete `vcs-bot`.

## Upgrade an existing v0.1.0–v0.1.2 installation

```bash
unzip seeder-oa-v0.1.3.zip
cd seeder-oa-v0.1.3

./apply-to-existing.sh /path/to/seeder-oa-app

cd /path/to/seeder-oa-app
npm run build
npm run deploy
```

No D1 migration is required for this hotfix.

Make sure the configured Owner email is correct:

```bash
printf '%s' 'xiaogang@smartenx.com' | npx wrangler secret put OWNER_EMAIL
```

Then open the configured canonical `BETTER_AUTH_URL` at `/sign-in`. If no real user exists yet, the page should show the first-owner account creation form.

You can verify the remote D1 state with:

```bash
npx wrangler d1 execute smarten-oa --remote --command \
'SELECT id,name,email,role FROM "user";'
```

Having only `vcs-bot` is expected and still counts as a fresh instance in v0.1.3.
