#!/usr/bin/env python3
"""Regression: pin the Seeder v2.1.0 invite hook and preserve auth gate safety."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
PATCH=ROOT/"patch-oa-invite-auth.py"
IMPORT='import { ensurePersonalSpace } from "@/lib/services/spaces";\n'
V21_QUERY='''          const db = getDb();
          const [existing] = await db
            .select({ id: schema.user.id })
            .from(schema.user)
            .limit(1);

'''
V21_BOT_QUERY='''          const db = getDb();
          const [existing] = await db
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(ne(schema.user.id, VCS_BOT_USER_ID))
            .limit(1);

'''
LEGACY_QUERY='''          if (await hasRegisteredUser()) {
            throw new APIError("FORBIDDEN", {
              message: "Sign-up is disabled. Ask an admin to invite you.",
            });
          }
'''
GUARD='''          if (existing) {
            throw new APIError("FORBIDDEN", {
              message: "Sign-up is disabled. Ask an admin to invite you.",
            });
          }
'''
AFTER='''        after: async (createdUser) => {
          // Every user gets their one Personal space before they can do anything.
          await ensurePersonalSpace(createdUser.id);
          if (createdUser.email.toLowerCase() !== serverEnv.ownerEmail) return;'''

def fixture(query):
    return (IMPORT+'''
export const auth = betterAuth({
  databaseHooks: { user: { create: {
        before: async (candidateUser) => {
          const email = candidateUser.email.toLowerCase();
'''+query+('' if query==LEGACY_QUERY else GUARD)+'''
          if (email !== serverEnv.ownerEmail) {
            throw new APIError("FORBIDDEN", { message: "Owner only" });
          }
          return { data: { ...candidateUser, email } };
        },
'''+AFTER+'''
          const db = getDb();
          await db.update(schema.user).set({role:"owner"});
        },
  } } },
});
''')

class TestSeederInvitePatcher(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        (self.root/"lib").mkdir()
        self.auth=self.root/"lib/auth.ts"

    def run_patch(self):
        return subprocess.run([sys.executable,str(PATCH),str(self.root)],
                              capture_output=True,text=True,check=False)

    def test_reviewed_variants(self):
        for name,query in (("legacy",LEGACY_QUERY),("seeder-v2.1.0",V21_QUERY),
                           ("seeder-v2.1.0-with-vcs-bot",V21_BOT_QUERY)):
            with self.subTest(name=name):
                self.auth.write_text(fixture(query))
                backup=self.auth.with_name("auth.ts.pre-oa-invite.bak")
                if backup.exists():backup.unlink()
                original=self.auth.read_text()
                first=self.run_patch()
                self.assertEqual(first.returncode,0,first.stderr)
                source=self.auth.read_text()
                self.assertIn("OA_ENTITY_INVITE_SIGNUP_GATE_V1",source)
                self.assertIn('ctx?.path === "/sign-up/email"',source)
                self.assertIn("allowedByOaInvite",source)
                self.assertIn("i.accepted_at IS NULL AND i.revoked_at IS NULL",source)
                self.assertIn("if (allowedByOaInvite) return",source)
                self.assertIn("if (ctx?.headers?.get(\"x-oa-invite-token\")) return;",source)
                self.assertIn('Sign-up is disabled. Ask an admin to invite you.',source)
                self.assertIn("if (email !== serverEnv.ownerEmail)",source)
                if query==V21_BOT_QUERY:
                    self.assertIn(".where(ne(schema.user.id, VCS_BOT_USER_ID))",source)
                self.assertEqual(backup.read_text(),original)
                second=self.run_patch()
                self.assertEqual(second.returncode,0,second.stderr)
                self.assertIn("already patched",second.stdout)
                self.assertEqual(self.auth.read_text(),source)
                self.assertEqual(backup.read_text(),original)

    def test_unknown_upstream_fails_closed_without_writing(self):
        self.auth.write_text(fixture(V21_QUERY).replace(
            ".select({ id: schema.user.id })",".select({ user_id: schema.user.id })"))
        before=self.auth.read_bytes()
        result=self.run_patch()
        self.assertNotEqual(result.returncode,0)
        self.assertIn("refusing unsafe changes",result.stderr)
        self.assertEqual(self.auth.read_bytes(),before)
        self.assertFalse(self.auth.with_name("auth.ts.pre-oa-invite.bak").exists())

    def test_post_signup_owner_hook_must_match(self):
        self.auth.write_text(fixture(V21_BOT_QUERY).replace(
            "after: async (createdUser) => {","after: async (candidate) => {"))
        before=self.auth.read_bytes()
        result=self.run_patch()
        self.assertNotEqual(result.returncode,0)
        self.assertIn("post-signup owner hook changed",result.stderr)
        self.assertEqual(self.auth.read_bytes(),before)
        self.assertFalse(self.auth.with_name("auth.ts.pre-oa-invite.bak").exists())

if __name__=="__main__":
    unittest.main(verbosity=2)
