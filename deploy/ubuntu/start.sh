#!/usr/bin/env bash
# Validated Ubuntu launcher; never publishes any Cloudflare resources.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$ROOT/validate-config.py"
if [[ "${1:-}" == "--app-only" ]]; then
  echo "Rehearsal mode: starting application ONLY (mail scheduler disabled)."
  docker compose -f "$ROOT/docker-compose.yml" up -d --build seeder-oa
elif [[ "${1:-}" == "" ]]; then
  echo "Starting Ubuntu application and isolated finance mail scheduler."
  docker compose -f "$ROOT/docker-compose.yml" up -d --build
else
  echo "Usage: bash deploy/ubuntu/start.sh [--app-only]" >&2
  exit 2
fi
