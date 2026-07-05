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

## 2026-07-05 (รอบ 2) — สอบสวนบั๊กใหม่: ตัวอักษร PDF ถูกบีบอัด + font หน้า credit_note_form เล็กผิดปกติ

### รายงานจากผู้ใช้ (ยังไม่ได้แก้โค้ดใด ๆ ในรอบนี้)
- Export PDF ใบลดหนี้ (`POST /export-creditnote-pdf`) แล้วตัวอักษรถูกบีบอัดจนอ่านไม่เข้าใจ — ตัวอย่างที่แนบ: `credit_note_SSCR14-3006_2569 (1).pdf` (เคส `SSCR14-3006/2569`, 11 แถว — เคสเดียวกับที่ระบุไว้ใน "รอบ 1" ว่าเป็น "current broken output")
- หน้า `credit_note_form.html` ฟอนต์ไม่เหมือนหน้าอื่น เล็กกว่ามาก ("หน้าอื่น" ใช้ Noto Sans Thai)
- ขอบเขต: แก้เฉพาะ credit_note เท่านั้นในรอบนี้

### สิ่งที่ตรวจสอบแล้ว (evidence, ยืนยันด้วยการอ่านโค้ด/ทดสอบจริง ไม่ใช่การเดา)
1. **`app/.docs/arcitecture_ssincom_bill.md` เก่ากว่าโค้ดปัจจุบัน** — สรุปจาก commit `074c7d1` แต่ HEAD ตอนนี้คือ `5fd8f15` (ห่างกัน 4 commits: `d074c7d1 → a3f5953 → 6797a4d(?)/715529e → 5fd8f15`) เอกสารเขียนว่า "ไม่มีการประกาศ @font-face ในโปรเจกต์เลย" ซึ่ง**ไม่ตรงกับโค้ดปัจจุบันแล้ว**
2. `app/static/css/credit_note.css` ปัจจุบันมี `@font-face` ประกาศ TH Sarabun New ครบ 4 น้ำหนัก (Regular/Bold/Italic/BoldItalic) ชี้ไปที่ `../fonts/THSarabunNew*.ttf` (ของจริงมีอยู่ที่ `app/static/fonts/`) — เป็นการเปลี่ยนแปลงจาก "รอบ 1" ที่ตั้งใจแก้ปัญหา font เดิม
3. **ปัญหาที่พบ (สาเหตุน่าจะเป็นของ "font หน้าฟอร์มเล็กผิดปกติ"):** กฎ `body { font-family: "TH Sarabun New", "Noto Sans Thai", sans-serif !important; }` ใน `credit_note.css` (บรรทัด 32-35) **ไม่ได้ scope ไว้แค่เอกสารพิมพ์** (ไม่มี `@media print`, ไม่จำกัดแค่ `.A4-page`/`.credit-note`) และ `credit_note_form.html` (หน้ากรอกฟอร์มบนจอ) ก็ `<link>` ไปที่ CSS ไฟล์เดียวกันนี้ (บรรทัด 8) ⇒ **หน้าฟอร์มทั้งหน้าถูกบังคับให้ใช้ TH Sarabun New ไปด้วย ทั้งที่ตั้งใจไว้สำหรับเอกสารที่พิมพ์/PDF เท่านั้น**
4. เทียบกับ `app/static/css/bill_note.css` (ตัวแทน "หน้าอื่น" ที่ผู้ใช้อ้างถึง): ตั้ง `body { font-family: "Noto Sans Thai", sans-serif !important; }` เฉย ๆ ไม่มี @font-face เลย — ตรงกับที่ผู้ใช้บอกว่าหน้าอื่นเป็น "notosans"
5. TH Sarabun New เป็นที่รู้กันทั่วไปว่า glyph มีสัดส่วนเล็กกว่า em-square มากเมื่อเทียบกับฟอนต์อื่น (ที่ font-size เท่ากัน ตัวอักษรจะดูเล็กกว่า Noto Sans Thai/Tahoma อย่างชัดเจน) — ตรงกับอาการ "เล็กกว่ามาก" ที่ผู้ใช้รายงานพอดี ถ้าสาเหตุคือข้อ 3
6. ตรวจไฟล์ฟอนต์ที่ @font-face อ้างถึงด้วย `fontTools` (`app/static/fonts/THSarabunNew*.ttf` ทั้ง 4 ไฟล์): cmap มี 504 entries, map Unicode ไทยถูกต้องตรงตัว (เช่น U+0E01 → glyph `uni0E01`) ทั้ง platform (0,3) และ Windows (3,1) มีตาราง GSUB/GPOS/GDEF ครบทุกไฟล์ ⇒ **ไม่ใช่ font ที่ cmap พังแบบตรงไปตรงมา**
7. `export_creditnote_pdf` (`app/credit_note.py:438`) โหลด CSS ด้วย `CSS(filename=str(css_path))` ซึ่ง WeasyPrint resolve relative `url("../fonts/...")` เทียบกับตำแหน่งไฟล์ CSS เอง (`app/static/css/`) ถูกต้องอยู่แล้ว ⇒ ไม่ใช่บั๊ก path/base_url
8. `app/static/js/credit_note.js` ไม่มีโค้ดที่ยุ่งกับ letter-spacing/scale/compress ใด ๆ
9. `Dockerfile` ติดตั้ง `fonts-thai-tlwg` + `fonts-noto-core/cjk/color-emoji` เท่านั้น — **ไม่มี package ไหนติดตั้งฟอนต์ชื่อ "TH Sarabun New" จริง** ดังนั้นก่อนมี @font-face ชื่อนี้ไม่เคย match ฟอนต์ระบบ แล้ว fallback ไป "Noto Sans Thai" (เสถียร ผ่านการทดสอบมาดี) โดยอัตโนมัติเสมอ — **หลัง**เพิ่ม @font-face ใน commit ล่าสุด WeasyPrint จะเจอ match จริงและเปลี่ยนไปใช้ไฟล์ TTF ที่แนบมาแทนเป็นครั้งแรก (จุดนี้เป็นตัวแปรใหม่ที่เพิ่งถูกเปิดใช้งาน)
10. **ข้อจำกัดสำคัญที่ต้องแจ้ง:** ไม่สามารถรัน WeasyPrint จริงบนเครื่อง Windows นี้ได้ (native — ขาด `libgobject-2.0-0`/GTK runtime, ทดสอบแล้วได้ error จริง) และไม่มี Docker ติดตั้ง/รันอยู่ในเครื่องนี้เลย (`docker` command not found) ⇒ **ไม่มีทางเรนเดอร์ PDF จริงเพื่อยืนยันด้วยตาตัวเองในสภาพแวดล้อมนี้ได้**

### ข้อสังเกตสำคัญที่อาจเป็นกับดัก (ต้องระวังก่อนสรุปสาเหตุ)
ตัวอักษรที่ปรากฏใน PDF ตัวอย่างที่แนบมา (ผ่านการ extract ข้อความตอนแนบไฟล์เข้าแชท) แสดง pattern การแทนที่ตัวอักษรไทยด้วยตัวอักษร Latin Extended-A **แบบสม่ำเสมอ ด้วยค่า offset คงที่เท่ากันทุกตัวคือ 0x0D0E (3342 decimal)**:
- ย (U+0E22) → Ĕ (U+0114)
- ข (U+0E02) → ô (U+00F4)
- พ (U+0E1E) → Đ (U+0110)
- ศ (U+0E28) → Ě (U+011A)
- ล (U+0E25) → ė (U+0117)
- ว (U+0E27) → ę (U+0119)

ทุกคู่ต่างกันเท่ากับ 0x0D0E พอดี — นี่คือลายเซ็นของปัญหาการ**แปลงกลับเป็น Unicode ตอน extract ข้อความจาก PDF** (เช่น ToUnicode CMap ผิด หรือ pipeline ที่ดึงข้อความจากไฟล์แนบตีความผิด) **ไม่ใช่**ปัญหารูปทรง glyph ตอน render จริงบนหน้ากระดาษ (การวาด glyph ใช้ glyph ID ตรง ๆ ไม่ผ่านการแปลงกลับเป็น Unicode) ⇒ **สิ่งที่ผมเห็นจากไฟล์แนบอาจไม่ตรงกับสิ่งที่ผู้ใช้เห็นจริงตอนเปิดไฟล์ PDF ด้วยโปรแกรมอ่าน PDF ทั่วไป** จำเป็นต้องถามผู้ใช้ให้ชัดเจนก่อนว่าอาการที่เจอจริงคืออะไรกันแน่

### สถานะ pagination ปัจจุบัน (ไม่ใช่จุดที่ต้องแก้รอบนี้ แต่บันทึกไว้)
- `CREDIT_NOTE_ROWS_PER_PAGE = 15` (`app/credit_note.py:102`) ใช้ helper กลาง `_paginate_credit_note_rows` แล้วตามแผนเดิม (ไม่มี ITEMS_PER_PAGE=10 ซ้ำสองจุดอีกต่อไป)
- Pagination ยังนับแถวคงที่ ไม่ได้วัดความสูงจริง (ถ้า "รายละเอียด" ยาวจน wrap หลายบรรทัด แถวจะสูงกว่าที่คำนวณไว้) แต่ `.A4-page main { overflow: hidden; }` จะ "ตัดทิ้ง" เนื้อหาส่วนเกิน ไม่ใช่ทำให้ดู "บีบอัด" — จึงไม่น่าจะเป็นคำอธิบายของอาการ "บีบอัด" ที่ผู้ใช้รายงานรอบนี้

### คำตอบจากผู้ใช้ (ยืนยันแล้ว)
1. อาการที่เห็นจริงตอนเปิด PDF: "ตัวอักษรไทยยังพอเป็นไทยอยู่ แต่ทับ/ชิดกันแน่นจนอ่านยาก" — ยืนยันว่าเป็นปัญหา**การจัดวาง glyph จริงตอน render** ไม่ใช่แค่ปัญหา extract ข้อความ (ข้อสังเกตเรื่อง constant-offset ในข้อ 4 ด้านบนยังคงเป็นปัญหาแยกต่างหากของ ToUnicode/extraction แต่ "รอบนี้" โฟกัสที่อาการภาพจริงที่ผู้ใช้ยืนยัน)
2. ไฟล์ตัวอย่างที่แนบ export จาก build ล่าสุดหลังโค้ดเปลี่ยนวันนี้ (หลัง commit ที่เพิ่ม @font-face) — ยืนยันว่านี่คือ regression จากการเปิดใช้ไฟล์ฟอนต์ที่เพิ่งประกาศ ไม่ใช่ของเก่าที่ค้างอยู่
3. ทิศทางแก้: คงหน้าตา "TH Sarabun New" ไว้ แต่ต้องหาไฟล์ฟอนต์ที่ยืนยันว่าใช้ได้จริงมาแทนไฟล์เดิม
4. ยืนยัน: หน้า `credit_note_form.html` (UI ฟอร์มบนจอ) ให้ใช้ Noto Sans Thai เหมือนหน้าอื่นทั้งหมด ส่วน "TH Sarabun New" ใช้เฉพาะเอกสาร/พรีวิวที่จะพิมพ์/PDF เท่านั้น

### ยืนยันสาเหตุที่แท้จริงของ PDF ตัวอักษรบีบอัด/ทับกัน (ตรวจสอบด้วย fontTools จริง ไม่ใช่การเดา)
ตรวจ `app/static/fonts/THSarabunNew.ttf` (ไฟล์ที่ @font-face อ้างถึงตอนนี้) ลึกกว่ารอบแรก พบสาเหตุตรงจุด:
- **`GDEF.GlyphClassDef` ไม่มีข้อมูลเลย** — สระ/วรรณยุกต์ผสม (sara i, sara u, mai ek, mai tho ฯลฯ) ไม่ได้ถูกจัดเป็น "mark" (class 3) แม้แต่ตัวเดียว
- **`GPOS` มีแค่ feature `kern`** (lookup type 2) เท่านั้น — **ไม่มี `mark`/`mkmk` feature และไม่มี MarkToBase (type 4) / MarkToMark (type 6) lookup ใด ๆ เลย**
- สระ/วรรณยุกต์ผสมใช้เทคนิคเก่า "negative left-side-bearing" (เช่น sara i U+0E34: advanceWidth=0, lsb=-345 จาก unitsPerEm=1000) เพื่อให้ตัวเองไปเกยตำแหน่งขวาของฐานพยัญชนะโดยไม่พึ่ง GPOS
- นี่คือดีไซน์ฟอนต์ไทยแบบเก่า (ยุค GDI/Uniscribe) ซึ่ง**ใช้ได้ปกติบน Windows** (ตัว renderer เดิมมี special-case ให้) **แต่เป็นปัญหาที่รู้จักกันดีบน Pango/HarfBuzz** (ที่ WeasyPrint ใช้) — เมื่อไม่มีข้อมูล GDEF/GPOS ให้ HarfBuzz ใช้ fallback mark-positioning เข้ามาช่วยจัดตำแหน่งซ้ำ ทำให้ตำแหน่งเพี้ยนซ้อนทับกับตัวอื่น ตรงกับอาการ "ตัวอักษรไทยยังพอเป็นไทยอยู่ แต่ทับ/ชิดกันแน่น" ที่ผู้ใช้ยืนยัน
- Web search ยืนยันว่าฟอนต์ตระกูล "TH Sarabun New" (สายที่แจกจาก f0nt.com เป็นไฟล์แบบเก่า) เป็นที่รู้จักว่ามีปัญหานี้บน Linux/Ubuntu โดยเฉพาะ (มี repo `inwdragon/thsn-for-ubuntu` แก้ปัญหาการติดตั้งบน Ubuntu โดยเฉพาะ) — สอดคล้องกับสาเหตุที่พบ

### ฟอนต์ทดแทนที่ตรวจสอบแล้วว่าใช้ได้ (แหล่งที่มาชัดเจน มี license)
Google Fonts มีตระกูล **"Sarabun"** ซึ่งหน้า specimen ระบุตรงว่า "known as TH Sarabun New" ปล่อยภายใต้ OFL (Open Font License) ดาวน์โหลดต้นทางจาก `github.com/google/fonts` (`ofl/sarabun/Sarabun-{Regular,Bold,Italic,BoldItalic}.ttf`) แล้วตรวจด้วย fontTools:
- ครบทั้ง `mark` และ `mkmk` ใน GPOS (lookup type 4 และ 6) ทุกน้ำหนัก
- `GDEF.GlyphClassDef` จัดสระ/วรรณยุกต์ผสมเป็น class 3 (mark) ถูกต้องครบทุกตัวที่ตรวจ
- cmap ครอบคลุม 725 ตัวอักษร (มากกว่าไฟล์เดิมที่ 504) รวมทั้งไทยและ ASCII/ตัวเลข/เครื่องหมาย `/` ในไฟล์เดียวกัน (พอสำหรับเลขที่เอกสาร/วันที่ที่ผสมกับข้อความไทย)

**ข้อจำกัดที่ต้องแจ้งไว้ก่อนเสมอ:** ยังไม่มีทางเรนเดอร์ WeasyPrint จริงในเครื่องนี้เพื่อดูผลด้วยตา (เหตุผลข้อ 10 ด้านบน) การตรวจสอบทั้งหมดทำได้แค่ระดับโครงสร้างของไฟล์ฟอนต์ (fontTools) ซึ่งพิสูจน์ได้ว่า "ความสามารถที่ขาดหายไปจนทำให้เกิดบั๊ก" ตอนนี้มีครบแล้วในไฟล์ทดแทน แต่ยังไม่ใช่การยืนยันภาพสุดท้าย 100% — ต้อง deploy/build จริงแล้วลอง export PDF อีกครั้งเพื่อยืนยัน

### แผน implementation รอบนี้
1. แทนที่เนื้อไฟล์ `app/static/fonts/THSarabunNew.ttf`, `THSarabunNew Bold.ttf`, `THSarabunNew Italic.ttf`, `THSarabunNew BoldItalic.ttf` ด้วยไฟล์ Sarabun ที่ตรวจสอบแล้ว (ชื่อไฟล์เดิม ไม่ต้องแก้ path ใน `@font-face` เลย)
2. เพิ่มไฟล์ license `OFL.txt` ของ Sarabun ไว้คู่กับฟอนต์ (ข้อกำหนดของ Open Font License เวลาแจกจ่ายไฟล์ฟอนต์ต่อ)
3. แก้ `credit_note.css`: เอา `"TH Sarabun New"` ออกจากกฎ `body {...}` ที่ไม่ scope (ให้เหลือ `"Noto Sans Thai", sans-serif` เหมือน `bill_note.css`) แล้วย้ายไปประกาศใน `.credit-note, .credit-note *` (บล็อกที่มีอยู่แล้วสำหรับ reset letter-spacing) แทน — ทำให้ TH Sarabun New มีผลเฉพาะตัวเอกสาร (ทั้งตอน preview บนจอและตอน export PDF) ส่วน UI ฟอร์มด้านนอกใช้ Noto Sans Thai เหมือนหน้าอื่น
4. **ไม่แตะ** `bill_note.css`/invoice pipeline (นอกขอบเขตที่ผู้ใช้ระบุไว้ว่าให้แก้เฉพาะ credit_note)
5. **ความเสี่ยงที่เหลือให้ผู้ใช้ช่วยตรวจหลัง deploy:** เดิม `--print-line-height: 1.12` และ `CREDIT_NOTE_ROWS_PER_PAGE = 15` ถูก tune ไว้ตอนที่ฟอนต์ยังพัง (ซึ่งทำให้บรรทัดดูเตี้ยลงผิดปกติเพราะสระ/วรรณยุกต์ซ้อนทับกันเอง) เมื่อเปลี่ยนไปใช้ฟอนต์ที่ mark-positioning ถูกต้อง ความสูงบรรทัดที่แสดงผลจริงอาจเพิ่มขึ้น (โดยเฉพาะคำที่มีวรรณยุกต์ซ้อน 2 ชั้น) — ค่า line-height 1.12 ที่ตึงมากอาจทำให้วรรณยุกต์ชนบรรทัดถัดไปได้แม้ฟอนต์จะถูกต้องแล้ว จุดนี้ยังไม่แก้ในรอบนี้ (นอกขอบเขตที่ยืนยัน) แต่ให้สังเกตหลัง export จริง ถ้ายังดูชิดเกินไปค่อยพิจารณาเพิ่ม line-height เป็นรอบถัดไป

### สถานะ: implement เสร็จแล้ว (ยังไม่ commit, รอผู้ใช้ทดสอบจริง)
- แทนที่ `app/static/fonts/THSarabunNew*.ttf` ทั้ง 4 ไฟล์ด้วย Google Fonts Sarabun (ชื่อไฟล์เดิม, ตรวจ GDEF/GPOS/cmap ผ่านแล้วที่ path ปลายทางจริง) + เพิ่ม `app/static/fonts/OFL.txt`
- แก้ `app/static/css/credit_note.css`: `body` เหลือ `"Noto Sans Thai", sans-serif` (ตัด TH Sarabun New ออก), ย้ายไปประกาศที่ `.credit-note, .credit-note *` แทน
- **ยังไม่ได้ยืนยันด้วยการ render จริง** (ข้อจำกัดข้อ 10) — ผู้ใช้ต้อง deploy/build แล้ว export PDF ซ้ำเพื่อยืนยันภาพจริง โดยเฉพาะจุดที่เคยมีวรรณยุกต์ซ้อน (เช่น "ทรายคัดขนาดพิเศษ") และเช็คว่าหน้าฟอร์ม `credit_note_form.html` ฟอนต์ตรงกับหน้าอื่นแล้ว
- **[อัปเดตรอบ 3] ผลจริง: การแก้รอบนี้ถูก commit เป็น `e887005` และ deploy แล้ว แต่ไม่มีผลใด ๆ ต่อ PDF — สาเหตุดูรอบ 3 ด้านล่าง (ไฟล์ฟอนต์ไม่เคยถูกโหลดเลยตั้งแต่แรก)**

## 2026-07-05 (รอบ 3) — พบ root cause ตัวจริง: `@font-face` ถูกทิ้งเงียบ ๆ เพราะไม่ส่ง `FontConfiguration`

### รายงานจากผู้ใช้
- Export PDF หลัง deploy รอบ 2 (`credit_note_SSCR14-3006_2569 (2).pdf`, 15:07) ตัวอักษรยังถูก condense เหมือนเดิมทุกประการ

### หลักฐานชี้ขาด: แกะ font dictionary จากไฟล์ PDF จริงทั้ง 4 ตัวอย่างใน Downloads
วิธี: decompress flate streams ในไฟล์ PDF แล้ว grep หา `/BaseFont`, `/FontFamily`, `/Producer` (ทำได้บนเครื่องนี้ ไม่ต้อง render)

| ไฟล์ | เวลา export | Producer | ฟอนต์ที่ฝังจริงใน PDF |
|---|---|---|---|
| credit_note_SSCR13-2906_2569.pdf | 09:49 | WeasyPrint 68.1 | **Laksaman** + Laksaman-Bold |
| credit_note_SSCR14-3006_2569.pdf | 09:49 | WeasyPrint 68.1 | **Laksaman** + Laksaman-Bold |
| ...(1).pdf (หลัง deploy รอบ 1) | 13:03 | WeasyPrint 69.0 | **Laksaman** + Laksaman-Bold |
| ...(2).pdf (หลัง deploy รอบ 2 / e887005) | 15:07 | WeasyPrint 69.0 | **Laksaman** + Laksaman-Bold |

ข้อสรุปจากตาราง:
- **ทุกไฟล์ ทุกรอบแก้ ฝังฟอนต์ Laksaman — ไม่เคยเป็น TH Sarabun New / Sarabun / Noto Sans Thai เลยสักครั้ง**
- Producer เปลี่ยน 68.1 → 69.0 ระหว่างวัน พิสูจน์ว่า Docker image ถูก rebuild จริง (ปัญหาไม่ใช่ deploy ค้าง/cache) และยังชี้ว่า requirements.txt ไม่ pin weasyprint ทำให้เวอร์ชันลอยเงียบ ๆ ทุก build

### กลไกของบั๊ก (ยืนยันจาก source code ของ WeasyPrint โดยตรง)
1. `app/credit_note.py` (บรรทัด ~438-441) เรียก `write_pdf(stylesheets=[CSS(filename=...)])` **โดยไม่ส่ง `font_config`**
2. จาก source WeasyPrint (ตรวจจาก 65.1 ใน venv เครื่องนี้; ตรรกะเดียวกันทุกรุ่นที่เกี่ยวข้อง):
   - `weasyprint/css/__init__.py:1047-1048`: `@font-face` จะถูกลงทะเบียน**ก็ต่อเมื่อ** `font_config is not None` — ไม่มีก็ข้ามเฉย ๆ ไม่มี error ไม่มี warning
   - `weasyprint/__init__.py:310-312`: `CSS()` parse stylesheet ทันทีตอนสร้าง object ⇒ @font-face ที่ถูกข้ามตอนนั้น หายถาวร ต่อให้ write_pdf จะสร้าง font config ภายในทีหลังก็ไม่ช่วย
   - docstring ของ class CSS เขียนตรง ๆ ว่า "An additional argument called ``font_config`` must be provided to handle ``@font-face`` rules"
3. เมื่อ @font-face ตาย → Pango/fontconfig ใน Docker มองหา family "TH Sarabun New" → ไม่มีฟอนต์ระบบชื่อนี้ → fontconfig substitution จับคู่ไปที่ **Laksaman** (ฟอนต์ TLWG ใน `fonts-thai-tlwg` ที่สืบสายมาจาก TH Sarabun และมี compat alias ฝั่ง tlwg) → Laksaman บน environment นี้ render สระ/วรรณยุกต์ทับ-ชิดกัน = อาการ "condensed" ที่ผู้ใช้เห็นมาตลอด
4. **นัยสำคัญ:** การแก้รอบ 1 (เพิ่ม @font-face + reset letter-spacing) และรอบ 2 (เปลี่ยนไฟล์ฟอนต์เป็น Sarabun ที่ตาราง GDEF/GPOS ถูกต้อง) เดินถูกทางแต่เป็น dead fix ทั้งคู่ — เพราะไฟล์ฟอนต์ไม่เคยถูก WeasyPrint เปิดอ่านเลยแม้แต่ครั้งเดียว

### แก้ข้อสันนิษฐานเดิมของรอบ 2 (บันทึกไว้กันเข้าใจผิดภายหลัง)
- ข้อสังเกต "ตัวอักษร extract เพี้ยนด้วย offset คงที่ 0x0D0E" ของรอบ 2 **ไม่ถูกต้องทั้งหมด**: ตรวจละเอียดพบ offset ต่างกันระหว่างข้อความ regular (0x0D0E เช่น ย→Ĕ, ข→ô) กับข้อความ bold (0x0D0F เช่น ช→û, ค→õ) และ mark บางตัว map แบบไม่เข้า pattern เลย (เช่น ใ→ı, ่→ǥ)
- คำอธิบายที่สอดคล้องกว่า: เป็น artifact ของ ToUnicode/subset ราย font subset (Laksaman-regular กับ Laksaman-Bold คนละ subset จึงคนละ offset) — ยืนยันเพิ่มว่าการ extract เพี้ยนเป็นปัญหาชั้น extraction แยกจากปัญหาภาพ แต่ทั้งสองอย่างมีต้นตอร่วมคือฟอนต์ fallback ที่ไม่ได้ตั้งใจใช้
- การที่ fingerprint การ extract ของไฟล์ (2) เหมือนไฟล์ (1) ทุกตัวอักษร คือสัญญาณแรกที่นำไปสู่การพบว่า embedded font ไม่เคยเปลี่ยน

### แผนแก้รอบ 3 (อนุมัติแล้ว)
1. `app/credit_note.py`: import `FontConfiguration` จาก `weasyprint.text.fonts` (มีจริง ยืนยันแล้วที่ `text/fonts.py:74`) แล้วส่ง `font_config` ตัวเดียวกันให้ทั้ง `CSS(...)` และ `write_pdf(...)` ใน `export_creditnote_pdf`
2. `requirements.txt`: pin `weasyprint==69.0` (เวอร์ชันที่รันบน production จริงตอนนี้ พิสูจน์จาก /Producer) — ผู้ใช้อนุมัติแล้ว
3. commit + push → Railway auto-deploy (ผู้ใช้ยืนยัน flow แล้ว)
4. Verify แบบพิสูจน์ได้: export ใหม่แล้วแกะ embedded font จากไฟล์ — ต้องเห็น `XXXXXX+Sarabun` แทน Laksaman; แล้วผู้ใช้ยืนยันภาพ (ผู้, ที่อยู่, จำกัด, สำนักงานใหญ่ ต้องไม่ทับกัน; 11 แถวยังอยู่ หน้า 1/1)
5. Watch item: metric ของ Sarabun ต่างจาก Laksaman — ถ้าแถวสุดท้ายถูก clip ค่อยปรับ `CREDIT_NOTE_ROWS_PER_PAGE`/line-height รอบถัดไป
- หมายเหตุ scope: `form.py:479-481` (invoice) มี pattern ไม่ส่ง font_config เหมือนกัน แต่ `invoice.css` ไม่มี @font-face จึงยังไม่กระทบ — จดไว้เผื่ออนาคต
