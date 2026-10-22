#!/usr/bin/env python3
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("Usage: patch-oa-entry.py /path/to/Seeder")

root = Path(sys.argv[1])
signin_page = root / "app/(auth)/sign-in/page.tsx"
signin_panel = root / "components/auth/sign-in-panel.tsx"
app_layout = root / "app/(app)/layout.tsx"
for p in (signin_page, signin_panel, app_layout):
    if not p.is_file():
        raise SystemExit(f"ERROR: {p} not found")

# 1) All successful auth flows go through a tiny role-aware landing route.
s = signin_page.read_text()
orig = s
s = s.replace('redirect("/projects");', 'redirect("/oa-entry");')
if 'redirect("/oa-entry");' not in s:
    raise SystemExit("ERROR: could not patch signed-in redirect in sign-in page")
if s != orig:
    backup = signin_page.with_suffix(signin_page.suffix + '.pre-oa-v0111.bak')
    if not backup.exists(): backup.write_text(orig)
    signin_page.write_text(s)

s = signin_panel.read_text()
orig = s
s = s.replace('callbackURL: "/projects"', 'callbackURL: "/oa-entry"')
s = s.replace('router.push("/projects")', 'router.push("/oa-entry")')
if '/oa-entry' not in s:
    raise SystemExit("ERROR: could not patch auth callbacks in sign-in panel")
if s != orig:
    backup = signin_panel.with_suffix(signin_panel.suffix + '.pre-oa-v0111.bak')
    if not backup.exists(): backup.write_text(orig)
    signin_panel.write_text(s)

# 2) All signed-in users opening legacy Seeder workspace routes are redirected
# before project lists/notifications/settings load. OA admin routes use a separate layout.
s = app_layout.read_text()
orig = s
if 'import { redirect } from "next/navigation";' not in s:
    anchor = 'import { Suspense } from "react";'
    if anchor not in s:
        raise SystemExit("ERROR: unexpected app layout import structure")
    s = s.replace(anchor, anchor + '\nimport { redirect } from "next/navigation";', 1)
if 'import { requireViewer } from "@/lib/auth-server";' not in s:
    s = s.replace(
        'import { requireViewer } from "@/lib/auth-server";',
        'import { requireViewer } from "@/lib/auth-server";',
        1,
    )
needle = '  const viewer = await requireViewer();\n  const shellData = await getAppShellDataForViewer(viewer);'
replacement = '  const viewer = await requireViewer();\n  redirect("/oa");\n  const shellData = await getAppShellDataForViewer(viewer);'
if 'redirect("/oa");' not in s:
    if 'if (!isAdminTier(viewer.role)) redirect("/oa");' in s:
        s = s.replace('if (!isAdminTier(viewer.role)) redirect("/oa");', 'redirect("/oa");', 1)
    elif needle in s:
        s = s.replace(needle, replacement, 1)
    else:
        raise SystemExit("ERROR: unexpected app layout body structure; refusing unsafe patch")
# Remove now-unused admin-role import when upgrading an already patched installation.
s = s.replace('import { isAdminTier, requireViewer } from "@/lib/auth-server";', 'import { requireViewer } from "@/lib/auth-server";')
if s != orig:
    backup = app_layout.with_suffix(app_layout.suffix + '.pre-oa-v0111.bak')
    if not backup.exists(): backup.write_text(orig)
    app_layout.write_text(s)

print("OA entry routing patched:")
print("  sign-in existing session -> /oa-entry")
print("  email/invite/Google auth success -> /oa-entry")
print("  /oa-entry -> /admin/oa for Admin/Owner, /oa for employees")
print("  all authenticated requests to legacy Seeder (app) routes -> /oa")
