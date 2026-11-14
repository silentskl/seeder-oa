# Seeder OA: Cloudflare Workers / D1 / R2 → Ubuntu Docker

This directory builds the **existing Seeder OA overlay** on upstream Seeder
v2.1.0's **native Node/SQLite/local-files** Docker runtime. It does **not**
migrate to PostgreSQL: SQLite preserves D1 SQL tables, IDs and migrations.

## Architecture

| Cloudflare (old) | Ubuntu Docker (new) |
| --- | --- |
| OpenNext Cloudflare Worker | Next.js standalone Node 24 server |
| D1 PM_DB | SQLite, /app/data/seeder.db |
| R2 UPLOADS | /app/data/uploads (with metadata sidecars) |
| D1 Drizzle adapter | Upstream Seeder libSQL Drizzle adapter |
| OA D1 prepare/bind | overlay/lib/oa/node-adapters.ts |
| OA R2 put/get/delete | Upstream local filesystem storage through OA adapter |
| Finance cron Worker | docker compose finance-mail-scheduler every 300s |
| Cloudflare custom domain | Existing HTTPS Nginx reverse proxy to 127.0.0.1:3000 |

**This overlay repo is not the whole Seeder app.** Ubuntu must contain both
this checkout and an upstream Seeder v2.1.0 checkout at
`/data/seeder-oa/seeder-oa-app` (or pass its path to prepare.sh).
Docker builds the **local** app, not the upstream stock image.
Never scale beyond one SQLite-writing application process; keep data on a
local ext4/xfs disk, not NFS.

## 1. Prepare source on Ubuntu 24.04

Install Docker Engine + Compose plugin, git, Python 3.10+ and an HTTPS reverse
proxy. Fetch the current OA overlay and Seeder's pinned upstream source:

```bash
mkdir -p /data/seeder-oa
cd /data/seeder-oa
git clone https://github.com/silentskl/seeder-oa.git .
git clone --depth 1 --branch v2.1.0 https://github.com/danielsyauqi/Seeder.git seeder-oa-app
bash deploy/ubuntu/prepare.sh "$PWD/seeder-oa-app"
cp deploy/ubuntu/.env.example deploy/ubuntu/.env
chmod 600 deploy/ubuntu/.env
```

Set `BETTER_AUTH_URL` to the existing production URL (e.g.
`https://oa.smartenx.com`), and **reuse the exact previous**
`BETTER_AUTH_SECRET`, `VCS_ENCRYPTION_KEY`,
`OA_SETTINGS_MASTER_KEY` and `OA_FINANCE_SYNC_TOKEN`.
Do not generate fresh values merely because the hosting platform changed:
previous sessions, Git provider encrypted credentials, saved ModelBridge keys,
mailbox OAuth secrets and webhooks may otherwise fail to decrypt.

Cloudflare Worker secrets are not retrievable in plaintext through a normal
Wrangler secret listing. Locate them in the original password vault /
deployment secrets backup. If those keys are irrecoverable, encrypted
connections must be re-established and users may need to sign in again.
Never paste secrets into terminal logs or tickets.

Other optional `.env` values: original multi-company flags, Google OAuth
client credentials, Resend secrets and email settings. Review the old Worker
settings before cutover.

## 2. Take a complete READ-ONLY Cloudflare snapshot

Run the snapshot on a **trusted Mac/admin machine** that is authenticated to
the **existing production D1**, and has AWS CLI configured with a *read-only*
R2 S3 API token scoped to the existing bucket.

```bash
cd /Users/sklang/Documents/work/seeder-oa
export CLOUDFLARE_ACCOUNT_ID='<your-cloudflare-account-id>'
export AWS_ACCESS_KEY_ID='<read-only-r2-access-key>'
export AWS_SECRET_ACCESS_KEY='<read-only-r2-secret>'
export R2_BUCKET='seeder-oa-uploads'
bash deploy/ubuntu/export-cloudflare.sh "$PWD/recovery-backups/oa-preflight"
```

This produces `database.sql`, `r2-objects.json` (full R2 manifest) and
`uploads/`. The script performs no database or bucket writes; it rejects
missing or incorrectly sized downloads. It does **not** download secrets.

For the rehearsal, transport this snapshot privately to Ubuntu:

```bash
rsync -a --info=progress2 recovery-backups/oa-preflight/ \
  ubuntu@YOUR_SERVER:/data/seeder-oa/oa-preflight/
```

On Ubuntu:

```bash
cd /data/seeder-oa
python3 deploy/ubuntu/migrate.py import \
  --stage /data/seeder-oa/oa-preflight \
  --data-dir /data/seeder-oa/deploy/ubuntu/data \
  --apply
python3 deploy/ubuntu/migrate.py verify \
  --data-dir /data/seeder-oa/deploy/ubuntu/data
docker compose -f deploy/ubuntu/docker-compose.yml config
docker compose -f deploy/ubuntu/docker-compose.yml up -d --build
docker compose -f deploy/ubuntu/docker-compose.yml ps
docker compose -f deploy/ubuntu/docker-compose.yml logs --tail 100 seeder-oa
```

The importer **refuses to overwrite** a pre-existing `seeder.db` or
`uploads/`. The SQLite import runs in a temporary DB and validates
`integrity_check`, `foreign_key_check`, required tables and OA finance
document references. Original R2 keys map to identical local paths.
Metadata sidecars preserve MIME types inferred from file extensions.
A sensitive `migration-report.json` records original counts and hashes.

**Rehearsal:** Do not update production DNS or point real users at the
test copy. Email scheduler should remain disabled in the rehearsal to
avoid double processing. To run the web app alone use:

```bash
docker compose -f deploy/ubuntu/docker-compose.yml up -d --build seeder-oa
```

Use a separate sandbox domain or localhost with a test-specific auth setup
for application acceptance tests; don't expose the cloned production data.

## 3. Production cutover: repeat snapshot after writes stop

1. Announce maintenance. **Block all writes to the old Worker** including
   API/integrations/webhooks and stop old finance mail cron. Wait for in-flight
   requests to complete. Merely disabling website navigation is insufficient.
2. Take a **new final D1 and R2 export** using `export-cloudflare.sh` to a
   **new snapshot directory**. D1 and R2 cannot be snapshotted atomically:
   keep the old platform frozen across both exports.
3. Stop the rehearsal Docker containers. Make an offline copy of the
   rehearsal data directory, then move it out of the way; never delete
   it without a backup. Import the final snapshot into a **clean** data dir
   and run `migrate.py verify` **before** starting Docker.
4. Verify `BETTER_AUTH_URL`, the existing encryption secrets, and the
   selected multi-entity flags. Bring up the app, then the finance scheduler.
5. Change DNS / Cloudflare reverse proxy origin for the existing HTTPS
   domain to Ubuntu Nginx. Proxy to `http://127.0.0.1:3000` with forwarded
   Host, scheme, and client IP headers; keep TLS on the canonical domain.
6. Confirm user login, OA permissions, employee data, finance Invoice counts,
   R2 invoice/PDF downloads, Google callback, ModelBridge encryption,
   email account connection tests, incremental and historical mail sync,
   and receipt/payment audit evidence. Then enable scheduled finance sync.

Example reverse proxy **inside an existing TLS vhost**:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
    client_max_body_size 16m;
}
```

Do not run Cloudflare and Docker as simultaneous production writers.
If rollback is needed, stop Docker writes and scheduler, then restore traffic
to the original Worker. **Any new records written on Ubuntu after cutover
will not exist in Cloudflare** without a separate reverse migration. Preserve
that data and reconcile it before rollback.

## 4. Operations

```bash
cd /data/seeder-oa
docker compose -f deploy/ubuntu/docker-compose.yml ps
docker compose -f deploy/ubuntu/docker-compose.yml logs -f --tail 100
bash deploy/ubuntu/backup.sh /data/backup/seeder-oa
python3 deploy/ubuntu/migrate.py verify --data-dir deploy/ubuntu/data
```

`backup.sh` briefly stops both containers to archive a consistent SQLite
DB + uploads and restarts them. Store encrypted backup copies off host,
restrict `.env` and `migration-report.json`, and test restore routinely.
The upload directory may be large. Do not use `docker compose down -v`.

## 5. Updates after migration

**Never run the old `apply-to-existing.sh` without `OA_SKIP_DEPLOY=1`
on Ubuntu**, because its default path calls the Cloudflare production
publishing script. Use:

```bash
cd /data/seeder-oa
git pull --ff-only origin main
bash deploy/ubuntu/prepare.sh "$PWD/seeder-oa-app"
docker compose -f deploy/ubuntu/docker-compose.yml up -d --build
```

Check Node-mode migrations in `migrations/` before bringing the new image
online. Upstream Docker entrypoint applies pending checked-in SQLite
migrations automatically. Pre-upgrade backups are mandatory.

### Boundaries

- The upstream stock GitHub image does **not** contain this OA overlay:
  always build `seeder-oa:ubuntu-local` from your patched Seeder checkout.
- This is single-node Node.js + SQLite + local filesystem, not distributed HA.
- No live D1 export, R2 download, server deployment or credential transfer
  occurs from ChatGPT/GitHub commits; operator permissions are required.
