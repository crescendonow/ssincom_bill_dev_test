"""Isolated endpoint/context tests; no production database or native PDF libraries.

Run: python -m unittest discover -s tests -p 'test_*.py' -v
Requires the app's FastAPI, SQLAlchemy and Jinja2 dependencies.
WeasyPrint is replaced only at its native rendering boundary to test font wiring.
"""
import sqlite3
import sys
import tempfile
import types
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# Avoid even importing the application's configured database connection.
database = types.ModuleType('app.database')
database.Base = declarative_base()
database.SessionLocal = MagicMock()
sys.modules['app.database'] = database
weasy = types.ModuleType('weasyprint')
weasy.HTML, weasy.CSS = MagicMock(), MagicMock()
fonts = types.ModuleType('weasyprint.text.fonts')
fonts.FontConfiguration = MagicMock()
sys.modules['weasyprint'] = weasy
sys.modules['weasyprint.text'] = types.ModuleType('weasyprint.text')
sys.modules['weasyprint.text.fonts'] = fonts

from app import models, credit_note as credit, customers


class CustomerDocumentTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', native_datetime=True, connect_args={'detect_types': sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES})
        with self.engine.connect() as conn:
            for schema in ('products', 'ss_invoices', 'ss_bills', 'credits', 'public'):
                conn.exec_driver_sql(f"ATTACH DATABASE ':memory:' AS {schema}")
            conn.connection.create_function('concat', -1, lambda *args: ''.join(str(x or '') for x in args))
        database.Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.customer = models.CustomerList(idx=1, personid='PC001', prename='บริษัท', fname='ทดสอบ จำกัด', cf_hq=1)
        self.db.add(self.customer)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def seed_saved_credit(self):
        self.db.add(models.Invoice(idx=1, invoice_number='INV001', personid='PC001', invoice_date=date(2026, 8, 1)))
        self.db.add(credit.CreditNote(idx=1, creditnote_number='CNTEST', created_at=date(2026, 8, 15)))
        self.db.add(credit.CreditNoteItem(idx=1, creditnote_number='CNTEST', invoice_number='INV001', cf_itemid='P001', cf_itemname='สินค้า', sum_quantity=2, fine=1, price_after_fine=9))
        self.db.commit()

    def test_lookup_by_id_exposes_prefix_without_changing_fname(self):
        result = credit.api_cust_by_personid(personid='PC001', db=self.db)
        self.assertEqual(result['prename'], 'บริษัท')
        self.assertEqual(result['fname'], 'ทดสอบ จำกัด')

    def test_suggestion_and_lookup_accept_full_name_and_legacy_bare_name(self):
        for search in ('ทดสอบ', 'บริษัท', 'บริษัท ทดสอบ'):
            with self.subTest(search=search):
                result = credit.api_cust_suggest_name(q=search, limit=10, db=self.db)
                self.assertIn('บริษัท ทดสอบ จำกัด', result['items'])
        for name in ('ทดสอบ จำกัด', 'บริษัท ทดสอบ จำกัด'):
            result = credit.api_cust_by_name(name=name, db=self.db)
            self.assertEqual(result['personid'], 'PC001')
            self.assertEqual(result['prename'], 'บริษัท')

    def test_names_with_blank_or_already_present_prefix(self):
        for prefix, name, expected in (
            (None, 'ทดสอบ จำกัด', 'ทดสอบ จำกัด'),
            ('  ', 'ทดสอบ จำกัด', 'ทดสอบ จำกัด'),
            ('บริษัท', 'บริษัท ทดสอบ จำกัด', 'บริษัท ทดสอบ จำกัด'),
            (' บริษัท ', ' ทดสอบ จำกัด ', 'บริษัท ทดสอบ จำกัด'),
        ):
            with self.subTest(prefix=prefix, name=name):
                self.customer.prename, self.customer.fname = prefix, name
                self.db.commit()
                result = credit.api_cust_suggest_name(q='', limit=10, db=self.db)
                self.assertEqual(result['items'], [expected])
                selected = credit.api_cust_by_name(name=expected, db=self.db)
                self.assertEqual(selected['personid'], 'PC001')
                ctx = credit._build_creditnote_context_from_payload({'buyer': {'personid': 'PC001'}, 'creditnote_date': '2026-08-15'}, self.db)
                self.assertEqual(ctx['buyer']['name'], expected)

    def test_payload_preview_and_pdf_context_use_customer_master_prefix(self):
        ctx = credit._build_creditnote_context_from_payload({'buyer': {'personid': 'PC001', 'name': 'ชื่อจากฟอร์ม'}, 'creditnote_date': '2026-08-15'}, self.db)
        self.assertEqual(ctx['buyer']['name'], 'บริษัท ทดสอบ จำกัด')
        self.assertEqual(ctx['doc_date_be'], '15/08/2569')
        self.assertEqual(ctx['buyer']['addr'], '')
        self.assertEqual(ctx['buyer']['tax'], '')
        html = credit.templates.env.get_template('credit_note.html').render(ctx)
        self.assertIn('บริษัท ทดสอบ จำกัด', html)

    def test_saved_credit_reload_and_print_preview_keep_prefix(self):
        self.seed_saved_credit()
        result = credit.get_credit_note(no='CNTEST', db=self.db)
        self.assertEqual(result['buyer']['name'], 'บริษัท ทดสอบ จำกัด')
        with patch.object(credit.templates, 'TemplateResponse') as render:
            credit.credit_note_preview_page(request=MagicMock(), no='CNTEST', db=self.db)
        ctx = next(arg for arg in render.call_args.args if isinstance(arg, dict))
        self.assertEqual(ctx['buyer']['name'], 'บริษัท ทดสอบ จำกัด')
        self.assertEqual(ctx['doc_date_be'], '15/08/2569')
        self.assertEqual(ctx['buyer']['addr'], '')
        self.assertEqual(ctx['buyer']['tax'], '')

    def test_pdf_external_font_configuration_reaches_css_and_renderer(self):
        seen = {}
        def stylesheet(**kwargs):
            seen['css_config'] = kwargs.get('font_config')
            return object()
        def write_pdf(target, **kwargs):
            seen['render_config'] = kwargs.get('font_config')
            Path(target).write_bytes(b'%PDF-test-boundary')
        with tempfile.TemporaryDirectory() as tmp, patch.object(credit.tempfile, 'gettempdir', return_value=tmp), patch.object(credit, 'CSS', side_effect=stylesheet), patch.object(credit, 'HTML') as html:
            html.return_value.write_pdf.side_effect = write_pdf
            response = credit.export_creditnote_pdf(payload={'creditnote_number': 'CNTEST', 'creditnote_date': '2026-08-15', 'buyer': {'personid': 'PC001'}}, db=self.db)
            self.assertTrue(Path(response.path).exists())
            rendered = html.call_args.kwargs['string']
            self.assertEqual(rendered.count('บริษัท ทดสอบ จำกัด'), 2)
        self.assertIsNotNone(seen['css_config'], 'External @font-face CSS needs FontConfiguration')
        self.assertIs(seen['css_config'], seen['render_config'])

    def test_bill_customer_api_preserves_prefix_and_identity(self):
        result = customers.api_customers_all(db=self.db)
        self.assertEqual(result[0]['idx'], 1)
        self.assertEqual(result[0]['prename'], 'บริษัท')
        self.assertEqual(result[0]['customer_name'], 'ทดสอบ จำกัด')


if __name__ == '__main__':
    unittest.main()