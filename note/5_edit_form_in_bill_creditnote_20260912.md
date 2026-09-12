# วิเคราะห์และแก้ไขฟอร์มใบวางบิล / ใบลดหนี้ — 12 กันยายน 2569

อ้างอิงคำสั่ง: `note/4_edit_villnote_creditnote.md`

เอกสารส่วนวิเคราะห์นี้จัดทำก่อนแก้ production code ตามข้อ 4 และมอบหมาย implementation ให้โมเดล **gpt-5.6-terra** (frontend) และ **gpt-5.6-sol** (backend) ตามข้อ 5

## ขอบเขตและสภาพเริ่มต้น

- ระบบ FastAPI + SQLAlchemy + Jinja2; หน้าเว็บใช้ JavaScript โดยตรง
- ใบวางบิลพิมพ์ผ่าน browser; ใบลดหนี้มี HTML preview และ export ผ่าน WeasyPrint
- working tree มีงานเดิมในหลายไฟล์ รวมถึง bill_note.js, credit_note.py, CSS และฟอนต์ เก็บ baseline ของไฟล์ที่เกี่ยวข้องไว้ใน temporary directory ก่อนแก้ และรักษาการแบ่งหน้า/รูปแบบเดิม
- ไม่มี AGENTS.md หรือ CONTEXT.md ที่เกี่ยวข้อง; อ่าน `app/.docs/arcitecture_ssincom_bill.md` ประกอบ
- ไม่จำเป็นต้องแก้ schema หรือข้อมูลในฐานข้อมูลจริง

## 1. ฟอนต์เพี้ยนเมื่อพิมพ์ครั้งแรก

### หลักฐานและ reproduction

`app/static/js/bill_note.js` ผูกปุ่มกับ `window.print()` ทันที ขณะที่ CSS ใช้ TH Sarabun New ภายใน `@media print`; การเปิดหน้าอย่างเดียวไม่ได้โหลดทุก font face สำหรับพิมพ์

สร้าง `tests/form_regressions.cjs` ใช้ Chromium จริง เสิร์ฟ template/CSS/font ของโปรเจกต์ผ่าน localhost และแทน API ด้วย fixture เพื่อไม่แตะฐานข้อมูล ตรวจสถานะ font face ณ เวลาที่เรียกพิมพ์ โดยจำลองการดาวน์โหลดฟอนต์ช้า

คำสั่งที่รันก่อนแก้ (ตั้ง PLAYWRIGHT_MODULE และ CHROME_EXECUTABLE ให้ชี้ runtime ที่ติดตั้งในเครื่องก่อน):

```text
node --test --test-name-pattern 'first bill' tests/form_regressions.cjs
FAIL: actual [false, false, false, false], expected [true, true, true, true]
```

จึงยืนยันได้ว่าปุ่มพิมพ์เรียกก่อน normal/bold/italic/bold-italic พร้อม การทดสอบนี้ตรวจเงื่อนไขที่ทำให้เกิด fallback; ไม่ได้เปิด dialog ของเครื่องพิมพ์จริง

### สมมติฐานเรียงลำดับและการตรวจ

1. ฟอนต์สำหรับ print ยังไม่โหลด: โหลด font face ที่ระบุชัดก่อนเรียกพิมพ์ แล้วผลต้องเปลี่ยนเป็นพร้อมทุก face
2. PDF ใบลดหนี้ไม่ได้ใช้ FontConfiguration ร่วมกัน: โค้ดปัจจุบันส่ง `CSS(filename=...)` โดยไม่มี font_config ทั้งที่ CSS มี @font-face; ต้องตรวจด้วย PDF generation seam และใส่ object เดียวกันให้ CSS/write_pdf
3. ไฟล์ฟอนต์เสียหรือ URL ผิด: โหลดไฟล์จริงทุกแบบใน browser; ต้องไม่มี font/network error
4. CSS overriding ใช้ฟอนต์อื่น: ตรวจ computed style ใน print media และเปรียบเทียบครั้งแรก/ครั้งถัดไป

### แนวแก้

- เรียก document.fonts.load โดยระบุ TH Sarabun New ทั้งสี่รูปแบบ แล้วรอ document.fonts.ready ก่อน window.print
- เตรียมฟอนต์ล่วงหน้าที่หน้าใบวางบิล/ใบลดหนี้สำหรับ browser preview/print; ปุ่มพิมพ์ต้องไม่เปิด dialog เมื่อโหลดไม่สำเร็จและควรให้ลองใหม่ได้
- คืนการใช้ FontConfiguration object เดียวกันใน WeasyPrint CSS และ write_pdf สำหรับใบลดหนี้ โดยไม่เปลี่ยนการแบ่งหน้า

## 2. ชื่อลูกค้าไม่รวม products.customer_list.prename

### หลักฐาน

- `/api/customers/all` ที่ทำงานจริงมาจาก `customers.py` (ถูก include ก่อน route ชื่อซ้ำใน `bill_note.py`) ส่ง prename และ customer_name แล้ว แต่ datalist และ label หลังเลือกไม่ได้รวม prename
- ใบลดหนี้ `/api/customers/suggest-name`, `/by-personid`, `/by-name` ยังอ้าง fname อย่างเดียว
- context ของใบลดหนี้ทั้งหน้าพรีวิว, payload preview/PDF, โหลดเอกสารเดิม และข้อมูล GRN มีจุดที่ใช้ buyer.fname/c.fname โดยไม่เติม prename

ผลทดสอบก่อนแก้:

```text
bill customer label: actual 'PC001 | ทดสอบ จำกัด'; expected 'PC001 | บริษัท ทดสอบ จำกัด'
credit customer field: actual 'ทดสอบ จำกัด'; expected 'บริษัท ทดสอบ จำกัด'
```

### แนวแก้

- ใช้ชื่อแสดงผลจาก prename + fname พร้อม trim, รองรับ null/ว่าง และไม่เติมซ้ำเมื่อชื่อมีคำนำหน้าอยู่แล้ว
- ให้ชื่อแสดงผลสอดคล้องกันในคำแนะนำ การเลือกด้วยรหัส/ชื่อ ฟอร์ม โหลดเอกสารเดิม และเอกสารที่แสดง/พิมพ์
- API ค้นหาด้วยชื่อต้องยังรับ fname เดิมได้ พร้อมรองรับชื่อเต็มที่แนะนำใหม่ ไม่แก้ค่า fname ในทะเบียนลูกค้า
- คงการอ้างอิง idx/personid เพื่อไม่ให้การเพิ่มคำนำหน้าทำให้เลือกลูกค้าผิด

## 3. ใช้ตัวเลือกวันที่ไทยมาตรฐานเดียวกัน

### หลักฐาน

- ใบวางบิลมี 5 ช่อง: billDate, startDate, endDate, searchStartDate, searchEndDate
- ใบลดหนี้มี 3 ช่อง: cn_date, searchStartDate, searchEndDate
- ทั้งหมดใช้ native date input และยังไม่ได้โหลด ThaiDatePicker
- `thai_custom_date.js` ต้องใช้ Flatpickr และ locale th; onReady เดิมแก้ปีปฏิทินแต่ไม่แก้ค่า altInput เริ่มต้น และ setDate(..., false) ต้องปรับข้อความ พ.ศ. เอง
- ใบวางบิล saveBillNote ส่งวันที่วันนี้แทนวันที่ผู้ใช้เลือก; ค่าเริ่มต้นใช้ toISOString ซึ่งอาจเลื่อนวันใน timezone ไทย

ผลก่อนแก้:

```text
billDate missing picker: false !== true
saved bill_date: actual '2026-09-12'; expected selected date '2026-08-15'
```

### แนวแก้

- โหลด Flatpickr + Thai locale + thai_custom_date.js ตามลำดับ และใช้ wrapper กับทั้ง 8 ช่อง
- แสดงวันที่/ปีเป็นภาษาไทย พ.ศ. แต่ค่า input และ API ยังคง `YYYY-MM-DD` ค.ศ.
- อัปเดต picker ด้วย setDate เมื่อเปิดเอกสารเดิม/สร้างใหม่/reset; ทั้งค่าจริงและข้อความแสดงต้องตรงกัน
- แก้ defaultDate/onReady/setDate silent ให้แสดง พ.ศ. ตั้งแต่ครั้งแรก และคงตัวเลือกไทยบนมือถือ
- บันทึก/อัปเดตใบวางบิลด้วยวันที่เลือกและคำนวณวันที่ปัจจุบันจากเวลาท้องถิ่น

## แผนตรวจรับ

1. ทดสอบ Chromium: ครั้งแรกที่ยังไม่มี font cache และพิมพ์ซ้ำ, โหลดฟอนต์ล้มเหลวแล้วลองใหม่, print computed font
2. ตรวจชื่อลูกค้าคำนำหน้าปกติ/ว่าง/มีอยู่ในชื่อแล้ว และการเลือกด้วยรหัส/ชื่อ
3. ตรวจวันที่ทั้ง 8 ช่อง ค่าเริ่มต้น พ.ศ., การเปลี่ยนเดือน/ปี, เปิดเอกสารเดิม/reset, ค่าที่ส่งใน create/update/search
4. ตรวจ Python customer/context/PDF seams ด้วยฐานข้อมูลจำลอง ไม่เขียนข้อมูลจริง; ตรวจ syntax ทุกไฟล์ที่แก้
5. ตรวจ diff เทียบ baseline เพื่อรักษางานเดิม และ review ตามข้อกำหนด/มาตรฐานก่อนสรุป

## แหล่งอ้างอิงทางเทคนิค

- [MDN: CSS Font Loading API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Font_Loading_API)
- [WeasyPrint: FontConfiguration สำหรับ @font-face](https://doc.courtbouillon.org/weasyprint/latest/first_steps.html)
- [Flatpickr: altInput และ disableMobile](https://flatpickr.js.org/options/)
- [Flatpickr: ค่าแสดงผลและค่าที่ส่ง server](https://flatpickr.js.org/examples/)

## ผลหลัง implementation

ดำเนินการครบทั้งสามหัวข้อแล้ว โดยเก็บส่วนวิเคราะห์ด้านบนไว้ และเพิ่มผลตรวจจริงในส่วนนี้

### สิ่งที่แก้

- เพิ่ม `app/static/js/thai_print_fonts.js` เป็นตัวเตรียมฟอนต์กลาง: โหลด normal/bold/italic/bold-italic, จำกัดเวลารอ 10 วินาที, สร้าง font face ใหม่พร้อม URL ที่ไม่ซ้ำเมื่อต้องลองใหม่ และเก็บชุดที่โหลดสำเร็จไว้ใช้ต่อ ทั้งใบวางบิลและหน้า Preview ใบลดหนี้ใช้ helper เดียวกัน
- ใบวางบิลรอฟอนต์ก่อนเรียกพิมพ์; ใบลดหนี้รอฟอนต์ก่อนแสดง HTML preview ส่วน export PDF ใช้ FontConfiguration เดียวกันใน CSS และ write_pdf
- เพิ่มคำนำหน้าจาก customer master ในตัวเลือกลูกค้า ฟอร์ม โหลดเอกสารเดิม GRN ผลค้นหา และบริบทสร้างเอกสาร โดยยังรับชื่อเดิมที่ไม่มีคำนำหน้าได้ ไม่แก้ข้อมูล fname ในฐานข้อมูล
- ใช้ Flatpickr 4.6.13 + locale ไทย + thai_custom_date.js ครบ 8 ช่อง; ค่าเริ่มต้น/ตั้งวันที่แบบ silent/เปิดเอกสารเดิม/สร้างใหม่แสดง พ.ศ. ถูกต้อง แต่ส่ง API เป็น ค.ศ.
- ใช้วันที่ท้องถิ่นและวันที่ที่เลือกจริงในการบันทึกใบวางบิล; คงช่วงวันที่ค้นหาเริ่มต้นเป็นค่าว่างตามเดิม
- ใช้ปฏิทินไทยบนมือถือ และซ่อนปุ่มหมุนปีที่อาจตีความ พ.ศ. เป็น ค.ศ.; การเลื่อนเดือนข้ามปียังทำงาน
- ตรวจ diff เทียบ baseline และตรวจ hash ยืนยันว่า CSS ใบวางบิล/ใบลดหนี้และ credit_note.html ไม่เปลี่ยนจากงานเดิม

### ผลทดสอบสุดท้าย

| ชุดตรวจ | ผล |
|---|---|
| `node --test tests/form_regressions.cjs` | ผ่าน 14/14 |
| `python -m unittest discover -s tests -p 'test_*.py' -v` | ผ่าน 7/7 |
| Syntax JavaScript ทั้ง 4 ไฟล์ที่แก้ | ผ่าน |
| Syntax Python ที่แก้และไฟล์ทดสอบ | ผ่าน |
| Review เทียบข้อกำหนด | ไม่มีประเด็นค้าง |
| Review มาตรฐาน/ข้อผิดพลาดของโค้ด | ไม่มีประเด็นค้าง |

รวม regression tests **21/21 ผ่าน** ครอบคลุม font cache ว่าง, พิมพ์ซ้ำ, โหลดฟอนต์ล้มเหลวแล้วลองใหม่ทั้งสองฟอร์ม, ปฏิทินไทย/มือถือ, เวลาไทยหลังเที่ยงคืน, การโหลด/รีเซ็ตเอกสาร, ชื่อลูกค้าหลายรูปแบบ, ค้นหาชื่อเดิม, ช่องข้อมูลลูกค้าที่เป็น null และการส่ง FontConfiguration ไปสร้าง PDF

ระหว่าง review พบและแก้เพิ่มสองจุด: ข้อมูลที่อยู่/เลขผู้เสียภาษีที่ไม่มีค่าให้แสดงว่างแทน None และการลองใหม่ของ Preview ใบลดหนี้ให้ใช้ระบบกู้การโหลดฟอนต์ร่วมกับใบวางบิล

### วิธีรันซ้ำและข้อจำกัด

ดู `tests/README.md` สำหรับ dependencies และตัวแปร `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE`, `FLATPICKR_DIR` ที่ใช้กับ browser suite การตรวจรอบนี้ใช้ Chromium และ dependencies ใน temporary directory; ไม่เปลี่ยน requirements ของโปรเจกต์

- Browser tests ใช้ template, JavaScript, CSS และไฟล์ฟอนต์จริง แต่แทน API ด้วย fixture และดัก window.print เพื่อตรวจ font face ณ เวลาที่เปิดพิมพ์
- Backend tests ใช้ endpoint/model จริงกับ SQLite ในหน่วยความจำ และตรวจข้อมูล HTML ทั้งต้นฉบับ/สำเนา; แทนเฉพาะ native WeasyPrint renderer ด้วย mock เพื่อตรวจ FontConfiguration
- **ยังไม่ได้ทดสอบ dialog/เครื่องพิมพ์จริง หรือ render PDF ด้วย native WeasyPrint ในเครื่องนี้** จึงไม่อ้างว่าตรวจรูปลักษณ์ PDF สุดท้ายหรือกระดาษที่พิมพ์แล้ว
- ไม่ได้เชื่อมต่อหรือเขียนข้อมูลฐานข้อมูล production และไม่ได้ deploy
---

## วิเคราะห์เพิ่มเติม: ปุ่มบันทึกใบลดหนี้หาย — 12 กันยายน 2569

คำขอรอบนี้: นำปุ่มบันทึกใน credit_note กลับมา โดยวิเคราะห์และเพิ่มบันทึกในไฟล์นี้ก่อน implement ด้วย Terra หรือ Sol

### จุดเริ่มต้นและหลักฐานก่อนแก้

- จุดอ้างอิงของงานรอบนี้คือ commit `16b6840` (`edit billnote creditnote datetime v.20260912.1`); working tree สะอาดก่อนเริ่มตรวจ
- ปุ่ม `btnSave` ยังอยู่ใน `app/templates/credit_note_form.html` และมองเห็นได้เมื่อเปิดฟอร์มใหม่ จึงไม่ใช่ปุ่มถูกลบออกจาก template
- ใน `credit_note.js` หลัง `POST /api/credit-notes` สำเร็จ โค้ดสั่ง `btnSave.classList.add('hidden')` แต่ไม่ตั้ง currentEditingCreditNoteNumber และไม่แสดงปุ่มบันทึกต่อหรือสร้างใหม่
- ตอนเปิดเอกสารเดิม โค้ดซ่อน Save และแสดงปุ่ม Update แทน ผู้ใช้จึงไม่พบปุ่มชื่อบันทึกในโหมดนี้ด้วย
- การกดแท็บสร้างไม่เรียก resetForm จึงไม่ได้ทำให้ปุ่มบันทึกกลับมาในสถานะที่หายหลัง POST
- ชุดทดสอบเดิมเน้นฟอนต์/ชื่อ/วันที่ ไม่ได้ตรวจสถานะปุ่มหลังบันทึก และ stub CDN ของ Tailwind ไว้ รอบนี้เพิ่มกฎ `.hidden { display:none; }` ให้ harness เพื่อตรวจการมองเห็นตามจริง

คำสั่ง reproduction ที่รันก่อนแก้ production:

```text
node --test --test-name-pattern 'credit Save' tests/form_regressions.cjs
FAIL: Save disappeared after the first successful save (false !== true)
FAIL: Save disappeared when opening a saved document (false !== true)
Tests: 2, pass: 0, fail: 2
```

ทดสอบใน Chromium ด้วย template/JavaScript จริงและ API fixture ไม่แตะข้อมูลจริง

### สมมติฐานและข้อสรุป

1. ปุ่มถูกลบหรือเริ่มต้น hidden ใน template: ตัดออก เพราะพบ btnSave และตรวจว่ามองเห็นได้ตอนเปิดหน้าใหม่
2. JavaScript เปลี่ยนสถานะหลังบันทึกแล้วไม่คืนปุ่ม: ยืนยันด้วยการกด Save จริงและจำลอง POST สำเร็จ
3. เปิดเอกสารเก่าแล้วปุ่มเปลี่ยนไปเป็น Update: ยืนยันใน flow ค้นหาและเปิดเอกสารจริง

สาเหตุที่แก้คือการจัดการสถานะปุ่ม ไม่ใช่ฟอนต์หรือปฏิทินไทย จึงไม่เปลี่ยนส่วนที่ตรวจผ่านจากรอบก่อน

### แนวทางแก้ที่เลือกก่อน implement

เพื่อให้ตรงกับคำขอให้นำปุ่ม **บันทึก** กลับมา จะคงปุ่มหลัก `btnSave` ให้มองเห็นและใช้ได้ทั้งเอกสารใหม่และเอกสารเดิม:

- เอกสารใหม่: แสดง “บันทึก” และส่ง POST
- หลังบันทึกสำเร็จหรือเปิดเอกสารเก่า: แสดง “บันทึกการแก้ไข”, เก็บเลขเอกสารเดิม, ส่ง PUT ไปที่ `/api/credit-notes/update?no=...` และแสดง “สร้างใหม่”
- ใช้ปุ่มหลักเดียวแทน Save/Update สองปุ่ม เพื่อไม่ให้เกิดคำสั่งซ้ำซ้อน
- กดสร้างใหม่: ล้างเลขเอกสาร/สถานะการแก้ไข กลับไปใช้ POST สำหรับเอกสารถัดไป
- ระหว่างบันทึก: ปิดการกดซ้ำชั่วคราว; เมื่อ API/เครือข่ายล้มเหลวให้ปุ่มกลับมาใช้ได้และเก็บข้อมูลในฟอร์มเพื่อแก้ไขหรือลองใหม่
- ป้องกันการสร้างเลขใหม่ระหว่างแก้เอกสารเดิม เพื่อให้เลขที่เห็นและเอกสารที่ PUT แก้ไขตรงกัน

พบ contract ที่เกี่ยวข้อง: buildPayload ส่ง `quantity` แต่ backend PUT อ่าน `sum_quantity` หากเพิ่มทางบันทึกต่อโดยไม่ปรับจะทำให้จำนวนกลายเป็น 0 จึงให้ adapter ฝั่ง JavaScript ส่ง `sum_quantity` จาก `quantity` เฉพาะคำขอ PUT โดยคง POST/PDF และ backend เดิมไว้

ผู้ implement production ในรอบนี้: **gpt-5.6-sol** หลังเขียนส่วนวิเคราะห์นี้เสร็จ Root ดูแล reproduction, tests และ review

### แผนตรวจรับรอบปุ่มบันทึก

- เปิดฟอร์มใหม่แล้วเห็น Save
- POST สำเร็จแล้วปุ่มบันทึกยังอยู่และสร้างเอกสารถัดไปได้
- บันทึกครั้งถัดไปใช้ PUT และไม่สร้างเอกสารซ้ำ; จำนวนสินค้าไม่หาย
- ค้นหา/เปิดเอกสารเดิมแล้วเห็นปุ่มบันทึกการแก้ไข
- API ตอบ error/เครือข่ายล้มเหลวแล้วปุ่มยังใช้งานต่อได้
- กดซ้ำระหว่างรอส่งคำขอเพียงครั้งเดียว
- รันชุด regression เดิมเพื่อเช็กฟอนต์/ปฏิทิน/ชื่อลูกค้า และ review diff เทียบ commit เริ่มต้น

### ผลหลังแก้ปุ่มบันทึก

การแก้หลักทำโดย Sol ใน `app/static/js/credit_note.js` และ `app/templates/credit_note_form.html`: ใช้ปุ่ม Save เดียวซึ่งเปลี่ยนข้อความตามโหมดเอกสาร, เก็บเลขหลัง POST สำเร็จ, ส่ง PUT เมื่อบันทึกต่อ, คืนปุ่มเมื่อเกิดข้อผิดพลาด และส่ง sum_quantity เฉพาะ PUT

### ประเด็นที่พบระหว่าง review และแก้ต่อ

หลังชุดทดสอบแรกผ่าน 18 browser + 7 backend การ review พบกรณีคำขอซ้อนกันที่อาจทำให้เลขเอกสารกับข้อมูลบนหน้าจอไม่ตรงกัน:

1. ระหว่างรอ POST เอกสาร A ผู้ใช้ยังเปิดเอกสาร B จากการค้นหาได้ เมื่อ POST A เสร็จ currentEditingCreditNoteNumber จะกลับเป็น A แต่ฟอร์มแสดง B การกด Save ครั้งถัดไปจึงอาจเขียนข้อมูล B ทับ A; reviewer ยืนยันด้วย Chromium reproduction ว่า displayed = CNTEST แต่ persisted = CN-A
2. คำขอสร้างเลขเอกสารที่เริ่มก่อน Save อาจตอบกลับภายหลัง แล้วเปลี่ยนเลขบนฟอร์มขณะที่สถานะแก้ไขยึดเลขที่บันทึกแล้ว

ให้ Sol แก้การควบคุมคำขอร่วมกันสำหรับบันทึก/โหลดเอกสาร/สร้างเลข เพื่อไม่ให้เริ่มงานที่เปลี่ยนเอกสารซ้อนกัน และคืนสถานะปุ่มใน finally ทั้งเมื่อสำเร็จและล้มเหลว เพิ่ม regression สำหรับแท็บค้นหาระหว่างรอบันทึก และคำขอโหลด/สร้างเลขที่ยังไม่เสร็จ รวม HTTP/network error ของทั้งสองกรณี

### ผลตรวจรับสุดท้ายของรอบปุ่มบันทึก

| ชุดตรวจ | ผล |
|---|---|
| `node --test tests/form_regressions.cjs` | ผ่าน 19/19 |
| `python -m unittest discover -s tests -p 'test_*.py' -v` | ผ่าน 7/7 |
| JavaScript syntax และ `git diff --check` | ผ่าน |
| Review เทียบข้อกำหนดและ API contract | ไม่มีประเด็นค้าง |
| Review มาตรฐานและข้อผิดพลาดของโค้ด | ไม่มีประเด็นค้าง |

รวม regression tests **26/26 ผ่าน** หลังแก้รอบนี้ ปุ่มบันทึกยังแสดงหลังสร้างและเมื่อเปิดเอกสารเดิม การบันทึกต่อใช้ PUT ไปยังเลขเดิมพร้อมจำนวนสินค้าที่ถูกต้อง และสร้างใหม่กลับไปใช้ POST ได้

ชุดทดสอบเพิ่มจากรอบก่อนครอบคลุม HTTP/network failure ทั้ง POST/PUT, การกดบันทึกซ้ำ, การสลับแท็บระหว่างรอบันทึก และการโหลดเอกสาร/สร้างเลขที่ยังไม่เสร็จ ทั้งผลสำเร็จและข้อผิดพลาด หลังจบคำขอปุ่มกลับมาใช้งานได้ตามโหมดเอกสาร

ไฟล์ production ที่เปลี่ยนในรอบนี้มีเฉพาะ `app/static/js/credit_note.js` และ `app/templates/credit_note_form.html`; เพิ่มการทดสอบใน `tests/form_regressions.cjs` และคำอธิบายใน `tests/README.md`

ผลนี้เป็นการตรวจใน Chromium กับ API fixture และ backend tests กับฐานข้อมูลในหน่วยความจำตามวิธีที่บันทึกไว้ด้านบน ยังไม่ได้เชื่อมต่อฐานข้อมูลจริงหรือ deploy
