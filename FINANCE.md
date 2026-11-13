# Seeder OA finance module

## Scope
Suppliers & Customers stores company names, addresses, contacts, emails, phones, and bank accounts. Additions and edits are pending versions; approved bank details remain effective until a different Entity administrator approves a replacement.

Finance AR/AP includes private invoice attachments in R2, structured metadata in D1, bank-account comparisons, open invoices and payment/receipt proof approvals. Proof uploads never directly settle an invoice. Finance has its own tables, separate from staff Expenses.

## Incoming mailbox (Resend)
1. Review database migration 9020_finance.sql, take a verified D1 backup, then deploy the Worker after schema and build checks.
2. Configure payable@your-company-domain in Admin → Finance · AR/AP. If another email provider already owns your MX records, forward incoming payable emails to a dedicated Resend inbound address, and set that *actual receiving address* in the Finance mailbox settings.
3. In Resend configure a webhook for email.received pointing to https://oa.smartenx.com/api/oa/finance/inbound.
4. Configure these secrets for the smarten-oa Worker with npx wrangler secret put NAME:
   - OA_FINANCE_RESEND_API_KEY — received email/attachment retrieval
   - OA_FINANCE_RESEND_WEBHOOK_SECRET — Svix webhook signing secret
   - OA_FINANCE_AI_API_KEY — optional OpenAI invoice extraction
   - OA_FINANCE_AI_MODEL — optional model override, default gpt-4.1-mini
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
- Pending party changes and settlement proofs may be assigned to a specific active Entity administrator. Self-approval is prohibited. All actions are audited.

No bank-transfer initiation, bank ownership verification or bank-statement reconciliation is implied.

## Verification
Run python3 tests/test_finance_migration.py, node tests/check-ts-syntax.cjs overlay, Next.js tsc --noEmit and npm run build inside the complete Seeder application. Production deployment script verifies all five new tables and four Entity guard triggers after D1 migration and before publishing. This development branch does not deploy automatically.
