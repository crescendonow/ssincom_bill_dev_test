# Fix Bill/Credit Note Signature Overflow

## Summary
- Scope: fix both `bill_note` and `credit_note`.
- Root cause: pagination is based on fixed row counts (`10`) while print/PDF height also depends on summary, signature blocks, table padding, and line-height.
- Target behavior: squeeze spacing first; if content still cannot fit A4, split into logical pages so signature/summary are on the declared final page, with no signature-only orphan page.

## Key Changes
- Tighten print spacing in `bill_note.css` and `credit_note.css`: reduce table vertical padding, line-height, signature top/bottom spacing, and overly broad signature paragraph styling while keeping Thai text readable.
- For `bill_note`, update `renderBillDocument` so signatures appear only on the final logical page, summary remains final-page only, page numbers are recalculated after pagination, and row packing checks whether final-page content fits before printing.
- For `credit_note`, replace both `ITEMS_PER_PAGE = 10` blocks in `credit_note.py` with one shared pagination helper. The helper must use measured/verified max rows after CSS tightening, and must split before a last page would overflow with summary + reason + signatures.
- Keep public routes, payloads, DB schema, document numbers, totals, VAT, and save/update flows unchanged.

## Test Plan
- Recreate the attached 7-row credit-note case (`SSCR13-2906/2569`): generated PDF should be original + copy only, no extra signature-only pages, and signature text must appear on each `หน้า 1/1`.
- Recreate the 11-row credit-note case (`SSCR14-3006/2569`): generated PDF should keep valid `หน้า 1/2` and `หน้า 2/2` sequences for original/copy, with signatures on each `หน้า 2/2`.
- Test bill note fixtures with 1, 7, 10, and 11 invoices: no clipped table, no orphan signature page, summary/signature only on the final logical page, correct `page-number`.
- Run syntax checks: `python -m py_compile app/credit_note.py app/bill_note.py` and `node --check app/static/js/bill_note.js`.
- Verify PDFs visually using WeasyPrint for credit note and Chrome/Edge print-to-PDF for bill note.

## Assumptions
- The requested architecture file is `app/.docs/arcitecture_ssincom_bill.md`; root `.docs/arcitecture_ssincom_bill.md` does not exist.
- Attached PDFs are credit-note examples of the same signature overflow class.
- No dependency installation or database migration is part of this fix.

## Credit Note Pagination Fix
- Change credit-note pagination to a fixed 10 rows per page: rows 1-10 on page 1, rows 11-20 on page 2, and so on.
- Remove the previous final-page-only 7-row pagination logic.
- Keep summary, reason, and signature blocks on the final logical page only.
- Verify generated PDFs do not contain blank pages after the pagination and spacing changes.
