# app/form.py
from pathlib import Path
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, List

import tempfile
import uuid
# --- PdfMerger compatibility (pypdf 3.x & 4.x) ---
try:
    # pypdf <= 3.x
    from pypdf import PdfMerger  # noqa: F401
except ImportError:
    # pypdf >= 4.x : ใช้ PdfWriter.append(...) แทน แล้วทำ shim ให้ API เดิมใช้ได้
    from pypdf import PdfWriter as _PdfWriter
    class PdfMerger:
        def __init__(self):
            self._w = _PdfWriter()
        def append(self, fileobj_or_path):
            self._w.append(fileobj_or_path)
        def write(self, out_fp):
            self._w.write(out_fp)
        def close(self):
            pass

# ใช้ WeasyPrint แทน pdfkit/wkhtmltopdf
from weasyprint import HTML, CSS
from fastapi import APIRouter, Request, Form, HTTPException, Query, Depends, Body
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, FileResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Integer, Date

from .database import SessionLocal
from . import models

router = APIRouter()

# ---------- Templates + ฟิลเตอร์ ----------
BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

TH_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
             "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"]

def thaidate(value):
    if not value:
        return ""
    d = None
    if isinstance(value, datetime):
        d = value.date()
    elif isinstance(value, date):
        d = value
    elif isinstance(value, str):
        value = value.strip()
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
            try:
                d = datetime.strptime(value, fmt).date()
                break
            except Exception:
                pass
        if d is None:
            return value
    else:
        return str(value)
    return f"{d.day} {TH_MONTHS[d.month-1]} {d.year + 543}"

_TH_NUM = ['ศูนย์','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า']
_TH_POS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']

def _read_chunk_th(num_str: str) -> str:
    s = ''
    n = len(num_str)
    for i, ch in enumerate(num_str):
        d = ord(ch) - 48
        pos = n - i - 1
        if d == 0: continue
        if pos == 1:
            if d == 1: s += 'สิบ'
            elif d == 2: s += 'ยี่สิบ'
            else: s += _TH_NUM[d] + 'สิบ'
        elif pos == 0:
            tens_digit = int(num_str[-2]) if n >= 2 else 0
            if d == 1 and n > 1 and tens_digit != 0: s += 'เอ็ด'
            else: s += _TH_NUM[d]
        else:
            s += (_TH_NUM[d] if d != 1 else 'หนึ่ง') + _TH_POS[pos]
    return s

def _read_int_th(n: int) -> str:
    if n == 0: return 'ศูนย์'
    parts, i = [], 0
    while n > 0:
        chunk = n % 1_000_000
        if chunk:
            w = _read_chunk_th(str(chunk))
            if i > 0: w += 'ล้าน' * i
            parts.append(w)
        n //= 1_000_000; i += 1
    return ''.join(reversed(parts))

def thai_baht_text(value) -> str:
    try:
        amt = Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    except Exception:
        return ''
    neg = amt < 0
    if neg: amt = -amt
    baht = int(amt); satang = int((amt * 100) % 100)
    baht_words = _read_int_th(baht) + 'บาท'
    words = baht_words + ('ถ้วน' if satang == 0 else _read_chunk_th(f'{satang:02d}') + 'สตางค์')
    return ('ลบ' + words) if neg else words

templates.env.filters["thaidate"] = thaidate
templates.env.filters["thbaht"] = thai_baht_text

# ---------- DB dependency ----------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ---------- Utils ----------
TH_MONTHS_MAP = {
    "มกราคม":1,"กุมภาพันธ์":2,"มีนาคม":3,"เมษายน":4,"พฤษภาคม":5,"มิถุนายน":6,
    "กรกฎาคม":7,"สิงหาคม":8,"กันยายน":9,"ตุลาคม":10,"พฤศจิกายน":11,"ธันวาคม":12
}
def _parse_ymd(s: Optional[str]) -> Optional[date]:
    if not s: return None
    s = s.strip()
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except Exception:
        pass
    for fmt in ("%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            pass
    parts = s.split()
    if len(parts) == 3 and parts[1] in TH_MONTHS_MAP:
        d = int(parts[0]); mo = TH_MONTHS_MAP[parts[1]]; y = int(parts[2])
        if y > 2400: y -= 543
        try:
            return date(y, mo, d)
        except ValueError:
            return None
    return None

# ---------- Page: form ----------
@router.get("/form", response_class=HTMLResponse)
@router.get("/form.html", response_class=HTMLResponse)
def form_page(request: Request):
    return templates.TemplateResponse("form.html", {"request": request})

# ---------- API: ตรวจเลขซ้ำ ----------
@router.get("/api/invoices/check-number")
def api_check_invoice_number(number: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    exists = db.query(models.Invoice).filter(models.Invoice.invoice_number == number).first() is not None
    return {"exists": bool(exists)}

# ---------- API: บันทึกใบกำกับ (สร้างใหม่) ----------
@router.post("/submit")
def submit(
    invoice_number: str = Form(...),
    invoice_date: str = Form(None),
    grn_number: str = Form(None),
    dn_number: str = Form(None),
    po_number: str = Form(None),

    # customer
    customer_name: str = Form(None),
    customer_taxid: str = Form(None),
    customer_address: str = Form(None),

    personid: str = Form(None),
    tel: str = Form(None),
    mobile: str = Form(None),
    cf_personzipcode: str = Form(None),
    cf_provincename: str = Form(None),
    fmlpaymentcreditday: int = Form(None),
    fm_payment: str = Form("cash"),
    due_date: str = Form(None),
    car_numberplate: str = Form(None),
    cf_branch: str = Form(None),
    driver_id: str = Form(None),

    product_code: List[str] = Form(...),
    description: List[str] = Form(...),
    quantity: List[float] = Form(...),
    unit_price: List[float] = Form(...),
    db: Session = Depends(get_db),
):
    if db.query(models.Invoice).filter(models.Invoice.invoice_number == invoice_number).first():
        return JSONResponse(status_code=409, content={"detail": "Duplicate invoice_number"})

    d = _parse_ymd(invoice_date)
    due = _parse_ymd(due_date) or (d + timedelta(days=fmlpaymentcreditday) if d and fmlpaymentcreditday else None)

    inv = models.Invoice(
        invoice_number=invoice_number,
        invoice_date=d,
        grn_number=grn_number,
        dn_number=dn_number,
        po_number=po_number,
        fname=customer_name,
        personid=personid,
        tel=tel,
        mobile=mobile,
        cf_personaddress=customer_address,
        cf_personzipcode=cf_personzipcode,
        cf_provincename=cf_provincename,
        cf_taxid=customer_taxid,
        fmlpaymentcreditday=fmlpaymentcreditday,
        due_date=due,
        car_numberplate=car_numberplate,
        driver_id=(driver_id or None), 
    )
    db.add(inv)
    db.flush()

    for i in range(len(product_code)):
        qty   = float(quantity[i] or 0)
        price = float(unit_price[i] or 0)
        db.add(models.InvoiceItem(
            invoice_number=inv.idx,
            personid=personid,
            cf_itemid=product_code[i],
            cf_itemname=description[i],
            cf_unitname=None,
            cf_itempricelevel_price=price,
            cf_items_ordinary=i+1,
            quantity=qty,
            amount=qty*price
        ))

    db.commit()
    db.refresh(inv)
    return {"message": "saved", "invoice_idx": inv.idx, "invoice_number": inv.invoice_number}

# ---------- API: รายการสินค้าในใบกำกับ ----------
@router.get("/api/invoices/{inv_id}/items")
def api_invoice_items(inv_id: int, db: Session = Depends(get_db)):
    it = models.InvoiceItem
    rows = db.query(
        it.cf_itemid, it.cf_itemname, it.quantity, it.cf_itempricelevel_price, it.amount
    ).filter(
        cast(it.invoice_number, Integer) == inv_id
    ).order_by(it.cf_items_ordinary.asc()).all()

    data = [{
        "cf_itemid": r[0],
        "cf_itemname": r[1],
        "quantity": float(r[2] or 0),
        "unit_price": float(r[3] or 0),
        "amount": float(r[4] or 0),
    } for r in rows]
    return JSONResponse(content=data)

# ---------- API: รายละเอียดบิล ----------
@router.get("/api/invoices/{inv_id}/detail")
def api_invoice_detail(inv_id: int, db: Session = Depends(get_db)):
    inv = db.query(models.Invoice).filter(models.Invoice.idx == inv_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="invoice not found")

    head = {
        "idx": inv.idx,
        "invoice_number": inv.invoice_number,
        "invoice_date": inv.invoice_date.isoformat() if inv.invoice_date else None,
        "personid": inv.personid,
        "customer_name": inv.fname,
        "customer_taxid": inv.cf_taxid,
        "customer_address": inv.cf_personaddress,
        "cf_personzipcode": inv.cf_personzipcode,
        "cf_provincename": inv.cf_provincename,
        "tel": inv.tel,
        "mobile": inv.mobile,
        "po_number": inv.po_number,
        "grn_number": inv.grn_number,
        "dn_number": inv.dn_number,
        "fmlpaymentcreditday": inv.fmlpaymentcreditday,
        "due_date": inv.due_date.isoformat() if inv.due_date else None,
        "car_numberplate": inv.car_numberplate,
        "cf_branch": inv.cf_branch,
    }

    rows = db.query(models.InvoiceItem)\
        .filter(cast(models.InvoiceItem.invoice_number, Integer) == inv_id)\
        .order_by(models.InvoiceItem.cf_items_ordinary.asc())\
        .all()

    items = [{
        "idx": it.idx,
        "cf_itemid": it.cf_itemid,
        "cf_itemname": it.cf_itemname,
        "quantity": float(it.quantity or 0),
        "unit_price": float(it.cf_itempricelevel_price or 0),
        "amount": float(it.amount or 0),
    } for it in rows]

    return {"invoice": head, "items": items}

# ---------- API: อัปเดตบิล + แทนที่รายการทั้งหมด ----------
from pydantic import BaseModel

class InvoiceItemIn(BaseModel):
    idx: Optional[int] = None
    cf_itemid: Optional[str] = None
    cf_itemname: Optional[str] = None
    quantity: float = 0
    unit_price: float = 0
    amount: Optional[float] = None

class InvoiceUpdate(BaseModel):
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    fname: Optional[str] = None
    personid: Optional[str] = None
    tel: Optional[str] = None
    mobile: Optional[str] = None
    cf_personaddress: Optional[str] = None
    cf_personzipcode: Optional[str] = None
    cf_provincename: Optional[str] = None
    cf_taxid: Optional[str] = None
    po_number: Optional[str] = None
    grn_number: Optional[str] = None
    dn_number: Optional[str] = None
    fmlpaymentcreditday: Optional[int] = None
    due_date: Optional[str] = None
    car_numberplate: Optional[str] = None
    cf_branch: Optional[str] = None
    items: Optional[list[InvoiceItemIn]] = None

@router.put("/api/invoices/{inv_id}")
def api_update_invoice(inv_id: int, payload: InvoiceUpdate, db: Session = Depends(get_db)):
    inv = db.query(models.Invoice).filter(models.Invoice.idx == inv_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="invoice not found")

    for field in [
        "invoice_number","fname","personid","tel","mobile",
        "cf_personaddress","cf_personzipcode","cf_provincename","cf_taxid",
        "po_number","grn_number","dn_number",
        "fmlpaymentcreditday","car_numberplate",
        "cf_branch",
    ]:
        val = getattr(payload, field)
        if val is not None:
            setattr(inv, field, val)

    d = _parse_ymd(payload.invoice_date) if payload.invoice_date is not None else None
    if d: inv.invoice_date = d
    d = _parse_ymd(payload.due_date) if payload.due_date is not None else None
    if d: inv.due_date = d

    if payload.items is not None:
        db.query(models.InvoiceItem)\
          .filter(cast(models.InvoiceItem.invoice_number, Integer) == inv_id)\
          .delete()
        order = 1
        for it in payload.items:
            qty = float(it.quantity or 0)
            price = float(it.unit_price or 0)
            db.add(models.InvoiceItem(
                invoice_number=inv_id,
                personid=inv.personid,
                cf_itemid=it.cf_itemid,
                cf_itemname=it.cf_itemname,
                cf_unitname=None,
                cf_itempricelevel_price=price,
                cf_items_ordinary=order,
                quantity=qty,
                amount=qty*price
            ))
            order += 1

    db.commit()
    return {"ok": True}

# ---------- Preview HTML (เรนเดอร์จาก invoice.html) ----------
@router.post("/preview", response_class=HTMLResponse)
def preview(request: Request, payload: dict = Body(...)):
    return templates.TemplateResponse(
        "invoice.html",
        {
            "request": request,
            "invoice": payload,
            "discount": payload.get("discount", 0),
            "vat_rate": payload.get("vat_rate", 7),
        }
    )

@router.post("/export-merged-pdf")
def export_merged_pdf(request: Request, payload: dict = Body(...)):
    """
    สร้าง PDF 4 เวอร์ชันจาก invoice.html (เหมือน preview) แล้ว merge เป็นไฟล์เดียว
    - normalize คีย์จาก payload ให้ตรงกับเทมเพลต
    - map ทุกลิงก์ /static/* เป็น file://…/static/* สำหรับ WeasyPrint
    - แนบ stylesheet /static/css/invoice.css เสมอ
    """
    variants = [
        ("invoice_original", "ใบกำกับ/ส่งของ/แจ้งหนี้ (ต้นฉบับ)"),
        ("receipt_original", "ใบเสร็จรับเงิน (ต้นฉบับ)"),
        ("invoice_copy",     "ใบกำกับ/ส่งของ/ใบแจ้งหนี้ (สำเนา)"),
        ("receipt_copy",     "ใบเสร็จรับเงิน (สำเนา)"),
    ]

    base_dir = BASE_DIR
    css_path = base_dir / "static" / "css" / "invoice.css"
    static_root_uri = (base_dir / "static").as_uri()  # e.g. file:///app/app/static

    def normalize_payload(src: dict) -> dict:
        out = dict(src or {})
        # ---- หัวลูกค้า ----
        out["customer_name"]     = src.get("customer_name") or src.get("fname") or ""
        out["customer_taxid"]    = src.get("customer_taxid") or src.get("cf_taxid") or ""
        out["customer_address"]  = src.get("customer_address") or src.get("cf_personaddress") or ""
        out["cf_personzipcode"]  = src.get("cf_personzipcode") or ""
        out["cf_provincename"]   = src.get("cf_provincename") or ""
        out["tel"]               = src.get("tel") or src.get("mobile") or ""
        out["mobile"]            = src.get("mobile") or src.get("tel") or ""

        # ---- รายการสินค้า ----
        items = []
        for it in (src.get("items") or []):
            items.append({
                "product_code": it.get("product_code") or it.get("cf_itemid") or "",
                "description":  it.get("description")  or it.get("cf_itemname") or "",
                "quantity":     float(it.get("quantity") or 0),
                "unit_price":   float(it.get("unit_price") or 0),
            })
        out["items"] = items
        return out

    temp_pdf_paths = []
    merger = PdfMerger()

    try:
        for variant_code, _name in variants:
            payload["variant"] = variant_code
            view_payload = normalize_payload(payload)

            # 1) เรนเดอร์ HTML เดียวกับ preview
            html_resp = templates.TemplateResponse(
                "invoice.html",
                {
                    "request": request,
                    "invoice": view_payload,
                    "discount": view_payload.get("discount", 0),
                    "vat_rate": view_payload.get("vat_rate", 7),
                }
            )
            html_str = html_resp.body.decode("utf-8")

            # 2) map /static/* -> file://…/static/* (ครอบคลุม <link>, <img>, @font-face)
            html_str = (html_str
                .replace('href="/static/',  f'href="{static_root_uri}/')
                .replace('src="/static/',   f'src="{static_root_uri}/')
            )

            # 3) เขียน PDF ชั่วคราว ด้วย CSS เดียวกับ preview
            tmp_pdf = Path(tempfile.gettempdir()) / f"{uuid.uuid4()}.pdf"
            HTML(string=html_str, base_url=str(base_dir)).write_pdf(
                str(tmp_pdf),
                stylesheets=[CSS(filename=str(css_path))]
            )
            temp_pdf_paths.append(tmp_pdf)

        # 4) รวม PDF
        for p in temp_pdf_paths:
            merger.append(str(p))

        out_path = Path(tempfile.gettempdir()) / f"merged_invoice_{payload.get('invoice_number', 'doc')}.pdf"
        merger.write(str(out_path))
        merger.close()

        return FileResponse(
            path=out_path,
            media_type="application/pdf",
            filename=f"invoice_merged_{payload.get('invoice_number', 'doc')}.pdf"
        )

    finally:
        # 5) เก็บกวาด temp เสมอ
        for p in temp_pdf_paths:
            try:
                if p.exists():
                    p.unlink()
            except Exception:
                pass