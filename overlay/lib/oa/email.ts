import { one, all, run } from "./db";
import { getOaEnv } from "./env";
import type { ApprovalEntity, ApprovalStep } from "./approval";
import { getPendingStep } from "./approval";
import { formatMoney } from "./money";
import { LEGACY_ENTITY_ID } from "./entity";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type UserRef = { id: string; name: string | null; email: string };
type EmailSettings = {
  company_name: string;
  email_enabled: number;
  email_provider: string;
  email_from_name: string;
  email_from_address: string | null;
  email_reply_to: string | null;
  email_api_key_encrypted: string | null;
};

type MailInput = {
  to: UserRef;
  subject: string;
  text: string;
  html: string;
  eventKey: string;
  entityType?: ApprovalEntity | "test" | "password_reset";
  ignoreEnabled?: boolean;
  entityId?: string | null;
  companyId?: string;
  strict?: boolean;
};

function bytesToB64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64ToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function masterKey() {
  const { settingsMasterKey } = getOaEnv();
  if (!settingsMasterKey) throw new Error("OA_SETTINGS_MASTER_KEY is not configured");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(settingsMasterKey));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptEmailSecret(value: string) {
  const key = await masterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return `v1.${bytesToB64(iv)}.${bytesToB64(new Uint8Array(ciphertext))}`;
}

export async function decryptEmailSecret(value: string | null | undefined) {
  if (!value) return null;
  const [version, ivText, cipherText] = value.split(".");
  if (version !== "v1" || !ivText || !cipherText) throw new Error("Unsupported encrypted email secret format");
  const key = await masterKey();
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivText) }, key, b64ToBytes(cipherText));
  return decoder.decode(plain);
}

export async function emailSettings(companyId = LEGACY_ENTITY_ID) {
  return one<EmailSettings>(
    `SELECT company_name,email_enabled,email_provider,email_from_name,email_from_address,email_reply_to,email_api_key_encrypted
     FROM oa_entity_settings WHERE entity_id=?`,
    [companyId],
  );
}

export async function publicEmailSettings() {
  const s = await emailSettings();
  return {
    email_enabled: Number(s?.email_enabled ?? 0),
    email_provider: s?.email_provider ?? "resend",
    email_from_name: s?.email_from_name ?? "OA Notifications",
    email_from_address: s?.email_from_address ?? "",
    email_reply_to: s?.email_reply_to ?? "",
    email_api_key_configured: Boolean(s?.email_api_key_encrypted),
    settings_master_key_configured: Boolean(getOaEnv().settingsMasterKey),
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function logEmail(input: MailInput, status: "sent" | "failed" | "skipped", provider: string, providerMessageId?: string | null, error?: string | null) {
  await run(
    `INSERT INTO oa_email_log(id,event_key,entity_type,entity_id,recipient_email,recipient_user_id,subject,provider,provider_message_id,status,error,company_entity_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [crypto.randomUUID(), input.eventKey, input.entityType ?? null, input.entityId ?? null, input.to.email, input.to.id || null, input.subject, provider, providerMessageId ?? null, status, error?.slice(0, 2000) ?? null,input.companyId||LEGACY_ENTITY_ID],
  );
}

async function sendOne(input: MailInput) {
  const s = await emailSettings(input.companyId||LEGACY_ENTITY_ID);
  if (!s) {
    const message = "OA email settings are not initialized";
    if (input.strict) throw new Error(message);
    await logEmail(input, "skipped", "resend", null, message);
    return { skipped: true };
  }
  if (!s.email_enabled && !input.ignoreEnabled) {
    if (input.strict) throw new Error("Email notifications are disabled");
    await logEmail(input, "skipped", s.email_provider, null, "Email notifications are disabled");
    return { skipped: true };
  }
  if (s.email_provider !== "resend") throw new Error(`Unsupported email provider: ${s.email_provider}`);
  if (!s.email_from_address) throw new Error("Email From address is not configured");
  const apiKey = await decryptEmailSecret(s.email_api_key_encrypted);
  if (!apiKey) throw new Error("Resend API key is not configured");

  const from = `${s.email_from_name || s.company_name || "OA Notifications"} <${s.email_from_address}>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Seeder-OA/0.1.14",
        "Idempotency-Key": `${input.eventKey}:${input.to.id || input.to.email}`.slice(0, 250),
      },
      body: JSON.stringify({
        from,
        to: [input.to.email],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(s.email_reply_to ? { reply_to: s.email_reply_to } : {}),
      }),
    });
    const body = await response.json().catch(() => ({} as any)) as any;
    if (!response.ok) throw new Error(body?.message || body?.error || `Resend HTTP ${response.status}`);
    await logEmail(input, "sent", "resend", body?.id ?? null, null);
    return { id: body?.id ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logEmail(input, "failed", "resend", null, message);
    if (input.strict) throw error;
    console.error("OA email send failed", { eventKey: input.eventKey, recipient: input.to.email, error: message });
    return { failed: true, error: message };
  }
}

async function requestContext(entityType: ApprovalEntity, entityId: string, companyId = LEGACY_ENTITY_ID) {
  if (entityType === "leave") {
    const row = await one<any>(
      `SELECT l.id,l.user_id,l.start_date,l.end_date,l.business_days,l.reason,l.status,u.name,u.email,t.name AS type_name
       FROM oa_leave_request l JOIN user u ON u.id=l.user_id JOIN oa_leave_type t ON t.code=l.leave_type_code WHERE l.id=? AND l.entity_id=?`,
      [entityId,companyId],
    );
    if (!row) throw new Error("Leave request not found for email notification");
    return {
      requester: { id: row.user_id, name: row.name, email: row.email } as UserRef,
      label: "Leave request",
      summaryText: `${row.type_name}: ${row.start_date} to ${row.end_date} (${row.business_days} day${Number(row.business_days) === 1 ? "" : "s"})`,
      summaryHtml: `<strong>${escapeHtml(row.type_name)}</strong>: ${escapeHtml(row.start_date)} to ${escapeHtml(row.end_date)} (${escapeHtml(row.business_days)} day${Number(row.business_days) === 1 ? "" : "s"})`,
      status: row.status,
    };
  }
  const row = await one<any>(
    `SELECT x.id,x.user_id,x.expense_date,x.description,x.original_amount_minor,x.original_currency,x.reimbursement_amount_minor,x.reimbursement_currency,x.status,u.name,u.email
     FROM oa_expense_claim x JOIN user u ON u.id=x.user_id WHERE x.id=? AND x.entity_id=?`,
    [entityId,companyId],
  );
  if (!row) throw new Error("Expense claim not found for email notification");
  return {
    requester: { id: row.user_id, name: row.name, email: row.email } as UserRef,
    label: "Expense claim",
    summaryText: `${row.description || "Expense"} · ${formatMoney(Number(row.original_amount_minor), row.original_currency)} · ${row.expense_date}`,
    summaryHtml: `${escapeHtml(row.description || "Expense")} · <strong>${escapeHtml(formatMoney(Number(row.original_amount_minor), row.original_currency))}</strong> · ${escapeHtml(row.expense_date)}`,
    status: row.status,
  };
}

async function usersForStep(step: ApprovalStep | null, companyId = LEGACY_ENTITY_ID): Promise<UserRef[]> {
  if (!step) return [];
  if (step.approver_type === "manager" && step.assigned_user_id) {
    const user = await one<UserRef>(`SELECT id,name,email FROM user WHERE id=?`, [step.assigned_user_id]);
    return user?.email ? [user] : [];
  }
  return all<UserRef>(
    `SELECT id,name,email FROM user WHERE role IN ('owner','admin') AND id <> 'vcs-bot' AND email IS NOT NULL AND trim(email) <> '' ORDER BY CASE WHEN role='owner' THEN 0 ELSE 1 END,name,email`,
  );
}

function appLink(entityType: ApprovalEntity, admin = false) {
  const base = String(getOaEnv().appUrl || "").replace(/\/$/, "");
  if (!base) return "";
  if (admin) return `${base}/admin/oa/approvals`;
  return entityType === "leave" ? `${base}/oa/leave` : `${base}/oa/expenses`;
}

function wrapHtml(company: string, title: string, body: string, link?: string, linkLabel?: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#171717"><h2>${escapeHtml(title)}</h2>${body}${link ? `<p style="margin-top:24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">${escapeHtml(linkLabel || "Open OA")}</a></p>` : ""}<p style="margin-top:28px;color:#737373;font-size:12px">${escapeHtml(company)} · Automated OA notification</p></div>`;
}

async function uniqueSend(inputs: MailInput[]) {
  const seen = new Set<string>();
  for (const input of inputs) {
    const key = input.to.email.trim().toLowerCase();
    if (!key || seen.has(`${input.eventKey}:${key}`)) continue;
    seen.add(`${input.eventKey}:${key}`);
    await sendOne(input);
  }
}

export async function notifySubmitted(entityType: ApprovalEntity, entityId: string, companyId = LEGACY_ENTITY_ID) {
  try {
    const s = await emailSettings(companyId);
    if (!s?.email_enabled) return;
    const ctx = await requestContext(entityType, entityId,companyId);
    const step = await getPendingStep(entityType, entityId,companyId);
    const approvers = await usersForStep(step,companyId);
    const eventBase = `${entityType}:${entityId}:submitted`;
    const inputs: MailInput[] = [{
      to: ctx.requester,
      subject: `[${s.company_name}] ${ctx.label} submitted`,
      text: `Your ${ctx.label.toLowerCase()} has been submitted.\n\n${ctx.summaryText}\n\nStatus: Pending approval.\n${appLink(entityType)}`,
      html: wrapHtml(s.company_name, `${ctx.label} submitted`, `<p>Your request has been submitted and is waiting for approval.</p><p>${ctx.summaryHtml}</p><p><strong>Status:</strong> Pending approval</p>`, appLink(entityType), "View request"),
      eventKey: `${eventBase}:submitter`, entityType, entityId,
    }];
    for (const approver of approvers) inputs.push({
      to: approver,
      subject: `[${s.company_name}] Approval required: ${ctx.label}`,
      text: `${ctx.requester.name || ctx.requester.email} submitted a ${ctx.label.toLowerCase()} requiring your approval.\n\n${ctx.summaryText}\n${appLink(entityType, true)}`,
      html: wrapHtml(s.company_name, `Approval required: ${ctx.label}`, `<p><strong>${escapeHtml(ctx.requester.name || ctx.requester.email)}</strong> submitted a request requiring your approval.</p><p>${ctx.summaryHtml}</p>`, appLink(entityType, true), "Review approval"),
      eventKey: `${eventBase}:approver`, entityType, entityId,
    });
    await uniqueSend(inputs);
  } catch (error) {
    console.error("OA submission notification failed", error);
  }
}

export async function notifyDecision(entityType: ApprovalEntity, entityId: string, actorUserId: string, decision: "approved" | "rejected", complete: boolean, companyId = LEGACY_ENTITY_ID) {
  try {
    const s = await emailSettings(companyId);
    if (!s?.email_enabled) return;
    const ctx = await requestContext(entityType, entityId,companyId);
    const actor = await one<UserRef>(`SELECT id,name,email FROM user WHERE id=?`, [actorUserId]);
    if (!actor?.email) return;
    const state = decision === "rejected" ? "Rejected" : complete ? "Approved" : "Approval step completed";
    const eventBase = `${entityType}:${entityId}:${decision}:${actorUserId}:${Date.now()}`;
    const inputs: MailInput[] = [
      {
        to: ctx.requester,
        subject: `[${s.company_name}] ${ctx.label}: ${state}`,
        text: `${actor.name || actor.email} ${decision === "rejected" ? "rejected" : "approved"} your ${ctx.label.toLowerCase()}.\n\n${ctx.summaryText}\n\nStatus: ${state}.\n${appLink(entityType)}`,
        html: wrapHtml(s.company_name, `${ctx.label}: ${state}`, `<p><strong>${escapeHtml(actor.name || actor.email)}</strong> ${decision === "rejected" ? "rejected" : "approved"} this request.</p><p>${ctx.summaryHtml}</p><p><strong>Status:</strong> ${escapeHtml(state)}</p>`, appLink(entityType), "View request"),
        eventKey: `${eventBase}:submitter`, entityType, entityId,
      },
      {
        to: actor,
        subject: `[${s.company_name}] Approval recorded: ${ctx.label}`,
        text: `Your ${decision} decision has been recorded for ${ctx.requester.name || ctx.requester.email}.\n\n${ctx.summaryText}\n\nStatus: ${state}.\n${appLink(entityType, true)}`,
        html: wrapHtml(s.company_name, `Approval recorded`, `<p>Your <strong>${escapeHtml(decision)}</strong> decision for <strong>${escapeHtml(ctx.requester.name || ctx.requester.email)}</strong> has been recorded.</p><p>${ctx.summaryHtml}</p><p><strong>Status:</strong> ${escapeHtml(state)}</p>`, appLink(entityType, true), "Open approvals"),
        eventKey: `${eventBase}:actor`, entityType, entityId,
      },
    ];
    await uniqueSend(inputs);

    if (decision === "approved" && !complete) {
      const next = await getPendingStep(entityType, entityId,companyId);
      const nextApprovers = await usersForStep(next,companyId);
      const nextInputs = nextApprovers.map((to) => ({
        to,
        subject: `[${s.company_name}] Approval required: ${ctx.label}`,
        text: `${ctx.requester.name || ctx.requester.email}'s ${ctx.label.toLowerCase()} is now waiting for your approval.\n\n${ctx.summaryText}\n${appLink(entityType, true)}`,
        html: wrapHtml(s.company_name, `Approval required: ${ctx.label}`, `<p><strong>${escapeHtml(ctx.requester.name || ctx.requester.email)}</strong>'s request is now waiting for your approval.</p><p>${ctx.summaryHtml}</p>`, appLink(entityType, true), "Review approval"),
        eventKey: `${eventBase}:next`, entityType, entityId,
      }));
      await uniqueSend(nextInputs);
    }
  } catch (error) {
    console.error("OA decision notification failed", error);
  }
}

export async function sendTestEmail(toEmail: string, actor: UserRef) {
  const s = await emailSettings();
  if (!s) throw new Error("OA settings not found");
  const to = { id: toEmail.trim().toLowerCase() === actor.email.trim().toLowerCase() ? actor.id : "", name: actor.name, email: toEmail };
  return sendOne({
    to,
    subject: `[${s.company_name}] OA email test`,
    text: `This is a test email from ${s.company_name} OA. If you received it, the email configuration is working.`,
    html: wrapHtml(s.company_name, "OA email test", `<p>This is a test email from <strong>${escapeHtml(s.company_name)}</strong> OA.</p><p>If you received it, the email configuration is working.</p>`),
    eventKey: `test:${crypto.randomUUID()}`,
    entityType: "test",
    entityId: null,
    strict: true,
  });
}


export async function sendPasswordResetEmail(to: UserRef, resetUrl: string) {
  const s = await emailSettings();
  if (!s) throw new Error("OA settings not found");
  return sendOne({
    to,
    subject: `[${s.company_name}] Reset your password`,
    text: `A password reset was requested for your ${s.company_name} OA account.\n\nOpen this link to set a new password:\n${resetUrl}\n\nThis link expires after 30 minutes. If you did not request this reset, you can ignore this email.`,
    html: wrapHtml(
      s.company_name,
      "Reset your password",
      `<p>A password reset was requested for your <strong>${escapeHtml(s.company_name)}</strong> OA account.</p><p>This link expires after <strong>30 minutes</strong>. If you did not request this reset, you can ignore this email.</p>`,
      resetUrl,
      "Reset password",
    ),
    eventKey: `password_reset:${to.id || to.email}:${crypto.randomUUID()}`,
    entityType: "password_reset",
    entityId: to.id || null,
    strict: true,
    // Account recovery must remain available even when optional approval
    // notifications are disabled. It still requires a configured Resend key
    // and From address.
    ignoreEnabled: true,
  });
}

export async function sendPasswordResetConfirmationEmail(to: UserRef) {
  const s = await emailSettings();
  if (!s) return;
  return sendOne({
    to,
    subject: `[${s.company_name}] Your password was changed`,
    text: `Your ${s.company_name} OA password was changed successfully. If you did not make this change, contact your administrator immediately.`,
    html: wrapHtml(
      s.company_name,
      "Password changed",
      `<p>Your <strong>${escapeHtml(s.company_name)}</strong> OA password was changed successfully.</p><p>If you did not make this change, contact your administrator immediately.</p>`,
    ),
    eventKey: `password_reset_complete:${to.id || to.email}:${crypto.randomUUID()}`,
    entityType: "password_reset",
    entityId: to.id || null,
    ignoreEnabled: true,
  });
}
