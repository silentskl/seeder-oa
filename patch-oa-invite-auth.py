#!/usr/bin/env python3
"""Patch Seeder's existing invite-only Better Auth hook to honor a valid OA invite.
Never enables open sign-up. Idempotent and fails closed on unknown upstream code.
"""
from pathlib import Path
import sys

if len(sys.argv)!=2:
    raise SystemExit("Usage: python3 patch-oa-invite-auth.py /path/to/Seeder")
p=Path(sys.argv[1])/"lib/auth.ts"
if not p.is_file():
    raise SystemExit(f"ERROR: missing {p}")
s=p.read_text()
sentinel="OA_ENTITY_INVITE_SIGNUP_GATE_V1"
if sentinel in s:
    print("OA invitation Better Auth gate already patched")
    raise SystemExit(0)
old='''        before: async (candidateUser) => {
          const email = candidateUser.email.toLowerCase();
          if (await hasRegisteredUser()) {
            throw new APIError("FORBIDDEN", {
              message: "Sign-up is disabled. Ask an admin to invite you.",
            });
          }
'''
new='''        before: async (candidateUser, ctx) => {
          const email = candidateUser.email.toLowerCase();
          // OA_ENTITY_INVITE_SIGNUP_GATE_V1
          // Only this email/password signup endpoint may use an OA invitation.
          // The raw token is carried in a request header (never a public signup flag)
          // and verified against a one-time hash in production D1.
          const inviteToken = ctx?.path === "/sign-up/email"
            ? ctx.headers?.get("x-oa-invite-token") ?? ""
            : "";
          let allowedByOaInvite = false;
          if (/^[0-9a-f]{64}$/.test(inviteToken)) {
            const hashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(inviteToken));
            const hash = Array.from(new Uint8Array(hashBytes), b => b.toString(16).padStart(2, "0")).join("");
            const row = await getOaEnv().db.prepare(
              `SELECT i.id FROM oa_entity_invitation i
               JOIN oa_entity e ON e.id=i.entity_id
               WHERE i.token_hash=? AND lower(i.email)=?
                 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
                 AND i.expires_at>? AND e.active=1`
            ).bind(hash,email,new Date().toISOString()).first();
            allowedByOaInvite = Boolean(row);
          }
          if (await hasRegisteredUser()) {
            if (allowedByOaInvite) return { data: { ...candidateUser, email } };
            throw new APIError("FORBIDDEN", {
              message: "Sign-up is disabled. Ask an admin to invite you.",
            });
          }
'''
if old not in s:
    raise SystemExit("ERROR: Seeder signup hook differs from reviewed version; refusing unsafe changes")
if 'import { getOaEnv } from "@/lib/oa/env";' not in s:
    anchor='import { ensurePersonalSpace } from "@/lib/services/spaces";'
    if anchor not in s:
        raise SystemExit("ERROR: Seeder auth import anchor changed; cannot safely insert OA D1 dependency")
    s=s.replace(anchor,anchor+'\nimport { getOaEnv } from "@/lib/oa/env";',1)
s=s.replace(old,new,1)
# Prevent an invited user from acquiring the global owner role by owning the
# OWNER_EMAIL string; owner bootstrap is the ONLY permissible elevation.
old_after='''        after: async (createdUser) => {
          // Every user gets their one Personal space before they can do anything.
          await ensurePersonalSpace(createdUser.id);
          if (createdUser.email.toLowerCase() !== serverEnv.ownerEmail) return;'''
new_after='''        after: async (createdUser, ctx) => {
          // Every user gets their one Personal space before they can do anything.
          await ensurePersonalSpace(createdUser.id);
          // An OA-invited account must never be granted platform Owner.
          if (ctx?.headers?.get("x-oa-invite-token")) return;
          if (createdUser.email.toLowerCase() !== serverEnv.ownerEmail) return;'''
if old_after not in s:
    raise SystemExit("ERROR: post-signup owner hook changed; aborting patch")
s=s.replace(old_after,new_after,1)
bak=p.with_name(p.name+".pre-oa-invite.bak")
if not bak.exists():
    bak.write_text(p.read_text())
p.write_text(s)
print(f"Patched invite-gated signup in {p}; original preserved as {bak.name}")
