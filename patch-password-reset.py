#!/usr/bin/env python3
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("Usage: patch-password-reset.py /path/to/Seeder")

root = Path(sys.argv[1])
auth = root / "lib/auth.ts"
signin_panel = root / "components/auth/sign-in-panel.tsx"
for p in (auth, signin_panel):
    if not p.is_file():
        raise SystemExit(f"ERROR: {p} not found")


def patch_auth(p: Path) -> bool:
    s = p.read_text()
    original = s

    cf_import = 'import { getCloudflareContext } from "@opennextjs/cloudflare";'
    if cf_import not in s:
        anchor = 'import { drizzleAdapter } from "@better-auth/drizzle-adapter";'
        if anchor not in s:
            raise SystemExit(f"ERROR: unexpected auth import structure in {p}")
        s = s.replace(anchor, anchor + "\n" + cf_import, 1)

    email_import = (
        'import { sendPasswordResetConfirmationEmail, sendPasswordResetEmail } '
        'from "@/lib/oa/email";'
    )
    if email_import not in s:
        anchor = 'import { ensurePersonalSpace } from "@/lib/services/spaces";'
        if anchor not in s:
            raise SystemExit(f"ERROR: upstream auth imports changed in {p}")
        s = s.replace(anchor, anchor + "\n" + email_import, 1)

    if "sendResetPassword:" not in s:
        anchor = "    autoSignIn: true,\n"
        if anchor not in s:
            raise SystemExit(f"ERROR: emailAndPassword block changed in {p}; refusing unsafe patch")
        block = '''    autoSignIn: true,\n    // Password recovery is handled by Better Auth's one-time verification token.\n    // Keep the token short-lived and revoke all prior sessions after a successful reset.\n    resetPasswordTokenExpiresIn: 30 * 60,\n    revokeSessionsOnPasswordReset: true,\n    sendResetPassword: async ({ user, url }) => {\n      const task = sendPasswordResetEmail(\n        { id: user.id, name: user.name, email: user.email },\n        url,\n      );\n      // On Cloudflare, keep delivery alive after the HTTP response without\n      // making request timing reveal whether the email address exists.\n      try {\n        getCloudflareContext().ctx.waitUntil(task);\n      } catch {\n        // Local/alternate runtime fallback: Better Auth will await this callback.\n        await task;\n      }\n    },\n    onPasswordReset: async ({ user }) => {\n      const task = sendPasswordResetConfirmationEmail({\n        id: user.id,\n        name: user.name,\n        email: user.email,\n      });\n      try {\n        getCloudflareContext().ctx.waitUntil(task);\n      } catch {\n        // Confirmation email is best-effort and must never undo a completed reset.\n        await task.catch((error) =>\n          console.error("Password reset confirmation email failed", error),\n        );\n      }\n    },\n'''
        s = s.replace(anchor, block, 1)

    if s != original:
        backup = p.with_suffix(p.suffix + ".pre-oa-v0113.bak")
        if not backup.exists():
            backup.write_text(original)
        p.write_text(s)
        return True
    return False


def patch_signin_panel(p: Path) -> bool:
    s = p.read_text()
    original = s

    if 'import Link from "next/link";' not in s:
        anchor = '"use client";\n\n'
        if not s.startswith(anchor):
            raise SystemExit(f"ERROR: unexpected sign-in panel header in {p}")
        s = s.replace(anchor, anchor + 'import Link from "next/link";\n', 1)

    if 'href="/forgot-password"' not in s:
        anchor = '''                      placeholder="Minimum 8 characters"\n                    />\n                  </div>\n                </label>\n'''
        if anchor not in s:
            raise SystemExit(f"ERROR: password field structure changed in {p}; refusing unsafe patch")
        replacement = anchor + '''                {mode === "sign-in" ? (\n                  <div className="flex justify-end">\n                    <Link\n                      href="/forgot-password"\n                      className="text-[12px] font-medium text-foreground underline-offset-4 hover:underline"\n                    >\n                      Forgot password?\n                    </Link>\n                  </div>\n                ) : null}\n'''
        s = s.replace(anchor, replacement, 1)

    if s != original:
        backup = p.with_suffix(p.suffix + ".pre-oa-v0113.bak")
        if not backup.exists():
            backup.write_text(original)
        p.write_text(s)
        return True
    return False


changed_auth = patch_auth(auth)
changed_signin = patch_signin_panel(signin_panel)
print("Password recovery patch:")
print(f"  lib/auth.ts: {'patched' if changed_auth else 'already compatible'}")
print(f"  components/auth/sign-in-panel.tsx: {'patched' if changed_signin else 'already compatible'}")
print("  /forgot-password and /reset-password pages supplied by overlay")
