#!/usr/bin/env python3
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("Usage: patch-bootstrap-vcs.py /path/to/Seeder")

root = Path(sys.argv[1])
auth = root / "lib/auth.ts"
signin = root / "app/(auth)/sign-in/page.tsx"
for p in (auth, signin):
    if not p.is_file():
        raise SystemExit(f"ERROR: {p} not found")

BOT_IMPORT = 'import { VCS_BOT_USER_ID } from "@/lib/services/vcs/constants";'


def patch_auth(p: Path) -> bool:
    s = p.read_text()
    original = s

    # Drizzle predicate required to exclude Seeder's VCS sentinel account.
    if 'import { eq, ne } from "drizzle-orm";' not in s:
        s = s.replace('import { eq } from "drizzle-orm";', 'import { eq, ne } from "drizzle-orm";', 1)

    if BOT_IMPORT not in s:
        anchor = 'import { ensurePersonalSpace } from "@/lib/services/spaces";'
        if anchor not in s:
            raise SystemExit(f"ERROR: upstream auth import structure changed in {p}")
        s = s.replace(anchor, anchor + '\n' + BOT_IMPORT, 1)

    # Current Seeder creates `vcs-bot` in a migration. It is a sentinel user
    # with no account/password and must not close the one-time Owner bootstrap.
    patched_query = (
        '          const [existing] = await db\n'
        '            .select({ id: schema.user.id })\n'
        '            .from(schema.user)\n'
        '            .where(ne(schema.user.id, VCS_BOT_USER_ID))\n'
        '            .limit(1);'
    )
    if '.where(ne(schema.user.id, VCS_BOT_USER_ID))' not in s:
        old_query = (
            '          const [existing] = await db\n'
            '            .select({ id: schema.user.id })\n'
            '            .from(schema.user)\n'
            '            .limit(1);'
        )
        if old_query not in s:
            raise SystemExit(f"ERROR: upstream bootstrap query changed in {p}; refusing an unsafe patch")
        s = s.replace(old_query, patched_query, 1)

    s = s.replace(
        '// exception: a brand-new instance with zero users may create the owner\n'
        '        // account, and only for the configured OWNER_EMAIL. Once any user\n'
        '        // exists this throws, so it can never be used to self-provision later.',
        '// exception: a brand-new instance with zero REAL users may create the owner\n'
        '        // account, and only for the configured OWNER_EMAIL. Seeder\'s VCS bot\n'
        '        // is a sentinel system user and is excluded from this bootstrap check.',
        1,
    )

    if s != original:
        backup = p.with_suffix(p.suffix + '.pre-oa-v013.bak')
        if not backup.exists():
            backup.write_text(original)
        p.write_text(s)
        return True
    return False


def patch_signin(p: Path) -> bool:
    s = p.read_text()
    original = s

    if 'import { and, eq, gt, isNull, ne } from "drizzle-orm";' not in s:
        s = s.replace(
            'import { and, eq, gt, isNull } from "drizzle-orm";',
            'import { and, eq, gt, isNull, ne } from "drizzle-orm";',
            1,
        )

    if BOT_IMPORT not in s:
        anchor = 'import { invitations, user } from "@/lib/db/schema";'
        if anchor not in s:
            raise SystemExit(f"ERROR: upstream sign-in import structure changed in {p}")
        s = s.replace(anchor, anchor + '\n' + BOT_IMPORT, 1)

    old_query = '  const [anyUser] = await db.select({ id: user.id }).from(user).limit(1);'
    new_query = (
        '  const [anyUser] = await db\n'
        '    .select({ id: user.id })\n'
        '    .from(user)\n'
        '    .where(ne(user.id, VCS_BOT_USER_ID))\n'
        '    .limit(1);'
    )
    if '.where(ne(user.id, VCS_BOT_USER_ID))' not in s:
        if old_query not in s:
            raise SystemExit(f"ERROR: upstream sign-in bootstrap query changed in {p}; refusing an unsafe patch")
        s = s.replace(old_query, new_query, 1)

    s = s.replace(
        '// A fresh instance (zero users) shows the one-time "create owner account"\n'
        '  // form. The auth create hook (lib/auth.ts) enforces the same zero-user +',
        '// A fresh instance (zero real users) shows the one-time "create owner account"\n'
        '  // form. Seeder\'s VCS bot is a system sentinel and is ignored. The auth\n'
        '  // create hook (lib/auth.ts) enforces the same real-user +',
        1,
    )

    if s != original:
        backup = p.with_suffix(p.suffix + '.pre-oa-v013.bak')
        if not backup.exists():
            backup.write_text(original)
        p.write_text(s)
        return True
    return False

changed_auth = patch_auth(auth)
changed_signin = patch_signin(signin)
print("Owner bootstrap VCS-bot compatibility patch:")
print(f"  lib/auth.ts: {'patched' if changed_auth else 'already compatible'}")
print(f"  app/(auth)/sign-in/page.tsx: {'patched' if changed_signin else 'already compatible'}")
