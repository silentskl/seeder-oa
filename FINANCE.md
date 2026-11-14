# Seeder OA finance module

## Scope
Suppliers & Customers stores company names, addresses, contacts, emails, phones, and bank accounts. Additions and edits are pending versions; approved bank details remain effective until a different Entity administrator approves a replacement.

Finance AR/AP includes private invoice attachments in R2, structured metadata in D1, bank-account comparisons, open invoices and payment/receipt proof approvals. Proof uploads never directly settle an invoice. Finance has its own tables, separate from staff Expenses.

## Multi-company mailbox connectors: Microsoft 365 and Alibaba Mail

This is the preferred option when the company already uses Outlook / Exchange Online or Alibaba enterprise mail. Do **not** move mail hosting, change MX records, or forward financial correspondence merely to ingest invoices.

### Company selection and isolation
- Finance → Mail accounts uses the selected company (Entity). Each email account row has its own Entity ownership, mailbox address, provider, encrypted app credentials, status, scheduled interval, initial lookback window, last error, and independent sync history.
- A mailbox address is globally unique across the Entity registry, preventing accidental assignment of the same mailbox to two companies. A company may have multiple distinct mailboxes of either provider.
- Invoice imports store **source_mail_account_id** and stable provider/account/message/attachment identities, and retain the same Entity ownership as the mailbox and R2 document. Both database triggers and API membership checks prevent cross-company access.
- The finance-only company release flag, OA_FINANCE_MULTI_ENTITY_ENABLED=true, enables these Finance pages for approved additional Entity memberships without enabling the broader OA_MULTI_ENTITY_BUSINESS_ENABLED flag. Leave it disabled until the Finance authorization tests and two-company staging acceptance are complete. Each Entity must already exist with an active finance administrator membership.
- Switching companies invalidates pending UI requests so an old company's response does not appear under the new selection.

### Microsoft 365 / Outlook
1. In the Microsoft Entra admin center, register an app for this company/tenant. Configure read-only **Mail.Read** application permissions to read attachments; an Entra admin must authorize it.
2. **Restrict mailbox access** to only the authorized payable inbox using **Exchange Online Application RBAC**. Be careful: organization-wide Entra consent and scoped Exchange grants are additive; remove inappropriate unscoped grants.
3. In Finance → Mail accounts select Microsoft 365. Supply the payable mailbox, tenant GUID, application (client) ID and client secret. The secret is encrypted using the existing OA_SETTINGS_MASTER_KEY; it is never returned to the frontend.
4. Click **Test connection**, then enable. The application reads inbox messages with Graph (read-only) and downloads file attachments. Messages are not marked read, moved, replied to, or deleted.

Microsoft official reference:
https://learn.microsoft.com/en-us/graph/api/user-list-messages
https://learn.microsoft.com/en-us/graph/api/message-list-attachments
https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac

### Alibaba enterprise mail
1. In Alibaba enterprise mail Admin → Advanced Applications → API Open Platform, create an application with only the Mail.Read permissions required for listing messages, reading their contents and downloading attachments.
2. Obtain client_id and client_secret. In Finance → Mail accounts select Alibaba Mail. Select the correct official API host: standard/AI Premium https://alimail-cn.aliyuncs.com, domestic https://mail-open.xc.aliyun.com.
3. Use Inbox folder ID **2** (unless the company has another folder to scan). Click Test connection, then enable.
4. Alibaba Mail **free edition does not support** its API Open Platform. If the edition does not permit an API app, do not enter an unrelated user's email/password; provide manual invoice upload or plan a separately reviewed IMAP fallback.

Alibaba official reference:
https://help.aliyun.com/zh/document_detail/2856396.html
https://mailhelp.aliyun.com/docs/api/alimailpb-alimail-mailagent-open-mail-service-get-message
https://help.aliyun.com/zh/document_detail/3022213.html

### Automated polling
- The app has a manual **Sync now** action for each enabled account, and a backend due-account endpoint: POST /api/oa/finance/sync-job.
- The endpoint requires an explicit **OA_FINANCE_SYNC_TOKEN** (32 or more characters) in the x-oa-finance-sync-token header, compares it in constant time, and cannot be called by an unauthenticated public visitor.
- To make 5-minute polling automatic, deploy the **separate** Cloudflare Worker under deploy/finance-mail-cron. Copy wrangler.jsonc.example to wrangler.jsonc and set OA_FINANCE_SYNC_TOKEN on **both** the smarten-oa Worker and the cron Worker. The cron Worker defaults to running at */5 * * * *; it only calls the authenticated finance sync endpoint.
- Each account may set a different sync interval. The server checks whether its next run is due, takes a database lock, queries the provider API, and writes per-account success, import, duplicate and error metrics.
- First sync scans a configurable 1–30 day window (7 days default). Later syncs overlap the previous successful run by one hour, with idempotent message-attachment keys. Excessive backlog causes a visible sync error and no checkpoint advancement rather than silent data loss.
- An initial or changed credential set is saved inactive; the admin must test and explicitly enable it.
- No mailbox or secret is configured by installing this code. Both companies must provide their own credentials through the UI.

### Release checks
Migration 9021_finance_mail_accounts.sql is additive and must be applied after 9020_finance.sql. The production gate checks new tables, Entity isolation triggers, source files, and SQLite tests. Verify in staging with two Entities and two distinct provider credentials; complete the full Next.js TypeScript/build checks. This PR does not deploy workers, change MX or enable multi-company flags.

## Business-level Invoice duplicate detection

**Invoice Number is now part of business duplicate checks**, in addition to immutable mail attachment and manual document duplicate checks. This covers incremental Microsoft 365 and Alibaba Mail, history backfill, other email ingestion and manual PDF/image uploads.

- The comparison matches the **same company/Entity + AR/AP direction + issuer/counterparty** (prefer approved party root, otherwise normalized company name) + **normalized Invoice Number**. NFKC/case/spacing/punctuation folding treats INV-001, inv/001 and INV 001 as equivalent. A bare Invoice No alone is not sufficient to reject an invoice.
- A matching issuer/number with conflicting **amount, currency or invoice date** remains **Possible Duplicate** (showing conflict reason), not an automatic deletion/rejection. Missing details are also flagged for manual comparison; the original R2 file is preserved.
- Different emails, attachment IDs, forwarded invoices, or manual re-uploads create a separate needs_review record marked Possible Duplicate with a link to the existing same-company Invoice. Exact provider message+attachment duplicates are still skipped before download.
- Additive migration 9026_finance_invoice_business_dedup.sql scans already imported needs_review invoices for matching historical business keys. Approved/settled invoice financial statuses are not changed.
- AI re-extraction recomputes duplicate status. Confirm reviewed invoice rechecks using the **final manually approved supplier/customer, AR/AP direction and Invoice Number**, so an AI counterparty mismatch cannot bypass deduplication.
- Administrators can **Confirm duplicate** (explanation required; marks the redundant record rejected with original file retained) or **Clear warning** (explanation required and audited). Clearing does not bypass the hard D1 guard: same company/approved party/direction/normalized Invoice No cannot both be open, payment/receipt pending or settled.
- The Data tab offers a Possible Duplicates filter, linked existing invoice source document, and bilingual warning. Unreviewed/rejected duplicates remain excluded from booked AR/AP balances.
- Cross-company references are rejected in database triggers. Nothing is silently merged, deleted or approved for payment.

**Boundary:** If the document has no reliable supplier/customer and no AR/AP direction, matching by bare Invoice No is unsafe. Such items need manual classification, after which final approval performs the business duplicate check. Customer aliases and different legal names are not automatically reconciled.

## Historical mailbox backfill and AR/AP ledger tabs

**Finance → Configuration → Connected company mailboxes** contains a Historical email backfill panel. Company admins select an enabled mailbox and inclusive UTC start/end dates. This history scan is independent of the initial 1–30-day lookback and of the normal last_success_at checkpoint.

- Start creates a durable per-company D1 job (migration 9025_finance_mail_backfill.sql); it does not delete existing invoices or reset incremental checkpoints. One active, queued or paused job per mailbox is allowed.
- The existing OA_FINANCE_SYNC_TOKEN and /api/oa/finance/sync-job scheduled polling advance the next due job in bounded batches. The admin can use Run next batch for immediate progress; no new API credentials are necessary. Progress persists both a provider continuation token and a page offset.
- Microsoft Graph requests date-filtered mail in descending received order. Alibaba Mail pages are traversed in descending order with a local date filter. Check provider ordering and pagination on a staging mailbox for exhaustive backfills.
- Progress shows page count, scanned relevant messages, imported invoice attachments, duplicates skipped, errors and status. Pause/Resume/Cancel are available and will not delete already imported invoices.
- Historic and incremental runs share the same mailbox lock, and the attachment deduplication key remains (entity_id,source_email_id,source_attachment_id). Imported invoices are not auto-approved.
- Transient failures retry with a delay, then move to Failed for an administrator-controlled Resume. Backfills may take many scheduled runs. The public admin API never exposes raw provider continuation URLs, secrets, or invoice contents.

**Finance → AR/AP** has two top-level tabs: Data and Configuration. Data shows separate AR, AP and Unclassified views, with confirmed balances aggregated across all approved invoices rather than the limited table page. Balances are company scoped and never add different currencies together. Only invoices in open, settlement_pending or settled are booked. Outstanding means open plus settlement_pending; a submitted receipt/payment proof remains outstanding until independently approved. Settled denotes fully received (AR) or fully paid (AP); partial settlement is not supported in the present release. Configuration contains Invoice AI, direct mailboxes and history backfill, legacy Resend and manual import.

**Suppliers & Customers** also has Data and Configuration tabs. Data shows approved suppliers and customers separately (a party configured as both appears in both). Configuration contains proposals, edits, and approvals. Proposed bank changes remain pending until explicitly approved.

For manual Wrangler commands, first change into /Users/sklang/Documents/work/seeder-oa/seeder-oa-app, which owns the production PM_DB binding. Do NOT create a new database to resolve a missing binding error. The update workflow performs build checks and exports a production D1 backup before applying migration 9025.

## DeepSeek reasoning tokens and PDF compatibility

A ModelBridge response with HTTP 200 and output_tokens=4096, reasoning_tokens=4096, output_chars=0 and finish_reason=length means the model spent the entire allowed output budget thinking and did not provide invoice JSON.

- The company invoice AI settings page now includes **Reasoning effort / 推理强度**: Auto, None, Low, Medium, High.
- **Auto** automatically sends Responses reasoning.effort=none for models named deepseek-...; it omits the setting for other models to preserve provider compatibility. You can explicitly choose a level; unsupported provider values may yield HTTP 400.
- With Chat Completions, DeepSeek effort None sends thinking.type=disabled; other providers use the standardized reasoning_effort field if chosen.
- This does not change the 4096-token invoice maximum or automatically retry costly calls. Save and run Test connection before attempting another invoice.
- **Important PDF limitation:** DeepSeek's Responses API does not accept an inline PDF (input_file with base64 file_data). It supports uploaded file_id via a separate Files API. Current Seeder OA/ModelBridge has **not** verified Files API upload-to-model forwarding, so OA refuses inline PDF with a clear error **before** making a billable DeepSeek request. Select a model/provider in ModelBridge that supports inline PDF file_data (e.g. one with verified OpenAI-compatible file input support) or convert an invoice PDF to an image for a new manual import; image inputs can be handled by compatible DeepSeek vision models.
- Changing reasoning effort does not guarantee PDF input support; distinguish transport incompatibility from thinking budget exhaustion.
- Additive D1 schema migration **9024_finance_ai_reasoning_effort.sql**, automatically applied by the existing safe backup/update process.

DeepSeek documentation:
https://api-docs.deepseek.com/guides/thinking_mode/
https://api-docs.deepseek.com/guides/responses_api/
https://api-docs.deepseek.com/guides/document_parsing/

## ModelBridge AI diagnostics and re-extraction feedback

- **Save AI settings** and **Test connection** show an explicit running state and a result directly beside their buttons; the test displays HTTP status, duration and output tokens.
- **Recent ModelBridge calls** shows per-company test and invoice attempts, outcome, response status, finish reason, output item types, input/output/reasoning tokens, elapsed milliseconds and safe request ID.
- No raw AI responses, invoice contents, prompts, document bytes or API keys are stored in diagnostic history. Logs are admin-only and scoped to the currently selected company.
- Every **Re-extract AI** attempt refreshes the invoice list even when the model fails. The old "AI not configured" note is replaced with the new attempt's error; the previous unapproved invoice fields and document remain intact.
- ModelBridge may report HTTP 200 while generating no visible text. The most common candidates are reasoning consuming the whole output budget (Responses status incomplete/max_output_tokens), a response-envelope mismatch or a text/PDF-incompatible upstream model. The invoice output cap was increased from **800 to 4096** tokens and parsing now accepts the two standard compatible text envelopes without replaying the paid request. These changes do not guarantee that a text-only model can ingest PDFs.
- If ModelBridge calls are billed but results remain empty, inspect the new response status, finish reason, output types, reasoning token count, and request ID before changing the model. Confirm PDF capability and/or select a multimodal Responses-compatible model.
- New D1 migration: **9023_finance_ai_diagnostics.sql**. Deployment scripts automatically back up D1, apply the migration before publishing, and check per-company triggers.

## Invoice AI through ModelBridge (company-specific)

Admin → Finance · AR/AP → Invoice AI / ModelBridge 设置 lets each company choose its own Base URL, API Key, model and API protocol.

- **Base URL:** use an HTTPS ModelBridge prefix ending in /v1 (for example, https://your-modelbridge-host/v1), not the full /responses endpoint. Vendor-prefixed paths such as https://your-modelbridge-host/vendor/v1 are supported.
- **API Key:** paste a token issued in ModelBridge. It is encrypted using the existing OA_SETTINGS_MASTER_KEY, never returned to the browser, and retained on edits when the input is left blank.
- **Model name:** enter the exact model identifier configured in ModelBridge and allowed for this token.
- **API protocol:** Responses (default: /v1/responses, PDF and images) or Chat Completions (/v1/chat/completions, images only). Not every upstream model accepts PDF even if the gateway supports Responses. Select a compatible model.
- **Enabled:** save and enable per company. Test connection sends a minimal prompt, not a real invoice. This validates credentials and model routing, but not PDF capability.

Invoices already imported without AI can be reprocessed using **Re-extract AI** in each needs_review invoice's Actions column. It reads the existing private R2 document, without downloading the email again or creating duplicate invoices. Successful extraction updates only the pending invoice metadata; a failed extraction leaves the invoice unchanged. Human confirmation, bank-account matching and settlement approval remain required.

AR/AP is based on matching extracted seller/buyer names with the selected Entity legal/display name, then matching an approved supplier/customer. AI output cannot approve an invoice or relax payment controls. Documents are sent to the chosen ModelBridge service and potentially its upstream provider, so evaluate this data-sharing decision before enabling it. HTTPS and redirect blocking protect keys from cross-origin forwarding.

The legacy Worker-wide OA_FINANCE_AI_API_KEY / OA_FINANCE_AI_MODEL fallback remains only if the company has no saved AI setting. An explicit disabled company setting disables AI for that company. **ModelBridge configuration does not require Worker-wide API secrets.**

Migration 9022_finance_ai_settings.sql is additive. The safe update flow must back up D1, apply the migration, check tables and then deploy. Run the Python migration test and full TypeScript/Next.js build.

## Incoming mailbox (Resend — optional legacy)
1. Review database migration 9020_finance.sql, take a verified D1 backup, then deploy the Worker after schema and build checks.
2. Configure payable@your-company-domain in Admin → Finance · AR/AP. If another email provider already owns your MX records, forward incoming payable emails to a dedicated Resend inbound address, and set that *actual receiving address* in the Finance mailbox settings.
3. In Resend configure a webhook for email.received pointing to https://oa.smartenx.com/api/oa/finance/inbound.
4. Configure these secrets for the smarten-oa Worker with npx wrangler secret put NAME:
   - OA_FINANCE_RESEND_API_KEY — received email/attachment retrieval
   - OA_FINANCE_RESEND_WEBHOOK_SECRET — Svix webhook signing secret
   - OA_FINANCE_AI_API_KEY — legacy Worker-level OpenAI fallback only (not needed for ModelBridge UI)
   - OA_FINANCE_AI_MODEL — legacy Worker-level model override
5. Test with a sample PDF and confirm the invoice is needs_review, attached PDF is stored privately, and cannot be paid without human approval.

The webhook verifies the signature and timestamp, retrieves the email and attachment metadata from Resend, and saves PDF/JPEG/PNG/WebP attachments (max 12 MB). Retries are deduplicated using entity + source email ID + attachment ID.

## Classification and bank checking
AP means the company is the buyer and the counterparty is an approved supplier. An AP invoice must contain an exact normalized bank-account match with the *currently approved* supplier record before it can be opened, and the account is checked again before approval of payment evidence.

AR means the company is the seller; an invoice may show the company's own receiving bank account, rather than the customer's bank account. The check is displayed but not treated as proof of receipt.

Ambiguous invoice direction or counterparty matching remains needs_review. AI parsing is optional; without the configured API key or if extraction fails, a human can review the original invoice and enter its details. AI and the email provider process sensitive business documents; approve that data flow before enabling.

## Workflow
- Party: pending → approved/rejected; approved record becomes superseded only upon approval of a new version.
- Invoice: needs_review → open/rejected; open → settlement_pending → settled (proof approved) or open (proof rejected).
- Proof: pending → approved/rejected.
- Pending party changes and settlement proofs may be assigned to a specific active Entity administrator. Active Entity administrators may approve or reject their own supplier/customer proposals, including assigning themselves; other users cannot approve their own proposals. Settlement payment/receipt proof approvals remain strictly independent: the submitting user cannot decide their own proof. All actions are audited, including party self-approval.

No bank-transfer initiation, bank ownership verification or bank-statement reconciliation is implied.

## Verification
Run python3 tests/test_finance_migration.py, node tests/check-ts-syntax.cjs overlay, Next.js tsc --noEmit and npm run build inside the complete Seeder application. Production deployment script verifies all five new tables and four Entity guard triggers after D1 migration and before publishing. Merging code does not deploy production.
