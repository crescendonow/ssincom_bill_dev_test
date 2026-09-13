# Form regression checks

These checks exercise the billing-note and credit-note fixes described in
`note/5_edit_form_in_bill_creditnote_20260912.md`.

## Browser

Install `playwright-core` (tested with 1.58.2), Chromium, and optionally
`flatpickr` (4.6.13) in a development or temporary directory. Set:

- `PLAYWRIGHT_MODULE`: module name or absolute path to Playwright/Playwright Core.
- `CHROME_EXECUTABLE`: absolute path to Chromium or Chrome.
- `FLATPICKR_DIR`: optional path to `flatpickr/dist`; when set the tests serve
  those assets locally, otherwise they use the templates' CDN URLs.

Run `node --test tests/form_regressions.cjs`.

The harness serves real templates, scripts, CSS and fonts on localhost and
replaces API responses with fixtures. It fixes the browser timezone and date
for the Bangkok midnight regression. Printing is intercepted to inspect actual
FontFace load states at the point the app would invoke the native dialog.
Save-button checks reproduce the Tailwind hidden utility locally because the CDN
is stubbed; they verify visible actions, POST/PUT routing, quantities, retry,
duplicate-submit protection, and document identity during pending saves, loads
and number generation.
No production server or database is contacted. Native printer dialog behavior
and physical output still require a manual check.

## Backend

With FastAPI, SQLAlchemy and Jinja2 installed, run:

`python -m unittest discover -s tests -p 'test_*.py' -v`

The suite imports the real endpoints/models with an isolated SQLite database.
WeasyPrint is mocked at its native rendering boundary: it verifies that the
customer name reaches the original/copy HTML and that the same FontConfiguration
reaches CSS and the renderer. It does not validate the resulting PDF binary;
that needs the application's WeasyPrint native libraries.

## Native invoice PDF layout

Run `python tests/invoice_pdf_layout.py` separately from the mocked backend suite.
It requires the app dependencies and WeasyPrint's native Pango/font libraries
(the application Docker image includes these). No database connection is used.

The test calls the real `/export-merged-pdf` handler with fixture data, renders
and merges all four invoice/receipt variants, and verifies four PDF pages. It
inspects WeasyPrint's actual line boxes to check that the company heading is
one complete line, stays inside the printable page, and overlaps no other text.
Run separately because `test_document_customers.py` substitutes WeasyPrint in
`sys.modules`; native layout checks must use the real renderer.

Regression baseline: WeasyPrint 62.3 with pydyf 0.11.0 split the heading into
multiple lines; the fixed template/CSS pass on 62.3, 63.1, 64.1 and 65.1. Keep 62.3 in the
layout regression matrix when testing renderer upgrades: newer engines can
hide the original flex sizing bug even without the template fix.
