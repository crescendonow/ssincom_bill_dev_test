"""Native PDF regression checks. Run separately: python tests/invoice_pdf_layout.py.

Requires the app dependencies and WeasyPrint's native libraries. The database
module is isolated before importing the real invoice endpoints.
"""
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from pypdf import PdfReader
from sqlalchemy.orm import declarative_base
from starlette.requests import Request
from weasyprint import HTML
from weasyprint.formatting_structure.boxes import LineBox

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
database = types.ModuleType("app.database")
database.Base = declarative_base()
database.SessionLocal = MagicMock()
sys.modules["app.database"] = database

from app import form

COMPANY_NAME = "บริษัท เอส แอนด์ เอส อินคอม จำกัด"
VARIANTS = ("invoice_original", "receipt_original", "invoice_copy", "receipt_copy")


def line_text(box):
    return "".join(child.text for child in box.descendants() if hasattr(child, "text")).strip()


class InvoicePdfLayoutTests(unittest.TestCase):
    def test_merged_company_name_stays_on_one_line_in_all_four_variants(self):
        rendered = []

        class RecordingHTML(HTML):
            def render(self, *args, **kwargs):
                document = super().render(*args, **kwargs)
                rendered.append(document)
                return document

        payload = {
            "invoice_number": "INV-PDF-TEST", "invoice_date": "2026-09-13",
            "due_date": "2026-10-13", "personid": "TEST001",
            "customer_prename": "บริษัท", "fname": "ลูกค้าทดสอบ จำกัด",
            "cf_personaddress": "69 หมู่ 10", "cf_provincename": "กาญจนบุรี",
            "cf_personzipcode": "71140", "cf_taxid": "1234567890123",
            "items": [{"cf_itemid": "P001", "cf_itemname": "สินค้าทดสอบ",
                       "quantity": 2, "unit_price": 100}],
        }
        request = Request({"type": "http", "method": "POST", "path": "/export-merged-pdf",
                           "headers": [], "scheme": "http", "server": ("test", 80)})
        db = MagicMock()
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(form.tempfile, "gettempdir", return_value=tmp), \
                patch.object(form, "HTML", RecordingHTML):
            response = form.export_merged_pdf(request=request, payload=payload, db=db)
            self.assertEqual(len(PdfReader(response.path).pages), 4)
        db.query.assert_not_called()
        self.assertEqual(len(rendered), 4)
        for variant, document in zip(VARIANTS, rendered):
            with self.subTest(variant=variant):
                self.assertEqual(len(document.pages), 1)
                lines = [box for box in document.pages[0]._page_box.descendants()
                         if isinstance(box, LineBox)]
                # Match the heading element, not the name inside payment terms.
                company_lines = [box for box in lines if box.element is not None
                                 and (box.element.text or "").strip() == COMPANY_NAME]
                self.assertEqual([line_text(box) for box in company_lines], [COMPANY_NAME])
                company = company_lines[0]
                page = document.pages[0]._page_box
                self.assertGreaterEqual(company.position_x, page.content_box_x())
                self.assertLessEqual(company.position_x + company.width,
                                     page.content_box_x() + page.width)
                for other in lines:
                    if other is company or not line_text(other):
                        continue
                    overlap_x = min(company.position_x + company.width,
                                    other.position_x + other.width) - max(company.position_x, other.position_x)
                    overlap_y = min(company.position_y + company.height,
                                    other.position_y + other.height) - max(company.position_y, other.position_y)
                    self.assertFalse(overlap_x > 0.1 and overlap_y > 0.1,
                                     f"Company heading overlaps: {line_text(other)}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
