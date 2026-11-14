#!/usr/bin/env bash
# Run stdlib migration checks and core finance schema regressions before build/cutover.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
for test in \
 tests/test_ubuntu_migration.py \
 tests/test_finance_mail_backfill_migration.py \
 tests/test_finance_invoice_business_dedup_migration.py \
 tests/test_finance_due_date_review_i18n.py \
 tests/test_finance_migration.py; do
 echo "[ubuntu preflight] $test"
 python3 "$test"
done
echo "[ubuntu preflight] Source/migration tests passed. Next: Docker Node build and real acceptance checks."
