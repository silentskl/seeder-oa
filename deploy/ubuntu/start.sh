#!/usr/bin/env bash
# Validated Ubuntu launcher; never publishes any Cloudflare resources.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$ROOT/validate-config.py"
# Seeder upstream runtime uses uid/gid 1001. The imported SQLite file and
# R2 objects are typically owned by the operator who ran migrate.py.
# Fix ownership inside a short-lived root container BEFORE the nonroot server.
docker compose -f "$ROOT/docker-compose.yml" build seeder-oa
docker compose -f "$ROOT/docker-compose.yml" run --rm --no-deps --user root \
  --entrypoint sh seeder-oa -ec 'chown -R seeder:seeder /app/data'
if [[ "${1:-}" == "--app-only" ]]; then
  echo "Rehearsal mode: starting application ONLY (mail scheduler disabled)."
  docker compose -f "$ROOT/docker-compose.yml" up -d seeder-oa
elif [[ "${1:-}" == "" ]]; then
  echo "Starting Ubuntu application and isolated finance mail scheduler."
  docker compose -f "$ROOT/docker-compose.yml" up -d
else
  echo "Usage: bash deploy/ubuntu/start.sh [--app-only]" >&2
  exit 2
fi
