#!/usr/bin/env python3
from pathlib import Path
import re, sys

if len(sys.argv) != 2:
    raise SystemExit("Usage: patch-wrangler-free.py /path/to/wrangler.jsonc")

p = Path(sys.argv[1])
if not p.is_file():
    raise SystemExit(f"ERROR: {p} not found")

s = p.read_text()
original = s

# Seeder upstream currently ships a top-level Paid-plan CPU cap:
#   "limits": { "cpu_ms": 30000 },
# Cloudflare rejects user-configured CPU limits on Workers Free (100328).
# Remove only a top-level limits object that contains cpu_ms. This leaves
# all other bindings/configuration untouched.
pattern = re.compile(
    r'(?ms)^\s*//[^\n]*CPU[^\n]*\n(?:\s*//[^\n]*\n){0,5}\s*"limits"\s*:\s*\{\s*"cpu_ms"\s*:\s*\d+\s*,?\s*\}\s*,?\s*\n'
)
s2, n = pattern.subn('', s, count=1)
if n == 0:
    # Fallback for configs without the explanatory comments.
    pattern2 = re.compile(
        r'(?ms)^\s*"limits"\s*:\s*\{\s*"cpu_ms"\s*:\s*\d+\s*,?\s*\}\s*,?\s*\n'
    )
    s2, n = pattern2.subn('', s, count=1)

if s2 != original:
    p.write_text(s2)
    print(f"Removed Paid-only CPU limit from {p}")
else:
    print(f"No Paid-only CPU limit found in {p}; no change needed")
