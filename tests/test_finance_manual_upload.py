import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
UI = (ROOT / "overlay/components/oa/finance-console.tsx").read_text()
API = (ROOT / "overlay/app/api/oa/finance/route.ts").read_text()
CORE = (ROOT / "overlay/lib/oa/finance.ts").read_text()

class ManualInvoiceUploadTests(unittest.TestCase):
    def test_data_page_batch_upload(self):
        self.assertIn('directionFilter!=="unknown"&&<div', UI)
        self.assertIn('type="file" multiple', UI)
        self.assertIn('Array.from(e.dataTransfer.files)', UI)
        self.assertIn('request(company,"invoice_import",{document_id,direction})', UI)
        self.assertIn('catch(e){failures.push', UI)
        self.assertIn('await load(company)', UI)
        self.assertNotIn('Import an invoice manually', UI)

    def test_direction_hint_does_not_override_evidence(self):
        self.assertIn('requestedDirection!=="ar"&&requestedDirection!=="ap"', API)
        self.assertIn('detectedDirection!==input.requestedDirection', CORE)
        self.assertIn('direction=conflict?"unknown"', CORE)
        self.assertIn('detectedDirection==="unknown"?null:await findParty', CORE)
        self.assertIn('source:"manual"', API)

    def test_entity_and_review_guards(self):
        self.assertIn('else if(access.role!=="admin")return fail("Forbidden",403)', API)
        self.assertIn("WHERE id=? AND entity_id=? AND purpose='invoice'", API)
        self.assertIn('doc.uploaded_by!==viewer.id', API)
        self.assertIn('status:"needs_review"', API)
        self.assertIn('findBusinessInvoiceDuplicate(probe)', CORE)
        self.assertIn('invoiceReviewVerified(checked)', API)

if __name__ == "__main__":
    unittest.main()
