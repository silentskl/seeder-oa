-- Each proof applies an exact positive amount in invoice currency (minor units).
-- Legacy proofs represented the entire invoice; preserve their original meaning.
ALTER TABLE oa_finance_settlement ADD COLUMN amount_minor INTEGER CHECK(amount_minor IS NULL OR (typeof(amount_minor)='integer' AND amount_minor>0));
UPDATE oa_finance_settlement SET amount_minor=(SELECT amount_minor FROM oa_finance_invoice i WHERE i.id=oa_finance_settlement.invoice_id AND i.entity_id=oa_finance_settlement.entity_id);
CREATE INDEX oa_finance_settlement_amounts ON oa_finance_settlement(entity_id,invoice_id,status);
-- A new proof may only reserve the remaining amount of an open invoice.
CREATE TRIGGER oa_finance_partial_submit_guard BEFORE INSERT ON oa_finance_settlement
WHEN NEW.status<>'pending' OR NEW.amount_minor IS NULL OR NOT EXISTS(
 SELECT 1 FROM oa_finance_invoice i WHERE i.id=NEW.invoice_id AND i.entity_id=NEW.entity_id
 AND i.status='open' AND i.amount_minor>0 AND i.currency IS NOT NULL
 AND NEW.amount_minor<=i.amount_minor-COALESCE((SELECT SUM(s.amount_minor) FROM oa_finance_settlement s WHERE s.entity_id=i.entity_id AND s.invoice_id=i.id AND s.status IN ('approved','pending')),0)
)
BEGIN SELECT RAISE(ABORT,'Invalid settlement amount or invoice state'); END;
CREATE TRIGGER oa_finance_partial_submit_state AFTER INSERT ON oa_finance_settlement
BEGIN UPDATE oa_finance_invoice SET status='settlement_pending',updated_at=CURRENT_TIMESTAMP WHERE id=NEW.invoice_id AND entity_id=NEW.entity_id; END;
-- Financial evidence is immutable after submission; assignment and decision metadata remain editable.
CREATE TRIGGER oa_finance_partial_amount_immutable BEFORE UPDATE OF amount_minor,invoice_id,entity_id,document_id,submitted_by ON oa_finance_settlement
WHEN NEW.amount_minor IS NOT OLD.amount_minor OR NEW.invoice_id IS NOT OLD.invoice_id OR NEW.entity_id IS NOT OLD.entity_id OR NEW.document_id IS NOT OLD.document_id OR NEW.submitted_by IS NOT OLD.submitted_by
BEGIN SELECT RAISE(ABORT,'Settlement evidence is immutable'); END;
CREATE TRIGGER oa_finance_partial_decide_guard BEFORE UPDATE OF status ON oa_finance_settlement
WHEN NEW.status<>OLD.status AND (OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected') OR NOT EXISTS(
 SELECT 1 FROM oa_finance_invoice i WHERE i.id=OLD.invoice_id AND i.entity_id=OLD.entity_id AND i.status='settlement_pending'
 AND (NEW.status='rejected' OR (OLD.amount_minor IS NOT NULL AND OLD.amount_minor<=i.amount_minor-COALESCE((SELECT SUM(s.amount_minor) FROM oa_finance_settlement s WHERE s.entity_id=i.entity_id AND s.invoice_id=i.id AND s.status='approved'),0)))
))
BEGIN SELECT RAISE(ABORT,'Invalid settlement decision or remaining balance'); END;
CREATE TRIGGER oa_finance_partial_decide_state AFTER UPDATE OF status ON oa_finance_settlement
WHEN OLD.status='pending' AND NEW.status IN ('approved','rejected')
BEGIN
 UPDATE oa_finance_invoice SET status=CASE WHEN COALESCE((SELECT SUM(s.amount_minor) FROM oa_finance_settlement s WHERE s.entity_id=NEW.entity_id AND s.invoice_id=NEW.invoice_id AND s.status='approved'),0)=amount_minor THEN 'settled' ELSE 'open' END,updated_at=CURRENT_TIMESTAMP
 WHERE id=NEW.invoice_id AND entity_id=NEW.entity_id;
END;
-- Historic settled invoices without an approved proof retain their settled value.
CREATE VIEW oa_finance_settlement_totals AS
SELECT i.id AS invoice_id,i.entity_id,
 CASE WHEN i.status='settled' THEN i.amount_minor ELSE COALESCE(SUM(CASE WHEN s.status='approved' THEN s.amount_minor ELSE 0 END),0) END AS paid_minor,
 COALESCE(SUM(CASE WHEN s.status='pending' THEN s.amount_minor ELSE 0 END),0) AS pending_minor
FROM oa_finance_invoice i LEFT JOIN oa_finance_settlement s ON s.entity_id=i.entity_id AND s.invoice_id=i.id
GROUP BY i.id,i.entity_id;
