# สถาปัตยกรรมระบบ ssincom_bill (System Architecture)

โปรเจค: **ssincom_dev_test** — ระบบออกเอกสารขายของ บริษัท เอส แอนด์ เอส อินคอม จำกัด
จัดทำ: 5 กรกฎาคม 2569 (2026-07-05)

---

## สารบัญ

1. [ภาพรวมระบบ (System Overview)](#1-ภาพรวมระบบ-system-overview)
2. [โครงสร้างโปรเจกต์ (Project Structure)](#2-โครงสร้างโปรเจกต์-project-structure)
3. [การเริ่มทำงานและการประกอบแอป (App Wiring)](#3-การเริ่มทำงานและการประกอบแอป-app-wiring)
4. [ระบบยืนยันตัวตนและ Session (Auth & Session)](#4-ระบบยืนยันตัวตนและ-session-auth--session)
5. [ฐานข้อมูล (Database)](#5-ฐานข้อมูล-database)
6. [Backend Modules ทั้ง 9 ตัว](#6-backend-modules-ทั้ง-9-ตัว)
7. [Frontend (Templates + JavaScript)](#7-frontend-templates--javascript)
8. [ระบบสร้าง PDF (PDF Pipeline)](#8-ระบบสร้าง-pdf-pdf-pipeline)
9. [Flow ความเชื่อมโยงแบบ End-to-End](#9-flow-ความเชื่อมโยงแบบ-end-to-end)
10. [การ Deploy](#10-การ-deploy)
11. [ข้อสังเกตสำคัญและจุดที่ควรระวัง](#11-ข้อสังเกตสำคัญและจุดที่ควรระวัง)

---

## 1. ภาพรวมระบบ (System Overview)

ระบบเว็บสำหรับออกและจัดการ **เอกสารการขาย** ครบวงจร ใช้งานภายในบริษัท (single-tenant)
เอกสารธุรกิจที่ระบบดูแลมี 4 ชนิด และเชื่อมโยงกันตามลำดับ:

```
ใบกำกับภาษี/ใบส่งสินค้า (Invoice)  ──รวมหลายใบ──▶  ใบวางบิล (Billing Note)
        │
        ├──อ้างอิงย้อนหลัง (ผ่าน GRN)──▶  ใบลดหนี้ (Credit Note)
        │
        └──สรุปยอดรายเดือน/ช่วงเวลา──▶  รายงานภาษีขาย (Sales Tax Report)
                                        รายงานสรุปใบกำกับ / รายงานต่อคนขับรถ
```

พร้อมข้อมูลหลัก (Master Data) ที่ป้อนให้เอกสารเหล่านี้: **ลูกค้า, สินค้า, ทะเบียนรถ, พนักงานขับรถ**
(ระบบเกี่ยวข้องกับการขนส่งสินค้า — ใบกำกับแต่ละใบผูกทะเบียนรถและคนขับได้)

### Tech Stack

| ชั้น (Layer) | เทคโนโลยี | หมายเหตุ |
|---|---|---|
| Web framework | FastAPI (Python 3.11) | ASGI, รันด้วย uvicorn |
| ORM / DB | SQLAlchemy 2.x style (`future=True`) + PostgreSQL | **ไม่มี Alembic** — ตารางต้องมีอยู่ก่อนใน DB (`create_all` ถูก comment ไว้) |
| Template engine | Jinja2 | ใช้ทั้ง render หน้าเว็บและ render เอกสาร PDF |
| PDF | WeasyPrint (+ pypdf สำหรับรวมไฟล์) | pdfkit/wkhtmltopdf ติดตั้งใน Docker แต่**ไม่ถูกเรียกใช้ในโค้ด** |
| Frontend | HTML + Vanilla JS (`fetch`) + Tailwind CSS (CDN) + Font Awesome (CDN) | ไม่มี build step / ไม่มี framework |
| Auth | Starlette `SessionMiddleware` (signed cookie ด้วย itsdangerous) | ผู้ใช้เดียว กำหนดผ่าน env |
| Deploy | Docker (`python:3.11-bookworm`) บน Railway | ฟอนต์ไทยติดตั้งใน image |

### ผังสถาปัตยกรรมรวม

```
                    ┌────────────────────────────────────────────────┐
                    │                Browser (ผู้ใช้)                 │
                    │  หน้า HTML + JS (fetch) — Tailwind/FontAwesome │
                    └──────────────────┬─────────────────────────────┘
                                       │ HTTP (JSON API + HTML pages)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        FastAPI  (app/main.py)                            │
│  SessionMiddleware (cookie 2 ชม.) · /static (mount) · Jinja2Templates    │
│                                                                          │
│  Routers (include ตามลำดับ ไม่มี prefix):                                │
│  form → summary_invoices → customers → products → cars →                 │
│  bill_note → saletax_report → drivers_form → credit_note                 │
└──────┬──────────────────────────────────────────┬────────────────────────┘
       │ SQLAlchemy ORM + raw SQL                 │ render Jinja2 template
       ▼                                          ▼
┌────────────────────────┐          ┌────────────────────────────────────┐
│  PostgreSQL            │          │  WeasyPrint (HTML+CSS → PDF)       │
│  5 schemas:            │          │  - invoice.html × 4 ชุด            │
│  ss_invoices, ss_bills │          │  - credit_note.html × 2 ชุด        │
│  credits, products,    │          │  + pypdf merge → ไฟล์เดียว         │
│  public                │          │  ฟอนต์ไทยจากระบบ (fonts-thai-tlwg)│
└────────────────────────┘          └────────────────────────────────────┘
```

---

## 2. โครงสร้างโปรเจกต์ (Project Structure)

```
ssincom_dev_test/
├── Dockerfile               # python:3.11-bookworm + ไลบรารี WeasyPrint + ฟอนต์ไทย + wkhtmltopdf
├── entrypoint.sh            # ตรวจ $PORT แล้ว exec uvicorn app.main:app (มี debug printenv)
├── Procfile                 # ทางเลือกแบบ buildpack: web: uvicorn app.main:app
├── requirements.txt         # fastapi, uvicorn, sqlalchemy, psycopg2-binary, jinja2,
│                            # weasyprint, python-multipart, itsdangerous, pypdf, pdfkit
├── .gitignore               # /fastapi
├── fastapi/                 # ❗ Python venv ในเครื่อง (ไม่ใช่โค้ดแอป, ถูก gitignore)
├── note/                    # บันทึก/รายงานประกอบโปรเจกต์ (1_refactor_uxuiV1.md, ...)
└── app/                     # ⭐ ตัวแอปทั้งหมด
    ├── main.py              # ประกอบแอป: middleware, login, dashboard, include routers, /export-pdf
    ├── database.py          # engine + SessionLocal + Base (อ่าน DATABASE_URL)
    ├── models.py            # ORM models 10 ตาราง (ยกเว้น credit_note ที่ประกาศ model เอง)
    ├── crud.py              # ⚠️ dead code — ไม่ถูก import จากที่ใด และอ้างคอลัมน์ที่ไม่มีจริง
    ├── pdf_generator.py     # helper PDF ตัวเก่า (ใช้เฉพาะ /export-pdf/{id}, เขียนลง /tmp)
    ├── test_script.py       # แอป FastAPI จิ๋วไว้ทดสอบ ไม่เกี่ยวกับ app.main
    │
    ├── form.py              # ใบกำกับภาษี: ฟอร์มสร้าง/แก้ไข + preview + export PDF 4 ชุด
    ├── summary_invoices.py  # รายงาน/ค้นหา/แก้ไขใบกำกับ (JSON API)
    ├── bill_note.py         # ใบวางบิล (สร้างเลข BNTS..., กันใบกำกับซ้ำข้ามใบวางบิล)
    ├── credit_note.py       # ใบลดหนี้ (ใหญ่สุด ~880 บรรทัด, ประกาศ model schema credits เอง)
    ├── customers.py         # ข้อมูลลูกค้า (CRUD + running number PC...)
    ├── products.py          # ข้อมูลสินค้า (CRUD)
    ├── cars.py              # ทะเบียนรถ (CRUD + lookup ยี่ห้อ/จังหวัด)
    ├── drivers_form.py      # พนักงานขับรถ (CRUD + รายงานยอดต่อคนขับ)
    ├── saletax_report.py    # รายงานภาษีขาย (JSON API)
    │
    ├── templates/           # Jinja2 templates 13 ไฟล์ (หน้าเว็บ + เอกสาร PDF)
    └── static/
        ├── css/             # style.css (global), form.css, invoice.css, bill_note.css,
        │                    # credit_note.css, saletax_report.css
        ├── js/              # JS 12 ไฟล์ จับคู่กับ template แต่ละหน้า
        ├── fonts/           # THSarabunNew*.ttf (⚠️ ไม่ถูกอ้างด้วย @font-face — ไม่ถูกใช้จริง)
        └── ss_logo.png      # โลโก้บริษัท
```

---

## 3. การเริ่มทำงานและการประกอบแอป (App Wiring)

### ลำดับการ start

1. Container รัน `entrypoint.sh` → `exec uvicorn app.main:app --host 0.0.0.0 --port $PORT` (default 8000)
2. `app/main.py` สร้าง `app = FastAPI()` ([main.py:24](../main.py#L24))
3. ติด `SessionMiddleware` — `secret_key` จาก env `SESSION_SECRET` (มี fallback hardcode), อายุ cookie 2 ชั่วโมง ([main.py:26-30](../main.py#L26-L30))
4. mount `/static` และสร้าง `Jinja2Templates` จาก `app/templates` ([main.py:33-35](../main.py#L33-L35))
5. ประกาศ route ของ main.py เอง (login/logout/dashboard/หน้า HTML บางหน้า)
6. `include_router` ทั้ง 9 ตัว **โดยไม่มี prefix/tags** ([main.py:66-74](../main.py#L66-L74))

> **หมายเหตุ:** `models.Base.metadata.create_all(...)` ถูก comment ไว้ ([main.py:25](../main.py#L25)) — แอปไม่สร้างตารางเอง ตารางทั้งหมดต้องถูกสร้างใน PostgreSQL ไว้ก่อน

### Route ที่ประกาศซ้ำกัน (Route Collisions)

เพราะทุก router ถูก include โดยไม่มี prefix จึงมี path ชนกันหลายจุด — **FastAPI ใช้ตัวที่ลงทะเบียนก่อน (first match wins)** โดย route ใน main.py มาก่อน แล้วตามด้วย router ตามลำดับ include:

| Path | ผู้ชนะ (ถูกใช้จริง) | ผู้แพ้ (ถูกบัง ไม่มีวันถูกเรียก) |
|---|---|---|
| `GET /customers` | main.py:93 (TemplateResponse) | customers.py:85 (FileResponse) |
| `GET /api/customers/all` | customers.py:94 (ส่ง dict เต็ม) | bill_note.py:85 (ส่งเฉพาะ idx/personid/fname/prename) |
| `GET /api/invoices/{id}/items` | form.py:251 | summary_invoices.py:268 |
| `GET /api/invoices/{id}/detail` | form.py:270 | summary_invoices.py:299 |
| `PUT /api/invoices/{id}` | form.py:346 | summary_invoices.py:352 |

ผลกระทบที่ควรรู้: โค้ดที่ "ดูเหมือน" ให้บริการ endpoint หนึ่งใน summary_invoices.py/bill_note.py แท้จริงไม่ถูกเรียกเลย — เวลาแก้บั๊กของ endpoint เหล่านี้ต้องแก้ที่ **ผู้ชนะ** เท่านั้น

### หน้าที่ของ main.py นอกจากประกอบแอป

| Route | หน้าที่ |
|---|---|
| `GET /login`, `POST /login`, `GET /logout` | ระบบ login (ดูหัวข้อ 4) |
| `GET /`, `/dashboard`, `/dashboard.html` | หน้า Dashboard (ศูนย์รวมเมนู — route เดียวที่เช็ค session) |
| `GET /summary_invoices.html`, `/car_numberplate.html`, `/customers`, `/drivers.html`, `/products`, `/bill_note.html`, `/saletax_report.html` | เสิร์ฟหน้า HTML ของโมดูลต่าง ๆ (ตัว template อยู่ใน `templates/`) |
| `GET /export-pdf/{invoice_id}` | export PDF เส้นทางเก่า ผ่าน `pdf_generator.py` (ดูหัวข้อ 8) |
| `GET /healthz` | health check → `{"ok": true}` |

---

## 4. ระบบยืนยันตัวตนและ Session (Auth & Session)

- **บัญชีผู้ใช้เดียว** — `POST /login` เทียบ `username/password` กับ env `APP_USER` / `APP_PASS`
  (ค่า default ในโค้ด: `admin` / `1234`) ไม่มีตารางผู้ใช้ ไม่มีการ hash รหัสผ่าน ([main.py:41-48](../main.py#L41-L48))
- Login สำเร็จ → เก็บ `{"name": username}` ลง session cookie (ลงลายเซ็นด้วย `SESSION_SECRET`, อายุ 2 ชม.) แล้ว redirect ไป `next` (default `/dashboard`)
- `GET /logout` → `session.clear()` → กลับหน้า login

**ขอบเขตการคุ้มครองที่แท้จริง (สำคัญมาก):**

| ส่วน | เช็ค login? |
|---|---|
| `/`, `/dashboard`, `/dashboard.html` | ✅ เช็ค (redirect ไป /login ถ้าไม่มี session) |
| หน้า HTML อื่นทุกหน้า (`/form`, `/bill_note.html`, `/customers`, ...) | ❌ ไม่เช็ค |
| `/api/...` ทุกเส้น (CRUD ทั้งหมด) | ❌ ไม่เช็ค |
| endpoint สร้าง PDF ทุกเส้น | ❌ ไม่เช็ค |

มีเพียง dashboard เท่านั้นที่ผ่าน login — API และหน้าอื่นเข้าถึงตรงได้โดยไม่ล็อกอิน (ดูหัวข้อ 11)

---

## 5. ฐานข้อมูล (Database)

### การเชื่อมต่อ ([database.py](../database.py))

- อ่าน connection string จาก env **`DATABASE_URL`**
- `_normalize_db_url()`: แปลง `postgres://` → `postgresql://` และ**เติม `sslmode=require` อัตโนมัติ** ยกเว้น host เป็น `*.railway.internal` (ออกแบบมาสำหรับ Railway)
- `engine` เปิด `pool_pre_ping=True` (กัน connection ตาย), `SessionLocal` แบบ `autoflush=False, autocommit=False`
- ทุก router สร้าง dependency `get_db()` ของตัวเอง (โค้ดซ้ำกันทุกไฟล์ — ดูหัวข้อ 11)

### ผังตารางทั้งหมด — 5 schemas / 12 ตาราง

```
schema: ss_invoices                          schema: ss_bills
┌─────────────────────────┐                 ┌──────────────────────────┐
│ invoices (หัวใบกำกับ)    │                 │ bill_note (หัวใบวางบิล)   │
│ PK idx (int)            │                 │ PK idx                   │
│ invoice_number (varchar)│◀─┐              │ billnote_number (unique) │
│ invoice_date, due_date  │  │              │ bill_date,               │
│ grn/dn/po_number        │  │              │ payment_duedate          │
│ snapshot ลูกค้า 9 ช่อง   │  │              │ snapshot ลูกค้า 8 ช่อง    │
│ car_numberplate         │  │              └───────────┬──────────────┘
│ FK driver_id ───────────┼──┼──▶ products.drivers      │ 1:N (ผูกด้วย billnote_number,
└───────────┬─────────────┘  │              ┌───────────▼──────────────┐  cascade delete-orphan)
            │ 1:N            │              │ bill_note_item           │
┌───────────▼─────────────┐  │              │ (snapshot ของใบกำกับ:    │
│ invoice_items           │  │              │  invoice_number,         │
│ PK idx                  │  │              │  invoice_date, due_date, │
│ invoice_number (varchar)│──┘ ⚠️ ค่าจริง    │  amount)                 │
│   FK → invoices.        │    ที่บันทึกคือ  └──────────────────────────┘
│   invoice_number        │    idx (ตัวเลข)!
│ cf_itemid/itemname      │                 schema: credits (ประกาศใน credit_note.py)
│ quantity, price, amount │                 ┌──────────────────────────┐
└─────────────────────────┘                 │ credit_note (หัวใบลดหนี้) │
                                            │ PK idx                   │
schema: products                            │ creditnote_number(unique)│
┌───────────────┐ ┌───────────────┐         │ created_at, updated_at   │
│ customer_list │ │ product_list  │         └───────────┬──────────────┘
│ (ลูกค้า)       │ │ (สินค้า)      │                     │ 1:N (FK creditnote_number)
│ personid,     │ │ cf_itemid,    │         ┌───────────▼──────────────┐
│ ชื่อ/ที่อยู่/    │ │ ชื่อ/หน่วย/    │         │ credit_note_item          │
│ taxid/สาขา/   │ │ ราคา/ลำดับ    │         │ grn_number,invoice_number│
│ เครดิต(วัน)    │ └───────────────┘         │ ราคาเดิม/ค่าปรับ(fine)/    │
└───────────────┘                           │ ราคาหลังปรับ, ยอดเดิม/ใหม่ │
┌───────────────┐ ┌───────────────┐         │ +vat +total, คนขับ/ทะเบียน│
│ ss_car        │ │ drivers       │         └──────────────────────────┘
│ (ทะเบียนรถ)    │ │ PK driver_id  │
│ number_plate  │ │ citizen_id,   │         schema: public (ตาราง lookup)
│ (unique),     │ │ ชื่อ-นามสกุล    │         ┌───────────┐ ┌─────────────────┐
│ ยี่ห้อ,จังหวัด   │ └───────────────┘         │ car_brand │ │ province_nostra │
└───────────────┘                           └───────────┘ └─────────────────┘
```

### รายละเอียดตาราง

| ตาราง (schema.table) | Model / ที่ประกาศ | คีย์และคอลัมน์สำคัญ | บทบาท |
|---|---|---|---|
| `ss_invoices.invoices` | `Invoice` ([models.py:8](../models.py#L8)) | PK `idx`; `invoice_number` (varchar, index); `invoice_date`, `due_date`, `fmlpaymentcreditday`; `grn_number`, `dn_number`, `po_number`; snapshot ลูกค้า (`fname`, `personid`, `tel`, `mobile`, `cf_personaddress`, `cf_personzipcode`, `cf_provincename`, `cf_taxid`, `cf_branch`); `car_numberplate`; FK `driver_id → products.drivers` | หัวใบกำกับภาษี |
| `ss_invoices.invoice_items` | `InvoiceItem` ([models.py:46](../models.py#L46)) | PK `idx`; `invoice_number` (varchar, FK → invoices.invoice_number ⚠️ ดู quirk); `cf_itemid`, `cf_itemname`, `cf_unitname`, `cf_itempricelevel_price` (ราคา/หน่วย), `quantity`, `amount`, `cf_items_ordinary` (ลำดับบรรทัด) | รายการสินค้าในใบกำกับ |
| `ss_bills.bill_note` | `BillNote` ([models.py:76](../models.py#L76)) | PK `idx`; `billnote_number` (unique); `bill_date`, `payment_duedate`; snapshot ลูกค้า | หัวใบวางบิล |
| `ss_bills.bill_note_item` | `BillNoteItem` ([models.py:103](../models.py#L103)) | PK `idx`; `billnote_number`; snapshot ใบกำกับ (`invoice_number`, `invoice_date`, `due_date`, `amount`) | ใบกำกับที่ถูกวางบิล (1 แถว = 1 ใบกำกับ) |
| `credits.credit_note` | `CreditNote` (**[credit_note.py:21](../credit_note.py#L21)** — ไม่อยู่ใน models.py) | PK `idx`; `creditnote_number` (unique); `created_at`, `updated_at` | หัวใบลดหนี้ |
| `credits.credit_note_item` | `CreditNoteItem` (**credit_note.py** เช่นกัน) | PK `idx`; FK `creditnote_number`; `grn_number`, `invoice_number`; `sum_quantity`, `cf_itempricelevel_price`, `fine` (ค่าปรับ/ส่วนลดต่อหน่วย), `price_after_fine`, ยอดเดิม/ใหม่ + vat + total; ข้อมูลคนขับ/ทะเบียนรถ | รายการลดหนี้ |
| `products.customer_list` | `CustomerList` ([models.py:118](../models.py#L118)) | PK `idx`; `personid` (รหัสลูกค้า เช่น PC680001); ชื่อ/ที่อยู่/จังหวัด/ไปรษณีย์; `cf_taxid(13)`; `cf_hq` (1 = สำนักงานใหญ่), `cf_branch` (รหัสสาขา); `fmlpaymentcreditday` (เครดิตวัน) | ข้อมูลหลักลูกค้า |
| `products.product_list` | `ProductList` ([models.py:145](../models.py#L145)) | PK `idx`; `cf_itemid(6)`, `cf_itemname`, `cf_unitname`, `cf_itempricelevel_price`, `cf_items_ordinary` | ข้อมูลหลักสินค้า |
| `products.ss_car` | `Car` ([models.py:158](../models.py#L158)) | PK `idx`; `number_plate` (unique); `car_brand`, `province` | ทะเบียนรถ |
| `products.drivers` | `Driver` ([models.py:169](../models.py#L169)) | PK `driver_id` (เช่น D0001); `citizen_id(13)`; คำนำหน้า/ชื่อ/นามสกุล | พนักงานขับรถ |
| `public.car_brand` | `CarBrand` | PK `brand_name` | lookup ยี่ห้อรถ |
| `public.province_nostra` | `ProvinceNostra` | PK `prov_nam_t` | lookup ชื่อจังหวัด |

### ⚠️ Quirk สำคัญที่สุดของระบบ: `invoice_items.invoice_number` เก็บค่า `idx`

ตอนบันทึกใบกำกับ ([form.py:232](../form.py#L232) และ PUT ที่ form.py:379) โค้ดใส่ค่า
`InvoiceItem.invoice_number = inv.idx` — คือ **เลข PK จำนวนเต็ม** ถูกเก็บลงคอลัมน์ varchar
ที่ตามชื่อ/FK ควรเก็บ "เลขที่ใบกำกับ" (string เช่น `INV-001`)

ผลที่ตามมาทั่วทั้งระบบ:

1. relationship `Invoice.items` ที่ประกาศไว้ ([models.py:37-43](../models.py#L37-L43), join ด้วยเลขที่ใบกำกับ, `viewonly=True`) **มองไม่เห็นแถวลูกจริง** — จึงแทบไม่ถูกใช้ (ยกเว้น `/export-pdf/{id}` เส้นทางเก่าที่อาจได้ items ว่าง)
2. ทุก query ที่ join หัวบิลกับ items ต้องเขียนเงื่อนไขเผื่อสองแบบ:
   `OR(items.invoice_number == invoices.invoice_number, items.invoice_number == CAST(invoices.idx AS VARCHAR))`
   — พบซ้ำใน summary_invoices.py, bill_note.py, saletax_report.py, drivers_form.py
3. credit_note.py ใช้ raw SQL join ตรง ๆ ว่า `inv.idx::text = it.invoice_number`
4. ข้อยกเว้น: `/api/driver-summary` (drivers_form.py) join ด้วยเลขที่ใบกำกับอย่างเดียว — ไม่สอดคล้องกับจุดอื่น (ยอดอาจขาดถ้าข้อมูลถูกเก็บแบบ idx)

### รูปแบบเลขเอกสาร (Document Running Numbers)

ทุกตัวใช้วิธี query `LIKE prefix%` แล้วหาเลขสูงสุด +1 (ไม่ใช่ DB sequence) และใช้ **ปี พ.ศ.** (ค.ศ. + 543):

| เอกสาร | รูปแบบ | ตัวอย่าง | ที่สร้าง |
|---|---|---|---|
| ใบกำกับภาษี | ผู้ใช้กรอกเอง (มี `GET /api/invoices/check-number` กันซ้ำ) | — | form.py |
| ใบวางบิล | `BNTS<ปีพ.ศ.2หลัก><MM><run 6 หลัก>` | `BNTS6907000001` | [bill_note.py:31](../bill_note.py#L31) |
| ใบลดหนี้ | `SSCR<run>-<DD><MM>/<ปีพ.ศ.>` (run นับต่อปี) | `SSCR12-0507/2569` | [credit_note.py:79](../credit_note.py#L79) |
| รหัสลูกค้า | `PC<ปีพ.ศ.2หลัก><run 4 หลัก>` (นับต่อปี) | `PC690001` | [customers.py:194](../customers.py#L194) |
| รหัสคนขับ | `D<run 4 หลัก>` | `D0001` | [drivers_form.py:52](../drivers_form.py#L52) |

### แนวคิด Snapshot (สำคัญต่อการเข้าใจข้อมูล)

หัวใบกำกับและหัวใบวางบิล **คัดลอกข้อมูลลูกค้ามาเก็บในตัวเอง** (ชื่อ, ที่อยู่, taxid, ฯลฯ) แทนที่จะ FK ไป `customer_list`
เช่นเดียวกับ `bill_note_item` ที่เก็บยอดของใบกำกับไว้ในตัว — เจตนาคือให้เอกสารที่ออกแล้ว **ไม่เปลี่ยนตามข้อมูลหลักที่แก้ทีหลัง** (จุดเชื่อมกลับไปหา master คือ `personid`)

---

## 6. Backend Modules ทั้ง 9 ตัว

ทุก router: import `models` + `SessionLocal` จากส่วนกลาง, สร้าง `get_db()` และ `Jinja2Templates` ของตนเอง, include เข้า main โดยไม่มี prefix

### 6.1 form.py — สร้าง/แก้ไขใบกำกับภาษี + Export PDF (506 บรรทัด)

ตัวช่วยสำคัญ: Jinja filter `thaidate` (วันที่ไทย พ.ศ.) และ `thbaht` (แปลงตัวเลขเป็นข้อความบาทไทย) ([form.py:47-116](../form.py#L47-L116)); `_parse_ymd` รองรับ ISO / dd/mm/yyyy / "5 กรกฎาคม 2569"

| Method + Path | หน้าที่ | ตารางที่แตะ |
|---|---|---|
| `GET /form`, `/form.html` | หน้าฟอร์มใบกำกับ (template `form.html`) | — |
| `GET /api/invoices/check-number` | เช็คเลขที่ใบกำกับซ้ำ | invoices (R) |
| `POST /submit` | บันทึกหัวบิล + รายการ; 409 ถ้าเลขซ้ำ; คำนวณ `due_date = invoice_date + เครดิตวัน`; ⚠️ เก็บ item ด้วย `invoice_number = inv.idx` | invoices, invoice_items (W) |
| `GET /api/invoices/{id}/items` | รายการสินค้าของใบกำกับ (match ด้วย `CAST(invoice_number AS int) == id`) | invoice_items (R) |
| `GET /api/invoices/{id}/detail` | หัวบิล + รายการ (ใช้ตอนกด edit) | invoices, invoice_items (R) |
| `PUT /api/invoices/{id}` | แก้หัวบิล + ลบ/ใส่รายการใหม่ทั้งชุด | invoices, invoice_items (W) |
| `POST /preview` | render `invoice.html` จาก JSON (ยังไม่บันทึก) — พรีวิวในหน้าจอ | — |
| `POST /export-merged-pdf` | **PDF หลักของใบกำกับ**: render `invoice.html` 4 รอบ (ต้นฉบับ/สำเนา × ใบกำกับ/ใบเสร็จ) → WeasyPrint ทีละชุด → pypdf รวมเป็นไฟล์เดียว | — |

### 6.2 summary_invoices.py — รายงาน/ค้นหา/แก้ไขใบกำกับ (402 บรรทัด, JSON ล้วน)

`VAT_RATE = 0.07` ประกาศที่หัวไฟล์; ยอดต่อใบคำนวณจาก `SUM(COALESCE(amount, quantity*price))`

| Method + Path | หน้าที่ |
|---|---|
| `GET /api/invoices/summary` | สรุปยอดรวม + VAT 7% กลุ่มตามวัน/เดือน/ปี |
| `GET /api/invoices` | รายการใบกำกับตามช่วงวันที่ + ค้นหา (เลขที่/ชื่อลูกค้า/PO) + join ชื่อคนขับ |
| `GET /api/invoices/{id}/items`, `/detail`, `PUT /api/invoices/{id}` | ⚠️ ถูก form.py บังทั้ง 3 เส้น (ดูหัวข้อ 3) |

### 6.3 bill_note.py — ใบวางบิล (439 บรรทัด)

หัวใจของโมดูล: **ใบกำกับหนึ่งใบถูกวางบิลได้ครั้งเดียว** — `_used_invoice_numbers()` ([bill_note.py:59](../bill_note.py#L59)) รวบรวมเลขใบกำกับที่ถูกใช้แล้วจาก `bill_note_item` ทั้งหมด ใช้ทั้งกรองตอนค้นหาและ validate ตอนบันทึก (409)

| Method + Path | หน้าที่ |
|---|---|
| `GET /api/customers/all` | dropdown ลูกค้า — ⚠️ ถูก customers.py บัง |
| `GET /api/billing-note-invoices` | ใบกำกับของลูกค้าในช่วงวันที่ **ที่ยังไม่ถูกวางบิล** พร้อมยอดรวม VAT ต่อใบ |
| `POST /api/billing-notes` | สร้างใบวางบิล: gen เลข `BNTS...`; snapshot ลูกค้า+ยอด; `payment_duedate = วันที่ใบกำกับล่าสุดในชุด` |
| `GET /api/billing-notes/{no}` | รายละเอียดใบวางบิล (คำนวณยอดต่อใบใหม่จาก items + VAT 7%; ข้อความสาขาจาก `cf_hq`/`cf_branch`) |
| `GET /api/search-billing-notes`, `GET /api/suggest/bill-notes` | ค้นหา/autocomplete |
| `PUT /api/billing-notes/{no}` | แก้ไข (กันใบกำกับซ้ำโดยยกเว้นใบตัวเอง แล้วแทนที่รายการทั้งชุด) |
| `DELETE /api/billing-notes/{no}` | ลบ (items ถูกลบตามด้วย cascade `delete-orphan` — cascade เดียวในระบบ) |

การพิมพ์ใบวางบิลทำ**ฝั่ง browser** (หน้า `bill_note.html` มีกรอบ A4 + ปุ่ม `window.print`) ไม่ผ่าน WeasyPrint

### 6.4 credit_note.py — ใบลดหนี้ (882 บรรทัด, ใหญ่และซับซ้อนที่สุด)

จุดต่างจากโมดูลอื่น:
- **ประกาศ ORM model เอง** (`CreditNote`, `CreditNoteItem` — schema `credits`) ไม่ได้อยู่ใน models.py
- ใช้ **raw SQL (`text()`)** จำนวนมาก query ตรงไปที่ `ss_invoices` (join `idx::text = invoice_number`)
- ข้อมูล**ผู้ขาย hardcode ในโค้ด** ("บริษัท เอส แอนด์ เอส อินคอม จำกัด", เลขผู้เสียภาษี 0715544000020)

ตรรกะการลดหนี้ต่อบรรทัด: ราคาเดิม = `price_after_fine + fine`, ราคาใหม่ = `price_after_fine`
→ มูลค่าที่ลด = `Σ max(0, (ราคาเดิม − ราคาใหม่) × จำนวน)` + VAT 7%; เอกสารแบ่งหน้า 10 บรรทัด/หน้า

| กลุ่ม | Routes |
|---|---|
| หน้า/พรีวิว | `GET /credit_note_form.html` (ฟอร์ม), `GET /credit_note.html?no=` (render เอกสารจาก DB), `POST /api/credit-notes/preview` (render จาก payload) |
| CRUD | `POST /api/credit-notes`, `GET /api/credit-notes/{no}`, `GET /api/credit-notes/detail`, `PUT /api/credit-notes/update`, `DELETE /api/credit-notes/{no}`, `GET /api/search-credit-notes`, `GET /api/credit-notes/generate-number/` |
| ข้อมูลอ้างอิงจากใบกำกับ | `GET /api/grn/suggest` (autocomplete GRN), `GET /api/grn/summary` (รวมรายการสินค้าใน GRN — raw SQL CTE), `GET /api/products/price` (ราคาขายล่าสุดของสินค้า) |
| autocomplete ลูกค้า | `GET /api/customers/suggest-personid`, `suggest-name`, `by-personid`, `by-name` |
| PDF | `POST /export-creditnote-pdf` — render `credit_note.html` 2 รอบ (ต้นฉบับ+สำเนา) → WeasyPrint ไฟล์เดียว |

### 6.5 customers.py — ข้อมูลลูกค้า (323 บรรทัด)

CRUD `products.customer_list`: `GET /api/customers` (แบ่งหน้า+ค้นหา), `/all`, `/suggest`, `/detail`, `/next-id` (gen `PC...`), `POST`, `PUT /{idx}`, `DELETE /{idx}`
หมายเหตุ: `POST /api/customers/check-duplicate` เป็น **stub — ตอบ `{duplicate:false}` เสมอ**; ตัวแปลงแถว→dict ส่ง taxid ซ้ำ 3 คีย์ (`cf_taxid`/`tax_id`/`taxid`) เพื่อ FE รุ่นเก่า

### 6.6 products.py — ข้อมูลสินค้า (170 บรรทัด)

CRUD `products.product_list`: `GET /api/products/all`, `POST /api/products` (+check-duplicate), **`POST /api/products/{idx}` สำหรับแก้ไข (เป็น POST ไม่ใช่ PUT — ต่างจากโมดูลอื่น)**, `DELETE /{idx}`
พิเศษ: `GET /api/products/suggest` แนะนำสินค้าจาก**ประวัติการออกใบกำกับ** (`invoice_items` + ราคาเฉลี่ย + จำนวนครั้งที่ใช้) ไม่ใช่จาก master

### 6.7 cars.py — ทะเบียนรถ (165 บรรทัด)

CRUD `products.ss_car` + autocomplete: `GET /api/cars`, `POST/PUT/DELETE /api/cars/{idx}`, `GET /api/suggest/number_plate`, `GET /api/suggest/car_brand` (จาก `public.car_brand`), `GET /api/suggest/province` (จาก `public.province_nostra`); validate ทะเบียนด้วย Pydantic

### 6.8 drivers_form.py — พนักงานขับรถ + รายงานต่อคนขับ (351 บรรทัด)

- CRUD `products.drivers` (`GET/POST /api/drivers`, `PUT/DELETE /api/drivers/{id}`; กัน `citizen_id` ซ้ำ; gen `D<NNNN>`)
- `GET /api/drivers` ยังพ่วง **ทะเบียนรถที่คนขับเคยขับ** (`array_agg(DISTINCT car_numberplate)` จาก invoices)
- รายงาน: `GET /api/driver-summary` (ยอดต่อคนขับ กลุ่มวัน/เดือน/ปี + VAT 7%), `GET /api/driver-invoices` (ใบกำกับรายคนขับ)

### 6.9 saletax_report.py — รายงานภาษีขาย (253 บรรทัด, JSON ล้วน)

- `GET /api/saletax/list` — รายการใบกำกับพร้อมมูลค่า/VAT รายใบสำหรับช่วงเวลา (เดือน/ปี/ช่วง): join ลูกค้า (แสดง "สำนักงานใหญ่/สาขา..." จาก `cf_hq`/`cf_branch`) + ชื่อคนขับ; **แปลงหน่วยเป็นตัน: `quantity >= 1000 → quantity/1000`** ([saletax_report.py:43-45](../saletax_report.py#L43-L45))
- `GET /api/saletax/summary` — ยอดรวมช่วงเวลา เลือกแยกตามบริษัท (`split_by_company`) ได้

---

## 7. Frontend (Templates + JavaScript)

### สองประเภทของ template

1. **หน้า interactive** — HTML เปล่า + JS ประจำหน้า ที่ `fetch` ข้อมูลจาก API แล้ววาด DOM; ใช้ Tailwind CSS + Font Awesome จาก **CDN** (ต้องออนไลน์), สไตล์กลางอยู่ที่ `static/css/style.css` + `form.css`
2. **เอกสาร Jinja (สำหรับ PDF/พิมพ์)** — `invoice.html` (มี Jinja tag 47 จุด) และ `credit_note.html` (29 จุด) ถูก render ฝั่ง server เท่านั้น ไม่มี Tailwind ใช้ CSS เฉพาะ (`invoice.css`, `credit_note.css`) ที่กำหนด `@page { size: A4 }`

### ตารางความเชื่อมโยง หน้า ↔ JS ↔ API

| หน้า (เสิร์ฟจาก) | JS | API ที่เรียก | หน้าที่ |
|---|---|---|---|
| `dashboard.html` (main.py `/`) | dashboard.js | `GET /api/invoices` (สถิติ 7 วันล่าสุด) | ศูนย์รวมเมนูไปทุกหน้า + การ์ดสถิติ |
| `login.html` (main.py `/login`) | login.js | `POST /login` | เข้าสู่ระบบ |
| `form.html` (form.py `/form`) | form.js (+datepicker) | check-number, customers (all/suggest/detail), products/all, drivers, suggest/number_plate, `POST /preview`, `POST /submit`, `PUT /api/invoices/{id}`, `POST /export-merged-pdf` | สร้าง/แก้ใบกำกับ (โหมดแก้ผ่าน `?edit={idx}`) |
| `invoice.html` (render โดย /preview, /export-merged-pdf) | invoice.js (จัด layout ตอน print เท่านั้น ไม่ fetch) | — | ตัวเอกสารใบกำกับ/ใบเสร็จ A4 |
| `summary_invoices.html` (main.py) | summary_invoices.js (+SheetJS CDN) | invoices/summary, invoices, items, detail, `PUT /api/invoices/{id}` | รายงานใบกำกับ: แท็บสรุป/รายการ, ค้นหา, **export Excel ฝั่ง browser**, แก้ไข → เปิด `form.html?edit=` |
| `bill_note.html` (main.py) | bill_note.js | customers/all, billing-note-invoices, `POST/PUT/DELETE billing-notes`, search-billing-notes | สร้าง/ค้นหา/แก้ใบวางบิล + พรีวิว A4 + **พิมพ์ด้วย window.print** |
| `credit_note_form.html` (credit_note.py) | credit_note.js | generate-number, `POST/PUT/DELETE credit-notes`, preview, `POST /export-creditnote-pdf`, search, grn/suggest, grn/summary, products/price, customers/suggest-* | ฟอร์มใบลดหนี้ (ซ้ายฟอร์ม-ขวาพรีวิว PDF) |
| `credit_note.html` (render โดย credit_note.py) | — | — | ตัวเอกสารใบลดหนี้ A4 |
| `customer_form.html` (main.py `/customers`) | customer_form.js | next-id, all, suggest/province, check-duplicate, `POST/PUT/DELETE customers` | จัดการลูกค้า |
| `product_form.html` (main.py `/products`) | product_form.js | products/all, check-duplicate, `POST` (สร้าง/แก้), `DELETE` | จัดการสินค้า |
| `car_numberplate.html` (main.py) | car_numberplate.js | cars CRUD + suggest (plate/brand/province) | จัดการทะเบียนรถ |
| `drivers_form.html` (main.py `/drivers.html`) | drivers_form.js | drivers CRUD, driver-summary, driver-invoices | จัดการคนขับ + แท็บรายงานต่อคนขับ |
| `saletax_report.html` (main.py) | saletax_report.js (+flatpickr, SheetJS CDN) | `GET /api/saletax/list` | รายงานภาษีขาย: KPI cards + ตาราง + Excel + พิมพ์แนวนอน |

ข้อสังเกตการตั้งชื่อ route: บางหน้าใช้ `.html` ต่อท้าย (`/bill_note.html`) บางหน้าใช้ path เปล่า (`/form`, `/customers`) และลิงก์แก้ไขก็มีทั้ง `/form?edit=` (dashboard.js) และ `/form.html?edit=` (summary_invoices.js) — ใช้งานได้ทั้งคู่เพราะ form.py รับทั้งสอง path

### Design System

ตาม note/1_refactor_uxuiV1.md: แนวทาง **Modern Clean & Professional** โทนฟ้า-ขาว-เทา (brand palette `#eff6ff` → `#1d4ed8`), การ์ด `rounded-2xl shadow-sm`, ฟอนต์เอกสารพิมพ์ `TH Sarabun New`

---

## 8. ระบบสร้าง PDF (PDF Pipeline)

ทุกเส้นทางใช้ **WeasyPrint** (HTML + CSS → PDF); pdfkit + wkhtmltopdf ถูกติดตั้งใน Docker แต่ไม่ถูกเรียกใช้ในโค้ดเลย

| # | เส้นทาง | template | ขั้นตอน |
|---|---|---|---|
| 1 | `POST /export-merged-pdf` (form.py) — **เส้นหลักของใบกำกับ** | `invoice.html` + `invoice.css` | render 4 variant (`invoice_original`, `receipt_original`, `invoice_copy`, `receipt_copy`) → แปลงลิงก์ `/static/` เป็น `file://` → WeasyPrint ทีละชุดเป็นไฟล์ชั่วคราว → **pypdf** รวม 4 ไฟล์เป็นชุดเดียว → FileResponse (มี shim รองรับ pypdf ทั้งรุ่น ≤3 และ ≥4) |
| 2 | `POST /export-creditnote-pdf` (credit_note.py) | `credit_note.html` + `credit_note.css` | render 2 รอบ (ต้นฉบับ+สำเนา) ต่อเป็น HTML เดียว → WeasyPrint ครั้งเดียว |
| 3 | `GET /export-pdf/{invoice_id}` (main.py + pdf_generator.py) — **เส้นเก่า** | `invoice.html` (ไม่ผูก CSS) | โหลด Invoice ผ่าน ORM relationship (⚠️ ซึ่งมองไม่เห็น items เพราะ quirk idx) → เขียนไฟล์ตายตัวที่ `/tmp/invoice.pdf` (ใช้บน Windows ไม่ได้) — ควรถือเป็น legacy |

ส่วน**ใบวางบิล**ไม่ใช้ WeasyPrint — พิมพ์จาก browser ด้วย `window.print()` บนหน้า `bill_note.html`
และ**รายงานภาษีขาย**พิมพ์จาก browser แนวนอน (`@page landscape` ใน `saletax_report.css`)

### เรื่องฟอนต์ไทย (สำคัญตอน deploy)

- ไม่มีการประกาศ `@font-face` ในโปรเจกต์เลย — CSS ระบุแค่ `font-family: "TH Sarabun New", "Noto Sans Thai", ...`
- WeasyPrint จึงหาฟอนต์จาก**ระบบปฏิบัติการ** → Dockerfile ติดตั้ง `fonts-thai-tlwg` (ตระกูล TH Sarabun) + `fonts-noto-*` ไว้ให้
- ไฟล์ `app/static/fonts/THSarabunNew*.ttf` ที่อยู่ในโปรเจกต์**ไม่ถูกใช้จริง**
- ⇒ PDF ภาษาไทยจะถูกต้องเมื่อรันใน Docker image นี้ (หรือเครื่องที่ลงฟอนต์ไว้) เท่านั้น

---

## 9. Flow ความเชื่อมโยงแบบ End-to-End

### (a) เข้าสู่ระบบ

```
Browser: GET /login → กรอกฟอร์ม → login.js POST /login
main.py: เทียบ APP_USER/APP_PASS → ตั้ง session cookie → 303 ไป /dashboard
dashboard: เช็ค session (หน้าเดียวที่เช็ค) → แสดงเมนูไปทุกโมดูล
```

### (b) สร้างใบกำกับภาษี → Export PDF 4 ชุด

```
/form (form.html + form.js)
  1. เปิดหน้า: fetch ลูกค้า (/api/customers/all|suggest), สินค้า (/api/products/all),
     คนขับ (/api/drivers), ทะเบียนรถ (/api/suggest/number_plate)
  2. เลือกลูกค้า → autofill ที่อยู่/taxid/เครดิตวัน (จาก /api/customers/detail)
  3. กรอกเลขที่ใบกำกับ → /api/invoices/check-number กันซ้ำ
  4. [พรีวิว] POST /preview → ได้ HTML invoice.html เปิดดูก่อนบันทึก
  5. [บันทึก] POST /submit
        → INSERT ss_invoices.invoices (พร้อม snapshot ลูกค้า + car/driver)
        → INSERT ss_invoices.invoice_items (⚠️ invoice_number = idx)
        → คำนวณ due_date = invoice_date + เครดิตวัน
  6. [PDF] POST /export-merged-pdf
        → invoice.html × {ใบกำกับ,ใบเสร็จ} × {ต้นฉบับ,สำเนา} → WeasyPrint → pypdf merge
  (โหมดแก้ไข: เปิด /form?edit={idx} → GET /api/invoices/{idx}/detail → PUT /api/invoices/{idx})
```

### (c) สร้างใบวางบิล (รวบใบกำกับของลูกค้า)

```
/bill_note.html (bill_note.js)
  1. เลือกลูกค้า (/api/customers/all) + ช่วงวันที่
  2. GET /api/billing-note-invoices
        → คืนใบกำกับของลูกค้าที่ "ยังไม่เคยถูกวางบิล"
          (กรองด้วยเลขใบกำกับที่มีอยู่ใน ss_bills.bill_note_item ทั้งหมด)
        → ยอดต่อใบ = SUM(items) + VAT 7%
  3. ติ๊กเลือกใบกำกับ → POST /api/billing-notes
        → gen เลข BNTS<ปี><เดือน><run6>
        → INSERT bill_note (snapshot ลูกค้า) + bill_note_item (snapshot ยอดต่อใบ)
        → payment_duedate = วันที่ใบกำกับล่าสุดที่เลือก
        → 409 ถ้ามีใบกำกับใดถูกวางบิลไปแล้ว (duplicate guard)
  4. พิมพ์: พรีวิวกรอบ A4 ในหน้า → window.print (ไม่ผ่าน server)
```

### (d) สร้างใบลดหนี้ (อ้างอิงงวดรับสินค้า GRN)

```
/credit_note_form.html (credit_note.js)
  1. ค้นลูกค้า (/api/customers/suggest-*) หรือกรอก GRN → /api/grn/suggest
  2. GET /api/grn/summary → รวมยอดรายการสินค้าที่เคยออกใบกำกับใน GRN นั้น
     (raw SQL join ss_invoices: idx::text = invoice_number)
     + /api/products/price → ราคาขายล่าสุดของสินค้า
  3. กรอกค่าปรับ/ราคาใหม่ต่อหน่วย → มูลค่าลดหนี้ = Σ(ราคาเดิม−ราคาใหม่)×จำนวน + VAT 7%
  4. GET /api/credit-notes/generate-number/ → เลข SSCR<run>-<วันเดือน>/<ปีพ.ศ.>
  5. POST /api/credit-notes → INSERT credits.credit_note + credit_note_item
  6. พรีวิว: POST /api/credit-notes/preview (render credit_note.html สด)
     PDF:    POST /export-creditnote-pdf (ต้นฉบับ+สำเนา ไฟล์เดียว)
```

### (e) รายงาน (อ่านอย่างเดียว — ทุกตัวคำนวณจาก invoices + invoice_items)

```
summary_invoices.html → /api/invoices/summary + /api/invoices   (สรุป/รายการ + Excel ฝั่ง browser)
saletax_report.html   → /api/saletax/list                        (ภาษีขายรายใบ + แปลงตัน + Excel/พิมพ์)
drivers_form.html     → /api/driver-summary + /api/driver-invoices (ยอดต่อคนขับ)
dashboard.html        → /api/invoices (7 วันล่าสุด)
ทุกตัวใช้สูตรเดียวกัน: มูลค่า = SUM(COALESCE(amount, quantity×price)), VAT = 7%
```

---

## 10. การ Deploy

### Docker (เส้นทางหลัก — Railway)

```
Dockerfile (python:3.11-bookworm)
 ├─ apt: libcairo2, libpango*, libgdk-pixbuf, libffi, libglib   ← ที่ WeasyPrint ต้องใช้
 ├─ apt: fonts-thai-tlwg, fonts-noto-core/cjk/emoji, ฯลฯ        ← ฟอนต์ไทยสำหรับ PDF
 ├─ apt: wkhtmltopdf                                            ← สำหรับ pdfkit (ไม่ถูกใช้จริง)
 ├─ pip install -r requirements.txt
 ├─ COPY ./app /app/app
 └─ CMD /app/entrypoint.sh  →  exec uvicorn app.main:app --port ${PORT:-8000}
```

`Procfile` เป็นอีกทางเลือก (buildpack/Heroku-style) ชี้เป้าเดียวกัน: `uvicorn app.main:app`

### Environment Variables ทั้งหมด

| ตัวแปร | ใช้ที่ | ค่า default ในโค้ด | หมายเหตุ |
|---|---|---|---|
| `DATABASE_URL` | database.py | `""` (ว่าง — ถ้าไม่ตั้ง แอปต่อ DB ไม่ได้) | เติม `sslmode=require` อัตโนมัติถ้าไม่ใช่ host `*.railway.internal` |
| `SESSION_SECRET` | main.py | hardcode fallback ในโค้ด | ควรตั้งเสมอใน production |
| `APP_USER` / `APP_PASS` | main.py | `admin` / `1234` | บัญชี login เดียวของระบบ |
| `PORT` | entrypoint.sh / Procfile | 8000 | Railway/Heroku กำหนดให้ |

---

## 11. ข้อสังเกตสำคัญและจุดที่ควรระวัง

เรียงตามผลกระทบ:

1. **API ทั้งหมดไม่มีการยืนยันตัวตน** — session ถูกเช็คเฉพาะ `/dashboard`; ทุก `/api/...` (รวมสร้าง/ลบเอกสาร) และ endpoint PDF เรียกตรงได้โดยไม่ login และค่า default `admin/1234`, `SESSION_SECRET` fallback ก็ hardcode อยู่ในโค้ด
2. **Quirk `invoice_items.invoice_number` เก็บ `idx`** (หัวข้อ 5) — เป็นหนี้ทางเทคนิคที่แพร่ไปทุกโมดูล; ถ้าจะแก้ ต้อง migrate ข้อมูลเก่าและรื้อ query OR-join ทั้งหมด; ระวัง `/api/driver-summary` ที่ join ไม่ครอบสองแบบ
3. **Route ชนกัน 5 จุด** (หัวข้อ 3) — โค้ดฝั่ง "ผู้แพ้" ตายทั้งที่ยังอยู่ในไฟล์ ชวนให้แก้ผิดที่; เช่นแก้ `PUT /api/invoices/{id}` ต้องแก้ที่ form.py ไม่ใช่ summary_invoices.py
4. **โค้ดซ้ำข้ามโมดูล** — `get_db()` ประกาศซ้ำทั้ง 9 router, ตัว parse วันที่ซ้ำ ~6 ไฟล์, `VAT_RATE=0.07` ประกาศซ้ำ 3 ไฟล์ + literal `*0.07` อีก 2 ไฟล์, การแปลงปี พ.ศ. (+543) กระจาย 4 ไฟล์, แต่ละ router สร้าง `Jinja2Templates` ของตัวเอง — แก้สูตรภาษี/วันที่ต้องไล่ทุกไฟล์
5. **ฟอนต์ PDF ผูกกับ Docker image** — ไม่มี `@font-face`; รันนอก image (เช่น dev บน Windows) PDF อาจได้ฟอนต์ผิด; TTF ที่แบกไว้ใน `static/fonts/` ไม่ถูกใช้
6. **Dead / legacy code** — `crud.py` ไม่ถูก import และอ้างคอลัมน์ที่ไม่มีจริง (เรียกเมื่อไรพังเมื่อนั้น), `GET /export-pdf/{id}` เขียนไฟล์ที่ `/tmp` (ใช้ไม่ได้บน Windows) และพึ่ง relationship ที่มองไม่เห็น items, `test_script.py` เป็นไฟล์ทดลอง, pdfkit/wkhtmltopdf ติดตั้งฟรี
7. **`POST /api/customers/check-duplicate` เป็น stub** ตอบว่าไม่ซ้ำเสมอ — การกันลูกค้าซ้ำยังไม่ทำงานจริง
8. **ผู้ขายในใบลดหนี้ hardcode** ในโค้ด credit_note.py — เปลี่ยนชื่อ/ที่อยู่/เลขภาษีบริษัทต้องแก้โค้ด
9. **ไม่มี migration tool** — โครงสร้างตารางจัดการนอกแอปทั้งหมด (ระวังตอนเพิ่มคอลัมน์: model กับ DB ต้องแก้พร้อมกันเอง)
10. **เลขเอกสารแบบ LIKE+max** — ภายใต้การใช้งานพร้อมกันหลายคน อาจได้เลขซ้ำ (race condition); ปัจจุบันผู้ใช้คนเดียวจึงยังไม่เป็นปัญหา

---

*เอกสารนี้สรุปจากการอ่านโค้ดทั้งโปรเจกต์ ณ commit `074c7d1` (edit bill note 20260705) — ไฟล์คู่กัน: `note/2_arcitecture_ssincom_bill.html` (ฉบับ HTML พร้อม diagram)*
