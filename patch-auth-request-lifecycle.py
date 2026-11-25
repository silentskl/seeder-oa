#!/usr/bin/env python3
"""Keep Better Auth initialization inside the request on Workers."""
from pathlib import Path
import sys
import re

def patch(root):
    p = root / "lib/auth.ts"
    s = p.read_text()
    marker = "OA_AUTH_REQUEST_LIFECYCLE_V1"
    if marker not in s:
        anchor = "export const auth = betterAuth({"
        if s.count(anchor) != 1 or not s.rstrip().endswith("});"):
            raise SystemExit("Unreviewed upstream auth factory; refusing patch")
        s = s.replace(anchor, "function createAuth() {\n  return betterAuth({\n  telemetry: { enabled: false },", 1)
        s = s.rstrip() + """
}

// OA_AUTH_REQUEST_LIFECYCLE_V1
// Never keep a Better Auth context Promise from a Workers request globally.
// Node mode can reuse its process-local instance.
let nodeAuth: ReturnType<typeof createAuth> | undefined;
export function getAuth(): ReturnType<typeof createAuth> {
  if (process.env.RUNTIME === "node") return nodeAuth ??= createAuth();
  return createAuth();
}
"""
    if "export const auth = betterAuth(" in s or "return createAuth();" not in s:
        raise SystemExit("Unsafe auth lifecycle")
    changes = {p:s}
    # Only reviewed import shapes are accepted; no global auth facade that can
    # accidentally capture a request at module evaluation.
    for folder in ("app", "lib", "components", "scripts", "tests"):
        for f in (root / folder).rglob("*"):
            if f.suffix not in (".ts", ".tsx") or f == p:
                continue
            t = f.read_text()
            pattern = r'import\s*\{\s*auth\s*\}\s*from\s*["\x27]@/lib/auth["\x27]\s*;'
            if re.search(pattern,t):
                t = re.sub(pattern,'import { getAuth } from "@/lib/auth";',t)
                t = re.sub(r'\btoNextJsHandler\(\s*auth\s*\)', 'toNextJsHandler((request: Request) => getAuth().handler(request))', t)
                t = re.sub(r'\bauth\.(api|\$context|handler|options|\$ERROR_CODES)\b',r'getAuth().\1',t)
                # Remaining references are not silently guessed. Full typecheck
                # also catches any unsupported import or auth type usage.
                changes[f] = t
    for f,t in changes.items():
        if f.read_text() != t:
            f.write_text(t)
    print("PASS OA request-local auth factory (Workers); lazy Node auth retained")

if __name__ == "__main__":
    if len(sys.argv)!=2:
        raise SystemExit("Usage: patch-auth-request-lifecycle.py /path/to/Seeder")
    patch(Path(sys.argv[1]))
