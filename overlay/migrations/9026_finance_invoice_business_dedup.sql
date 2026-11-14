-- Business-level invoice duplicate warnings, independent of immutable email/attachment deduplication.
-- A different email or a forwarded/re-uploaded PDF is retained, but flagged
-- for review instead of being silently discarded or booked twice.
ALTER TABLE oa_finance_invoice ADD COLUMN invoice_number_key TEXT NOT NULL DEFAULT '';
ALTER TABLE oa_finance_invoice ADD COLUMN counterparty_key TEXT NOT NULL DEFAULT '';
ALTER TABLE oa_finance_invoice ADD COLUMN duplicate_of_invoice_id TEXT REFERENCES oa_finance_invoice(id);
ALTER TABLE oa_finance_invoice ADD COLUMN duplicate_status TEXT NOT NULL DEFAULT 'none'
 CHECK(duplicate_status IN ('none','possible','dismissed','confirmed'));
ALTER TABLE oa_finance_invoice ADD COLUMN duplicate_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE oa_finance_invoice ADD COLUMN duplicate_decision_note TEXT NOT NULL DEFAULT '';
ALTER TABLE oa_finance_invoice ADD COLUMN duplicate_decided_by TEXT REFERENCES user(id);
ALTER TABLE oa_finance_invoice ADD COLUMN duplicate_decided_at TEXT;

-- Common punctuation/spacing variants of historical invoice numbers are backfilled in SQL.
-- New invoices use NFKC and the stronger application normalizer.
UPDATE oa_finance_invoice
 SET invoice_number_key=LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(invoice_number),' ',''),'-',''),'/',''),'.',''),'_',''),'#',''),':',''),char(9),'')),
     counterparty_key=LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(counterparty_name),' ',''),'.',''),'-',''),'/',''),'_',''))
 WHERE invoice_number<>'' OR counterparty_name<>'';
CREATE INDEX IF NOT EXISTS oa_finance_invoice_business_lookup
 ON oa_finance_invoice(entity_id,direction,invoice_number_key,status);

-- Mark already-imported review-queue duplicates. Never change their financial
-- status and never auto-reject archived invoices.
UPDATE oa_finance_invoice AS i
 SET duplicate_of_invoice_id=(
  SELECT j.id FROM oa_finance_invoice j
  WHERE j.entity_id=i.entity_id AND j.direction=i.direction
    AND j.invoice_number_key=i.invoice_number_key AND j.invoice_number_key<>''
    AND j.status<>'rejected'
    AND (j.status IN ('open','settlement_pending','settled') OR j.created_at<i.created_at OR (j.created_at=i.created_at AND j.id<i.id))
    AND ((i.party_root_id IS NOT NULL AND j.party_root_id=i.party_root_id)
      OR (i.counterparty_key<>'' AND i.counterparty_key=j.counterparty_key))
  ORDER BY j.created_at ASC,j.id ASC LIMIT 1),
 duplicate_status='possible',
 duplicate_reason='legacy_same_number_party'
 WHERE i.status='needs_review' AND i.direction IN ('ar','ap')
   AND i.invoice_number_key<>'' AND (i.party_root_id IS NOT NULL OR i.counterparty_key<>'')
   AND EXISTS(
    SELECT 1 FROM oa_finance_invoice j
    WHERE j.entity_id=i.entity_id AND j.direction=i.direction
      AND j.invoice_number_key=i.invoice_number_key AND j.invoice_number_key<>''
      AND j.status<>'rejected'
      AND (j.status IN ('open','settlement_pending','settled') OR j.created_at<i.created_at OR (j.created_at=i.created_at AND j.id<i.id))
      AND ((i.party_root_id IS NOT NULL AND j.party_root_id=i.party_root_id)
        OR (i.counterparty_key<>'' AND i.counterparty_key=j.counterparty_key))
   );

CREATE INDEX IF NOT EXISTS oa_finance_invoice_duplicate_queue
 ON oa_finance_invoice(entity_id,duplicate_status,status,created_at DESC);

-- Never permit a cross-company invoice pointer, including updates through raw SQL.
CREATE TRIGGER IF NOT EXISTS oa_finance_duplicate_company_insert
 BEFORE INSERT ON oa_finance_invoice WHEN NEW.duplicate_of_invoice_id IS NOT NULL
 AND (NEW.duplicate_of_invoice_id=NEW.id OR NOT EXISTS(
  SELECT 1 FROM oa_finance_invoice other
  WHERE other.id=NEW.duplicate_of_invoice_id AND other.entity_id=NEW.entity_id))
 BEGIN SELECT RAISE(ABORT,'invoice duplicate target company mismatch'); END;
CREATE TRIGGER IF NOT EXISTS oa_finance_duplicate_company_update
 BEFORE UPDATE OF duplicate_of_invoice_id,entity_id ON oa_finance_invoice
 WHEN NEW.duplicate_of_invoice_id IS NOT NULL
 AND (NEW.duplicate_of_invoice_id=NEW.id OR NOT EXISTS(
  SELECT 1 FROM oa_finance_invoice other
  WHERE other.id=NEW.duplicate_of_invoice_id AND other.entity_id=NEW.entity_id))
 BEGIN SELECT RAISE(ABORT,'invoice duplicate target company mismatch'); END;

-- Existing raw-number unique index remains. Add a concurrency-safe guard for
-- normalized business keys in newly opened/settled invoices. A human dismissal
-- never bypasses duplicate open-invoice accounting for the SAME company/party/number.
CREATE TRIGGER IF NOT EXISTS oa_finance_business_duplicate_open_insert
 BEFORE INSERT ON oa_finance_invoice
 WHEN NEW.status IN ('open','settlement_pending','settled')
  AND NEW.invoice_number_key<>'' AND NEW.party_root_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM oa_finance_invoice other
   WHERE other.entity_id=NEW.entity_id AND other.direction=NEW.direction
    AND other.party_root_id=NEW.party_root_id AND other.invoice_number_key=NEW.invoice_number_key
    AND other.status IN ('open','settlement_pending','settled'))
 BEGIN SELECT RAISE(ABORT,'duplicate normalized invoice number for approved counterparty'); END;
CREATE TRIGGER IF NOT EXISTS oa_finance_business_duplicate_open_update
 BEFORE UPDATE OF status,direction,party_root_id,invoice_number_key ON oa_finance_invoice
 WHEN NEW.status IN ('open','settlement_pending','settled')
  AND NEW.invoice_number_key<>'' AND NEW.party_root_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM oa_finance_invoice other
   WHERE other.id<>NEW.id AND other.entity_id=NEW.entity_id
    AND other.direction=NEW.direction AND other.party_root_id=NEW.party_root_id
    AND other.invoice_number_key=NEW.invoice_number_key
    AND other.status IN ('open','settlement_pending','settled'))
 BEGIN SELECT RAISE(ABORT,'duplicate normalized invoice number for approved counterparty'); END;
