#!/usr/bin/env node
// Verify high-risk Phase 3/4 source patterns before any release.
// Structural guards are NOT a substitute for the live two-tenant suite.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const root=process.argv[2]||"overlay";
const read=p=>readFileSync(resolve(root,p),"utf8");
const ui=read("components/oa/oa-console.tsx");
const manage=read("app/api/oa/entities/route.ts");
const pdf=read("app/api/oa/payslips/[id]/pdf/route.ts");
const file=read("app/api/oa/files/[id]/route.ts");
const api=read("app/api/oa/route.ts");
const entity=read("lib/oa/entity.ts");
const invites=read("app/api/oa/invitations/route.ts");
const invitePage=read("components/oa/entity-invite.tsx");
const auth=read("lib/auth.ts");
const tests=[
 ["Switcher remounts workspace to clear stale tenant data",/OaWorkspace key=\{entityId\}/.test(ui)],
 ["Business GET sends selected entity",/\/api\/oa\?resource=\$\{encodeURIComponent\(resource\)\}&entity_id=\$\{encodeURIComponent\(selectedOaEntityId\)\}/.test(ui)],
 ["Business POST injects selected entity",/entity_id:selectedOaEntityId/.test(ui)],
 ["Expense history explicitly passes active Entity",/resource:"expenseHistory",entity_id:selectedOaEntityId/.test(ui)],
 ["Sensitive GET requests reject missing Entity",/Explicit Entity required/.test(api)],
 ["Legacy admin hold is removed",!/Legacy records require ownership verification/.test(api)],
 ["Attachment upload includes selected entity",/form\.set\("entity_id",selectedOaEntityId\)/.test(ui)],
 ["Attachment links use scoped helper",/function oaFileUrl\(id:string\)/.test(ui)],
 ["PDF links include selected entity",/payslips\/\$\{p\.id\}\/pdf\?entity_id=/.test(ui)],
 ["Entity management routes require authenticated viewer",/const viewer=await getViewer\(\);if\(!viewer\)return fail\("Unauthorized",401\);/.test(manage)],
 ["Entity creation requires platform admin",/if\(!platformAdmin\)return fail\("Forbidden",403\)/.test(manage)],
 ["Entity creation uses D1 transactional batch",/await db\.batch\(\[/.test(manage)],
 ["Entity management guarded by disabled-by-default feature flag",/if\(!enabled\(\) && action!=="listMembers"\)return fail\("Multi-Entity management is disabled/.test(manage)],
 ["Membership changes require entity admin",/await managePermission\(viewer\.id,viewer\.role,entityId\)/.test(manage)],
 ["Entity membership role changes protect last admin",/Cannot remove the final Entity admin/.test(manage)],
 ["PDF resolves server-side company membership",/resolveBusinessEntityAccess\(viewer\.id,request\.nextUrl\.searchParams\.get\("entity_id"\)\)/.test(pdf)],
 ["PDF lookup filters by company",/WHERE p\.id=\? AND p\.entity_id=\?/.test(pdf)],
 ["PDF uses entity-scoped employee profile",/LEFT JOIN oa_entity_employee e ON e\.user_id=p\.user_id AND e\.entity_id=p\.entity_id/.test(pdf)],
 ["PDF uses entity-scoped settings",/settings\(companyId\)/.test(pdf)],
 ["PDF permissions derive from entity membership",/const admin=access\.role==="admin"/.test(pdf)&& !/isAdminTier/.test(pdf)],
 ["R2 direct download scopes file ownership",/SELECT \* FROM oa_file WHERE id=\? AND entity_id=\?/.test(file)],
 ["GET/POST main business API authorize membership", (api.match(/resolveBusinessEntityAccess\(viewer\.id/g)||[]).length===2],
 ["Non-legacy business access feature flag enforced",/id!==LEGACY_ENTITY_ID && !getOaEnv\(\)\.multiEntityBusinessEnabled/.test(entity)],
];
const inviteChecks=[
 ["Employees offer existing-account enrollment",/Add existing user/.test(ui)&&/setMember/.test(ui)],
 ["Employees can generate secure invitation links",/Generate invitation link/.test(ui)&&/\/api\/oa\/invitations/.test(ui)],
 ["Employees support email invitations",/Send email invitation/.test(ui)],
 ["Invitation token stored as a digest",/token_hash/.test(invites)&&/crypto\.subtle\.digest\("SHA-256"/.test(invites)],
 ["Invitation acceptance requires authenticated user",/const viewer=await getViewer\(\);if\(!viewer\)/.test(invites)],
 ["Invitation redemption verifies invited email",/signedIn\?\.email\?\.toLowerCase\(\)!==invite\.email\.toLowerCase\(\)/.test(invites)],
 ["Invitation redemption uses transactional D1 batch",/await db\.batch\(\[/.test(invites)],
 ["Invitation creation requires company admin",/await permission\(viewer,entityId\)/.test(invites)],
 ["Invite page supports sign-up and sign-in",/authClient\.signUp\.email/.test(invitePage)&&/authClient\.signIn\.email/.test(invitePage)],
 ["Invite page submits token with signup",/x-oa-invite-token/.test(invitePage)],
 ["Seeder signup verifies OA invitation on server",/OA_ENTITY_INVITE_SIGNUP_GATE_V1/.test(auth)&&/allowedByOaInvite/.test(auth)],
 ["Seeder signup still denies public registration",/Sign-up is disabled\. Ask an admin to invite you\./.test(auth)],
 ["Invited signup cannot auto-promote to platform Owner",/if \(ctx\?\.headers\?\.get\("x-oa-invite-token"\)\) return;/.test(auth)],
];
let failures=0;
for(const [name,good] of [...tests,...inviteChecks]){console.log((good?"PASS ":"FAIL ")+name);if(!good)failures++}
if(failures){console.error(failures+" Phase 3/4 static checks failed");process.exit(1)}
console.log("Phase 3/4 static checks pass. Two-tenant runtime and DB verification remain mandatory.");
