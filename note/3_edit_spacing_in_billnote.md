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

## 2026-07-05 Credit Note Font/Pagination Update
- Confirmed problem sample: `credit_note_SSCR14-3006_2569 (3).pdf` is the current broken output.
- Priority: readability first. Do not compress Thai text horizontally just to fit more rows.
- Remove any effective character condensing for exported PDF: no letter-spacing reduction, no font-stretch/scale transforms, and prefer a real embedded Thai font so WeasyPrint/browser PDF rendering does not substitute a cramped fallback.
- Do not keep credit-note pagination fixed at 10 rows if the page is unnecessarily short.
- Test candidate row counts in the 15-20 range and choose the highest count that still keeps the first page fully visible, with no clipped final row.
- Preserve current line spacing where possible; the reported line spacing is already acceptable.
- Fix the first-page missing/clipped last-row issue by making pagination leave a measurable safety margin instead of relying on exact A4 height.
- Keep summary, reason, and signature blocks on the final logical page only.
- Keep public routes, payloads, DB schema, document numbers, totals, VAT, save/update flows, and PDF filename behavior unchanged.

## Implementation Plan For This Round
- Scope confirmed: update only credit-note export/preview. Do not change bill-note behavior in this round.
- Update `app/credit_note.py` pagination constant/helper after verification. Candidate values: 15, 16, 17, 18, 19, 20 rows/page.
- Update `app/static/css/credit_note.css` to remove horizontal compression risk and define/load the local `TH Sarabun New` font files explicitly for PDF rendering.
- Add a focused verification path that renders credit-note test fixtures with 15-20 rows and checks page count/pagination output; if PDF dependencies are not usable locally, document that verification gap.
- Run syntax checks after edits: `python -m py_compile app/credit_note.py app/bill_note.py`.
- Probe result: candidate 15 is selected for this round because it is the safest value in the requested 15-20 range after readability-first font changes. Edge headless showed overflow risk for 15-20 with medium-length descriptions, so do not raise above 15 without a real WeasyPrint/runtime PDF check.
