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