from fastapi import FastAPI, Form, Request, HTTPException, Query
import os
from urllib.parse import quote
from fastapi import Response   
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_, and_, func, cast, Integer, Date
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.encoders import jsonable_encoder
from starlette.middleware.sessions import SessionMiddleware
from . import models, database, crud, pdf_generator
from .models import CustomerList, ProductList
from .database import SessionLocal
from datetime import date, datetime, timedelta
from typing import List
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
import re

app = FastAPI()
#models.Base.metadata.create_all(bind=database.engine)

BASE_DIR = Path(__file__).resolve().parent
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

#---------------- manage session -------------------------#
# ✅ เปิด session (ตั้งค่า env: SESSION_SECRET)
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET", "please-change-me"),
    max_age=60 * 60 * 8,  # 8 ชม.
)

# กำหนดหน้า/เส้นทางที่ต้องล็อกอินก่อน (เพิ่มได้ตามต้องการ)
PROTECTED_PATHS = {"/", "/dashboard", "/dashboard.html"}

ALLOW_PREFIXES = ("/login", "/logout", "/healthz", "/static", "/api")

@app.middleware("http")
async def require_login_for_pages(request: Request, call_next):
    path = request.url.path
    # ผ่านเลยถ้าเป็น static/api/login/healthz
    if path.startswith(ALLOW_PREFIXES):
        return await call_next(request)

    # ถ้ายังไม่ได้ล็อกอิน → เด้งไปหน้า login
    if not request.session.get("user"):
        next_path = path
        if request.url.query:
            next_path += "?" + request.url.query
        return RedirectResponse(url=f"/login?next={quote(next_path)}", status_code=303)

    return await call_next(request)

# ✅ เพจล็อกอิน
@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})

# ✅ โพสต์ล็อกอิน (ตัวอย่างตรวจแบบง่ายจาก ENV)
@app.post("/login")
async def do_login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    next: str = Form(default="/dashboard"),
):
    VALID_USER = os.getenv("APP_USER", "admin")
    VALID_PASS = os.getenv("APP_PASS", "ssincom_2025")

    if username == VALID_USER and password == VALID_PASS:
        request.session["user"] = {"name": username}
        return RedirectResponse(url=next or "/dashboard", status_code=303)

    return RedirectResponse(url=f"/login?error=1&next={quote(next)}", status_code=303)

# ✅ ออกจากระบบ
@app.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/login", status_code=303)

# ✅ เพจ Dashboard (เสิร์ฟไฟล์ templates/dashboard.html)
@app.get("/", response_class=HTMLResponse)
@app.get("/dashboard", response_class=HTMLResponse)
@app.get("/dashboard.html", response_class=HTMLResponse)
def dashboard_page(request: Request):
    user = request.session.get("user")
    return templates.TemplateResponse("dashboard.html", {"request": request, "user": user})

#----------------------------------- open form.html ---------------#

@app.get("/form", response_class=HTMLResponse)
@app.get("/form.html", response_class=HTMLResponse)
async def form_page(request: Request):
    return templates.TemplateResponse("form.html", {"request": request})

#function duplicate check invoice_number 
def check_invoice_number(number: str = Query(..., min_length=1)):
    db = SessionLocal()
    try:
        exists = db.query(models.Invoice)\
                   .filter(models.Invoice.invoice_number == number)\
                   .first() is not None
        return {"exists": bool(exists)}
    finally:
        db.close()

#function convert date to thai date 
TH_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
             "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"]

def thaidate(value):
    if not value:
        return ""
    # รองรับทั้ง date/datetime และสตริง (เช่น '2025-08-23')
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
            return value  # ถ้า parse ไม่ได้ ให้แสดงตามเดิม
    else:
        return str(value)

    y_be = d.year + 543
    return f"{d.day} {TH_MONTHS[d.month-1]} {y_be}"

templates.env.filters["thaidate"] = thaidate

# --- function convert thai baht to thai bath string ---
_TH_NUM = ['ศูนย์','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า']
_TH_POS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']

def _read_chunk_th(num_str: str) -> str:
    # อ่านเลขเป็นคำไทยสำหรับกลุ่มไม่เกิน 6 หลัก
    s = ''
    n = len(num_str)
    for i, ch in enumerate(num_str):
        d = ord(ch) - 48
        pos = n - i - 1  # 0=หน่วย,1=สิบ,...
        if d == 0:
            continue
        if pos == 1:  # หลักสิบ
            if d == 1:
                s += 'สิบ'
            elif d == 2:
                s += 'ยี่สิบ'
            else:
                s += _TH_NUM[d] + 'สิบ'
        elif pos == 0:  # หลักหน่วย
            # ใช้ "เอ็ด" เฉพาะเมื่อมีหลักสิบไม่เป็นศูนย์
            tens_digit = int(num_str[-2]) if n >= 2 else 0
            if d == 1 and n > 1 and tens_digit != 0:
                s += 'เอ็ด'
            else:
                s += _TH_NUM[d]
        else:
            s += (_TH_NUM[d] if d != 1 else 'หนึ่ง') + _TH_POS[pos]
    return s

def _read_int_th(n: int) -> str:
    if n == 0:
        return 'ศูนย์'
    parts = []
    i = 0
    while n > 0:
        chunk = n % 1_000_000
        if chunk:
            w = _read_chunk_th(str(chunk))
            if i > 0:
                w += 'ล้าน' * i
            parts.append(w)
        n //= 1_000_000
        i += 1
    return ''.join(reversed(parts))

def thai_baht_text(value) -> str:
    # แปลงเป็น "…บาทถ้วน" หรือ "…บาท…สตางค์"
    try:
        amt = Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    except Exception:
        return ''
    neg = amt < 0
    if neg:
        amt = -amt

    baht = int(amt)
    satang = int((amt * 100) % 100)

    baht_words = _read_int_th(baht) + 'บาท'
    if satang == 0:
        words = baht_words + 'ถ้วน'
    else:
        # สตางค์สองหลัก
        satang_words = _read_chunk_th(f'{satang:02d}') + 'สตางค์'
        words = baht_words + satang_words
    return ('ลบ' + words) if neg else words

# --- จดทะเบียนฟิลเตอร์กับ Jinja ---
templates.env.filters['thbaht'] = thai_baht_text

        
#api for submit invoice from form.html 
@app.post("/submit")
async def submit(
    invoice_number: str = Form(...),
    invoice_date: str = Form(None),
    grn_number: str = Form(None),
    dn_number: str = Form(None),
    po_number: str = Form(None),

    # from form
    customer_name: str = Form(None),
    customer_taxid: str = Form(None),
    customer_address: str = Form(None),

    # new column add
    personid: str = Form(None),
    tel: str = Form(None),
    mobile: str = Form(None),
    cf_personzipcode: str = Form(None),
    cf_provincename: str = Form(None),
    fmlpaymentcreditday: int = Form(None),
    fm_payment: str = Form("cash"),
    due_date: str = Form(None),
    car_numberplate: str = Form(None),

    product_code: List[str] = Form(...),
    description: List[str] = Form(...),
    quantity: List[float] = Form(...),
    unit_price: List[float] = Form(...)
):
    from datetime import datetime
    db = SessionLocal()
    try:
        # parse date 
        d = None
        if invoice_date:
            for fmt in ("%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d"):
                try:
                    d = datetime.strptime(invoice_date, fmt).date()
                    break
                except:
                    pass

        # parse due_date (ถ้าฟรอนต์ส่งมา)
        due = None
        if due_date:
            for fmt in ("%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d"):
                try:
                    due = datetime.strptime(due_date, fmt).date()
                    break
                except:
                    pass

        # check duplicate number 
        if db.query(models.Invoice).filter(models.Invoice.invoice_number == invoice_number).first():
            return JSONResponse(status_code=409, content={"detail": "Duplicate invoice_number"})

        # fallback: ถ้า due ไม่มี ให้คำนวณจาก d + creditday (เหมือนเดิม)
        if not due and d and fmlpaymentcreditday:
            due = d + timedelta(days=fmlpaymentcreditday)

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
            car_numberplate=car_numberplate
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
        return {"message": "saved", "invoice_idx": inv.idx, "invoice_number": inv.invoice_number}
    except:
        db.rollback()
        raise
    finally:
        db.close()

# ========= page summary =========
@app.get("/summary_invoices.html", response_class=HTMLResponse)
async def summary_invoices_page(request: Request):
    return templates.TemplateResponse("summary_invoices.html", {"request": request})

@app.get("/api/invoices")
def api_list_invoices(
    start: str | None = Query(None, description="YYYY-MM-DD"),
    end: str | None = Query(None, description="YYYY-MM-DD"),
    q: str | None = Query(None, description="ค้นหา (เลขที่/ชื่อลูกค้า/PO)")
):
    db = SessionLocal()
    try:
        inv = models.Invoice
        it  = models.InvoiceItem

        # sum bill (amount from items)
        j = db.query(
            inv.idx.label("idx"),
            inv.invoice_number.label("invoice_number"),
            inv.invoice_date.label("invoice_date"),
            inv.fname.label("fname"),
            inv.po_number.label("po_number"),
            func.coalesce(func.sum(it.quantity * it.cf_itempricelevel_price), 0).label("amount")
        ).join(
            it, cast(it.invoice_number, Integer) == inv.idx   # items.invoice_number refer idx
        )

        # filter by date
        if start:
            j = j.filter(inv.invoice_date >= cast(start, Date))
        if end:
            j = j.filter(inv.invoice_date <= cast(end, Date))

        # search
        if q:
            like = f"%{q}%"
            j = j.filter(or_(
                inv.invoice_number.ilike(like),
                inv.fname.ilike(like),
                inv.po_number.ilike(like)
            ))

        j = j.group_by(inv.idx, inv.invoice_number, inv.invoice_date, inv.fname, inv.po_number)\
             .order_by(inv.invoice_date.desc(), inv.idx.desc())

        VAT_RATE = 0.07
        rows = []
        for idx, invoice_number, invoice_date, fname, po_number, amount in j.all():
            before_vat = float(amount or 0)
            vat = before_vat * VAT_RATE
            grand = before_vat + vat
            # แปลงวันที่เป็นสตริง
            date_str = invoice_date.isoformat() if hasattr(invoice_date, "isoformat") else str(invoice_date)
            rows.append({
                "idx": idx,
                "invoice_number": invoice_number,
                "invoice_date": date_str,
                "fname": fname,
                "po_number": po_number,
                "amount": float(before_vat),
                "vat": float(vat),
                "grand": float(grand),
            })

        return JSONResponse(content=jsonable_encoder(rows))
    finally:
        db.close()

class InvoiceItemIn(BaseModel):
    idx: Optional[int] = None
    cf_itemid: Optional[str] = None
    cf_itemname: Optional[str] = None
    quantity: float = 0
    unit_price: float = 0
    amount: Optional[float] = None

class InvoiceUpdate(BaseModel):
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None        # YYYY-MM-DD
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
    due_date: Optional[str] = None            # YYYY-MM-DD
    car_numberplate: Optional[str] = None
    items: Optional[list[InvoiceItemIn]] = None

# ===== รายการสินค้าในใบกำกับ =====
@app.get("/api/invoices/{inv_id}/items")
def api_invoice_items(inv_id: int):
    db = SessionLocal()
    try:
        it = models.InvoiceItem
        # ดึงสินค้าตาม inv_id โดยเทียบกับ invoice_items.invoice_number
        rows = db.query(
            it.cf_itemid, it.cf_itemname, it.quantity, it.cf_itempricelevel_price, it.amount
        ).filter(
            cast(it.invoice_number, Integer) == inv_id
        ).order_by(it.cf_items_ordinary.asc()).all()

        data = []
        for cf_itemid, cf_itemname, quantity, unit_price, amount in rows:
            data.append({
                "cf_itemid": cf_itemid,
                "cf_itemname": cf_itemname,
                "quantity": float(quantity or 0),
                "unit_price": float(unit_price or 0),
                "amount": float(amount or 0)
            })
        return JSONResponse(content=jsonable_encoder(data))
    finally:
        db.close()

def api_invoice_detail(inv_id: int):
    db = SessionLocal()
    try:
        inv = db.query(models.Invoice).filter(models.Invoice.idx == inv_id).first()
        if not inv:
            raise HTTPException(status_code=404, detail="invoice not found")

        head = {
            "idx": inv.idx,
            "invoice_number": inv.invoice_number,
            "invoice_date": inv.invoice_date.isoformat() if inv.invoice_date else None,
            "fname": inv.fname,
            "personid": inv.personid,
            "tel": inv.tel,
            "mobile": inv.mobile,
            "cf_personaddress": inv.cf_personaddress,
            "cf_personzipcode": inv.cf_personzipcode,
            "cf_provincename": inv.cf_provincename,
            "cf_taxid": inv.cf_taxid,
            "po_number": inv.po_number,
            "grn_number": inv.grn_number,
            "dn_number": inv.dn_number,
            "fmlpaymentcreditday": inv.fmlpaymentcreditday,
            "due_date": inv.due_date.isoformat() if inv.due_date else None,
            "car_numberplate": inv.car_numberplate,
        }

        items = []
        for it in inv.items:
            items.append({
                "idx": it.idx,
                "cf_itemid": it.cf_itemid,
                "cf_itemname": it.cf_itemname,
                "quantity": float(it.quantity or 0),
                "unit_price": float(it.cf_itempricelevel_price or 0),
                "amount": float(it.amount or 0)
            })
        return {"invoice": head, "items": items}
    finally:
        db.close()

#----------------function change date format --------------#
TH_MONTHS_MAP = { # ใช้ชุดเดียวกับ TH_MONTHS ที่มีอยู่
    "มกราคม":1,"กุมภาพันธ์":2,"มีนาคม":3,"เมษายน":4,"พฤษภาคม":5,"มิถุนายน":6,
    "กรกฎาคม":7,"สิงหาคม":8,"กันยายน":9,"ตุลาคม":10,"พฤศจิกายน":11,"ธันวาคม":12
}

def _parse_ymd(s: str | None) -> date | None:
    """รับรูปแบบ: YYYY-MM-DD, dd/mm/YYYY, mm/dd/YYYY, dd <เดือนไทย> YYYY (พ.ศ./ค.ศ.)"""
    if not s:
        return None
    s = s.strip()

    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
    if m:
        y, mo, d = map(int, m.groups())
        try:
            return date(y, mo, d)
        except ValueError:
            return None

    for fmt in ("%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            pass

    parts = s.split()
    if len(parts) == 3 and parts[1] in TH_MONTHS_MAP:
        d = int(parts[0]); mo = TH_MONTHS_MAP[parts[1]]; y = int(parts[2])
        if y > 2400:  # พ.ศ. → ค.ศ.
            y -= 543
        try:
            return date(y, mo, d)
        except ValueError:
            return None

    return None

# ====== แก้ไขหัวบิล + แทนที่รายการสินค้าแบบ bulk ======
@app.put("/api/invoices/{inv_id}")
def api_update_invoice(inv_id: int, payload: InvoiceUpdate):
    db = SessionLocal()
    try:
        inv = db.query(models.Invoice).filter(models.Invoice.idx == inv_id).first()
        if not inv:
            raise HTTPException(status_code=404, detail="invoice not found")

        # อัปเดตหัวบิล (อัปเดตเฉพาะฟิลด์ที่ส่งมา)
        for field in [
            "invoice_number","fname","personid","tel","mobile",
            "cf_personaddress","cf_personzipcode","cf_provincename","cf_taxid",
            "po_number","grn_number","dn_number",
            "fmlpaymentcreditday","car_numberplate"
        ]:
            val = getattr(payload, field)
            if val is not None:
                setattr(inv, field, val)

        d = _parse_ymd(payload.invoice_date) if payload.invoice_date is not None else None
        if d:
            inv.invoice_date = d
        d = _parse_ymd(payload.due_date) if payload.due_date is not None else None  
        if d:
            inv.due_date = d

        # ถ้ามี items → ลบของเดิม แล้วใส่ใหม่ทั้งหมด (ง่ายและปลอดภัย)
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
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

# ===== รายละเอียดบิล (หัวบิล + รายการ) =====
@app.get("/api/invoices/{inv_id}/detail")
def api_invoice_detail(inv_id: int):
    db = SessionLocal()
    try:
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
    finally:
        db.close()

# ========= API summary =========
@app.get("/api/invoices/summary")
def api_invoice_summary(
    granularity: str = Query("day", regex="^(day|month|year)$"),
    start: str | None = None,
    end: str | None = None,
    month: str | None = None,
    year: str | None = None
):
    db = SessionLocal()
    try:
        inv = models.Invoice
        it  = models.InvoiceItem

        j = db.query(
            inv.idx.label("inv_id"),
            inv.invoice_date.label("inv_date"),
            func.sum(it.quantity * it.cf_itempricelevel_price).label("amount")
        ).join(
            it, cast(it.invoice_number, Integer) == inv.idx  # << cast ฝั่ง items ให้เป็น int
        )

        # filters
        if granularity == "day":
            if start:
                j = j.filter(inv.invoice_date >= cast(start, Date))
            if end:
                j = j.filter(inv.invoice_date <= cast(end, Date))
            period_expr = cast(inv.invoice_date, Date)  # จะได้ python date
        elif granularity == "month":
            if month:
                y, m = month.split("-")
                j = j.filter(func.extract("year", inv.invoice_date) == int(y))
                j = j.filter(func.extract("month", inv.invoice_date) == int(m))
            period_expr = func.to_char(inv.invoice_date, "YYYY-MM")
        else:
            if year:
                j = j.filter(func.extract("year", inv.invoice_date) == int(year))
            period_expr = func.to_char(inv.invoice_date, "YYYY")

        # รวมยอดต่อใบก่อน
        q = j.group_by(inv.idx, inv.invoice_date)
        sub = q.subquery()

        # group ต่อ period
        if granularity == "day":
            group_period = cast(sub.c.inv_date, Date)
        elif granularity == "month":
            group_period = func.to_char(sub.c.inv_date, "YYYY-MM")
        else:
            group_period = func.to_char(sub.c.inv_date, "YYYY")

        agg = db.query(
            group_period.label("period"),
            func.count().label("count"),
            func.coalesce(func.sum(sub.c.amount), 0).label("amount")
        ).group_by(group_period).order_by(group_period)

        rows = []
        VAT_RATE = 0.07
        for period, count, amount in agg.all():
            # แปลง period ให้เป็น string เสมอ (กัน date serialize error)
            if hasattr(period, "isoformat"):  # เป็น date/datetime
                period_str = period.isoformat()
            else:
                period_str = str(period)

            discount = 0.0
            before_vat = (amount or 0) - discount
            vat = before_vat * VAT_RATE
            grand = before_vat + vat

            rows.append({
                "period": period_str,
                "count": int(count or 0),
                "amount": float(amount or 0),
                "discount": float(discount),
                "before_vat": float(before_vat),
                "vat": float(vat),
                "grand": float(grand),
            })

        # ใช้ jsonable_encoder กันชนิดพิเศษ
        return JSONResponse(content=jsonable_encoder(rows))
    finally:
        db.close()
                
@app.get("/customers", response_class=HTMLResponse)
async def customer_page(request: Request):
    # load one page table and form 
    return templates.TemplateResponse("customer_form.html", {"request": request})

@app.get("/api/customers/all")
def api_get_customers_all():
    db = SessionLocal()
    rows = db.query(CustomerList).order_by(CustomerList.idx.desc()).all()
    db.close()
    def to_dict(c):
        return {
            "idx": c.idx,
            "prename": c.prename, "sysprename": c.sysprename,
            "fname": c.fname, "lname": c.lname, "sex": c.sex,
            "personid": c.personid, "syspersonid": c.syspersonid,
            "tel": c.tel, "mobile": c.mobile,
            "cf_personaddress_tel": c.cf_personaddress_tel,
            "cf_personaddress_mobile": c.cf_personaddress_mobile,
            "cf_personaddress": c.cf_personaddress,
            "cf_personzipcode": c.cf_personzipcode,
            "cf_provincename": c.cf_provincename,
            "cf_taxid": c.cf_taxid,
            "fmlpaymentcreditday": c.fmlpaymentcreditday
        }
    return JSONResponse([to_dict(c) for c in rows])

# check duplicate (use front)
@app.post("/api/customers/check-duplicate")
async def api_check_duplicate(
    fname: str = Form(None),
    personid: str = Form(None),
    cf_taxid: str = Form(None),
    ignore_idx: int = Form(None)  # if edit skip row
):
    db = SessionLocal()
    q = db.query(CustomerList)
    # duplicate if taxid or (name personid ) match
    cond = or_(
        and_(CustomerList.fname == fname, CustomerList.personid == personid),
        CustomerList.cf_taxid == cf_taxid
    )
    if ignore_idx:
        q = q.filter(CustomerList.idx != ignore_idx)
    exists = db.query(q.filter(cond).exists()).scalar()
    db.close()
    return {"duplicate": bool(exists)}

# add customer 
@app.post("/api/customers")
async def api_create_customer(
    prename: str = Form(None),
    sysprename: str = Form(None),
    fname: str = Form(...),
    lname: str = Form(None),
    personid: str = Form(None),
    tel: str = Form(None),
    mobile: str = Form(None),
    syspersonid: str = Form(None),
    sex: str = Form(None),
    cf_personaddress_tel: str = Form(None),
    cf_personaddress_mobile: str = Form(None),
    cf_personaddress: str = Form(None),
    cf_personzipcode: str = Form(None),
    cf_provincename: str = Form(None),
    cf_taxid: str = Form(None),
    fmlpaymentcreditday: int = Form(None),
    redirect_to_dashboard: str = Form(None) # "1" = save and back to  dashboard
):
    db = SessionLocal()
    # duplicate check
    dup = db.query(CustomerList).filter(
        or_(
            and_(CustomerList.fname == fname, CustomerList.personid == personid),
            CustomerList.cf_taxid == cf_taxid
        )
    ).first()
    if dup:
        db.close()
        raise HTTPException(status_code=409, detail="duplicate (name personid tax_id)")

    c = CustomerList(
        prename=prename, sysprename=sysprename,
        fname=fname, lname=lname, personid=personid, tel=tel, mobile=mobile,
        syspersonid=syspersonid, sex=sex,
        cf_personaddress_tel=cf_personaddress_tel,
        cf_personaddress_mobile=cf_personaddress_mobile,
        cf_personaddress=cf_personaddress, cf_personzipcode=cf_personzipcode,
        cf_provincename=cf_provincename, cf_taxid=cf_taxid,
        fmlpaymentcreditday=fmlpaymentcreditday
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    db.close()

    if redirect_to_dashboard == "1":
        return RedirectResponse(url="/?msg=เพิ่มลูกค้าเรียบร้อยแล้ว", status_code=303)
    return {"message": "created", "idx": c.idx}

# edit customer
@app.post("/api/customers/{idx}")
async def api_update_customer(
    idx: int,
    prename: str = Form(None),
    sysprename: str = Form(None),
    fname: str = Form(...),
    lname: str = Form(None),
    personid: str = Form(None),
    tel: str = Form(None),
    mobile: str = Form(None),
    syspersonid: str = Form(None),
    sex: str = Form(None),
    cf_personaddress_tel: str = Form(None),
    cf_personaddress_mobile: str = Form(None),
    cf_personaddress: str = Form(None),
    cf_personzipcode: str = Form(None),
    cf_provincename: str = Form(None),
    cf_taxid: str = Form(None),
    fmlpaymentcreditday: int = Form(None),
    redirect_to_dashboard: str = Form(None)
):
    db = SessionLocal()
    c = db.query(CustomerList).filter(CustomerList.idx == idx).first()
    if not c:
        db.close()
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลลูกค้า")

    # duplicate check (ยกเว้นตัวเอง)
    dup = db.query(CustomerList).filter(
        CustomerList.idx != idx,
        or_(
            and_(CustomerList.fname == fname, CustomerList.personid == personid),
            CustomerList.cf_taxid == cf_taxid
        )
    ).first()
    if dup:
        db.close()
        raise HTTPException(status_code=409, detail="ข้อมูลซ้ำ (ชื่อ รหัสลูกค้า หรือ เลขภาษี)")

    # update fields
    c.prename = prename
    c.sysprename = sysprename
    c.fname = fname
    c.lname = lname
    c.personid = personid
    c.tel = tel
    c.mobile = mobile
    c.syspersonid = syspersonid
    c.sex = sex
    c.cf_personaddress_tel = cf_personaddress_tel
    c.cf_personaddress_mobile = cf_personaddress_mobile
    c.cf_personaddress = cf_personaddress
    c.cf_personzipcode = cf_personzipcode
    c.cf_provincename = cf_provincename
    c.cf_taxid = cf_taxid
    c.fmlpaymentcreditday = fmlpaymentcreditday

    db.commit()
    db.close()

    if redirect_to_dashboard == "1":
        return RedirectResponse(url="/?msg=แก้ไขลูกค้าเรียบร้อยแล้ว", status_code=303)
    return {"message": "updated"}

# delete customer 
@app.delete("/api/customers/{idx}")
def api_delete_customer(idx: int):
    db = SessionLocal()
    c = db.query(CustomerList).filter(CustomerList.idx == idx).first()
    if not c:
        db.close()
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลลูกค้า")
    db.delete(c)
    db.commit()
    db.close()
    return {"message": "deleted"}

#product management part 
@app.get("/products", response_class=HTMLResponse)
async def products_page(request: Request):
    return templates.TemplateResponse("product_form.html", {"request": request})

# get product all columns 
@app.get("/api/products/all")
def api_get_products_all():
    db = SessionLocal()
    rows = db.query(ProductList).order_by(ProductList.idx.desc()).all()
    db.close()
    return [
        {
            "idx": r.idx,
            "cf_itemid": r.cf_itemid,
            "cf_itemname": r.cf_itemname,
            "cf_unitname": r.cf_unitname,
            "cf_itempricelevel_price": r.cf_itempricelevel_price,
            "cf_items_ordinary": r.cf_items_ordinary,
        } for r in rows
    ]

# check duplicate:cf_itemid and cf_itemname 
@app.post("/api/products/check-duplicate")
async def api_products_check_duplicate(
    cf_itemid: str = Form(None),
    cf_itemname: str = Form(None),
    ignore_idx: int = Form(None),
):
    db = SessionLocal()
    q = db.query(ProductList)
    cond = or_(
        ProductList.cf_itemid == cf_itemid,
        ProductList.cf_itemname == cf_itemname
    )
    if ignore_idx:
        q = q.filter(ProductList.idx != ignore_idx)
    exists = db.query(q.filter(cond).exists()).scalar()
    db.close()
    return {"duplicate": bool(exists)}

# add new product 
@app.post("/api/products")
async def api_create_product(
    cf_itemid: str = Form(...),
    cf_itemname: str = Form(...),
    cf_unitname: str = Form(None),
    cf_itempricelevel_price: float = Form(0),
    cf_items_ordinary: int = Form(None),
    redirect_to_dashboard: str = Form(None),
):
    db = SessionLocal()
    dup = db.query(ProductList).filter(
        or_(ProductList.cf_itemid == cf_itemid, ProductList.cf_itemname == cf_itemname)
    ).first()
    if dup:
        db.close()
        raise HTTPException(status_code=409, detail="ข้อมูลซ้ำ (รหัสหรือชื่อสินค้า)")

    p = ProductList(
        cf_itemid=cf_itemid,
        cf_itemname=cf_itemname,
        cf_unitname=cf_unitname,
        cf_itempricelevel_price=cf_itempricelevel_price,
        cf_items_ordinary=cf_items_ordinary
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    db.close()

    if redirect_to_dashboard == "1":
        return RedirectResponse(url="/?msg=เพิ่มสินค้าสำเร็จ", status_code=303)
    return {"message": "created", "idx": p.idx}

# edit product 
@app.post("/api/products/{idx}")
async def api_update_product(
    idx: int,
    cf_itemid: str = Form(...),
    cf_itemname: str = Form(...),
    cf_unitname: str = Form(None),
    cf_itempricelevel_price: float = Form(0),
    cf_items_ordinary: int = Form(None),
    redirect_to_dashboard: str = Form(None),
):
    db = SessionLocal()
    p = db.query(ProductList).filter(ProductList.idx == idx).first()
    if not p:
        db.close()
        raise HTTPException(status_code=404, detail="ไม่พบสินค้า")

    dup = db.query(ProductList).filter(
        ProductList.idx != idx,
        or_(ProductList.cf_itemid == cf_itemid, ProductList.cf_itemname == cf_itemname)
    ).first()
    if dup:
        db.close()
        raise HTTPException(status_code=409, detail="ข้อมูลซ้ำ (รหัสหรือชื่อสินค้า)")

    p.cf_itemid = cf_itemid
    p.cf_itemname = cf_itemname
    p.cf_unitname = cf_unitname
    p.cf_itempricelevel_price = cf_itempricelevel_price
    p.cf_items_ordinary = cf_items_ordinary

    db.commit()
    db.close()

    if redirect_to_dashboard == "1":
        return RedirectResponse(url="/?msg=แก้ไขสินค้าสำเร็จ", status_code=303)
    return {"message": "updated"}

# delete proudct
@app.delete("/api/products/{idx}")
def api_delete_product(idx: int):
    db = SessionLocal()
    p = db.query(ProductList).filter(ProductList.idx == idx).first()
    if not p:
        db.close()
        raise HTTPException(status_code=404, detail="ไม่พบสินค้า")
    db.delete(p)
    db.commit()
    db.close()
    return {"message": "deleted"}

@app.get("/api/customers")
def get_customers():
    db = SessionLocal()
    customers = db.query(CustomerList).all()
    db.close()
    return JSONResponse(content=[{"id": c.idx, "fname": c.fname, "address": c.cf_personaddress, "taxid": c.cf_taxid} for c in customers])

#get data from productlist 
@app.get("/api/products")
def get_products():
    db = SessionLocal()
    products = db.query(ProductList).all()
    db.close()
    return JSONResponse(content=[
        {
            "code": p.cf_itemid,
            "name": p.cf_itemname,
            "price": p.cf_itempricelevel_price
        }
        for p in products
    ])

#-------------------------------- API Car s&s --------------------------------------------------------# 
@app.get("/car_numberplate.html", response_class=HTMLResponse)
async def car_numberplate_page(request: Request):
    return templates.TemplateResponse("car_numberplate.html", {"request": request})


@app.get("/api/suggest/car_brand")
def suggest_car_brand(q: str = Query(..., min_length=1), limit: int = Query(20, ge=1, le=50)):
    """
    ดึงคำแนะนำยี่ห้อรถ จาก public.car_brand.brand_name
    ใช้กับ <input list="brand_datalist">
    """
    db = SessionLocal()
    try:
        like = f"%{q.lower()}%"
        sql = text("""
            SELECT DISTINCT brand_name
            FROM public.car_brand
            WHERE LOWER(brand_name) LIKE :like
            ORDER BY brand_name
            LIMIT :limit
        """)
        rows = db.execute(sql, {"like": like, "limit": limit}).mappings().all()
        return JSONResponse(content=[{"brand_name": r["brand_name"]} for r in rows])
    finally:
        db.close()


@app.get("/api/suggest/province")
def suggest_province(q: str = Query(..., min_length=1), limit: int = Query(20, ge=1, le=50)):
    """
    ดึงคำแนะนำจังหวัด จาก public.province_nostra.prov_nam_t
    ใช้กับ <input list="province_datalist">
    """
    db = SessionLocal()
    try:
        like = f"%{q.lower()}%"
        sql = text("""
            SELECT DISTINCT prov_nam_t
            FROM public.province_nostra
            WHERE LOWER(prov_nam_t) LIKE :like
            ORDER BY prov_nam_t
            LIMIT :limit
        """)
        rows = db.execute(sql, {"like": like, "limit": limit}).mappings().all()
        return JSONResponse(content=[{"prov_nam_t": r["prov_nam_t"]} for r in rows])
    finally:
        db.close()

# ---------- Cars: list & create (products.ss_car) ----------

class CarCreate(BaseModel):
    number_plate: str
    car_brand: str | None = None
    province: str | None = None


@app.get("/api/cars")
def list_cars(
    search: str = Query("", description="ค้นหาจาก (ทะเบียน/ยี่ห้อ/จังหวัด)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=200),
):
    """
    คืนค่า:
    {
      "items": [{idx, number_plate, car_brand, province}, ...],
      "page": 1, "page_size": 10, "total": 123
    }
    """
    db = SessionLocal()
    try:
        off = (page - 1) * page_size
        like = f"%{(search or '').lower()}%"

        # นับ total
        sql_count = text("""
            SELECT COUNT(*) AS c
            FROM products.ss_car
            WHERE (:s = '' OR LOWER(number_plate) LIKE :like
                           OR LOWER(COALESCE(car_brand,'')) LIKE :like
                           OR LOWER(COALESCE(province,''))   LIKE :like)
        """)
        total = db.execute(sql_count, {"s": search or "", "like": like}).scalar() or 0

        # ดึงรายการ
        sql_list = text("""
            SELECT idx, number_plate, car_brand, province
            FROM products.ss_car
            WHERE (:s = '' OR LOWER(number_plate) LIKE :like
                           OR LOWER(COALESCE(car_brand,'')) LIKE :like
                           OR LOWER(COALESCE(province,''))   LIKE :like)
            ORDER BY idx DESC
            LIMIT :limit OFFSET :off
        """)
        rows = db.execute(sql_list, {
            "s": search or "", "like": like,
            "limit": page_size, "off": off
        }).mappings().all()

        items = [
            {
                "idx": r["idx"],
                "number_plate": r["number_plate"],
                "car_brand": r["car_brand"],
                "province": r["province"],
            } for r in rows
        ]
        return JSONResponse(content={
            "items": items,
            "page": page,
            "page_size": page_size,
            "total": int(total),
        })
    finally:
        db.close()

@app.get("/api/suggest/number_plate")
def suggest_number_plate(
    q: str = Query(..., min_length=1, description="คำค้นทะเบียนรถ"),
    limit: int = Query(20, ge=1, le=50),
):
    """
    ดึงทะเบียนรถจาก products.ss_car.number_plate
    - ค้นหาแบบ case-insensitive ด้วย LIKE
    - ไม่กรองจังหวัด
    """
    db = SessionLocal()
    try:
        like = f"%{q.lower()}%"
        sql = text("""
            SELECT DISTINCT number_plate
            FROM products.ss_car
            WHERE LOWER(number_plate) LIKE :like
            ORDER BY number_plate
            LIMIT :limit
        """)
        rows = db.execute(sql, {"like": like, "limit": limit}).mappings().all()
        return JSONResponse(content=[{"number_plate": r["number_plate"]} for r in rows])
    finally:
        db.close()


@app.post("/api/cars", status_code=201)
def create_car(payload: CarCreate):
    """
    สร้างรถใหม่ใน products.ss_car
    - ถ้าตั้ง unique index (LOWER(number_plate), LOWER(COALESCE(province,''))) ไว้ จะกันซ้ำทะเบียน+จังหวัดได้
    """
    db = SessionLocal()
    try:
        np = (payload.number_plate or "").strip()
        if np == "":
            raise HTTPException(status_code=400, detail="number_plate is required")

        sql_insert = text("""
            INSERT INTO products.ss_car(number_plate, car_brand, province)
            VALUES (:np, :brand, :prov)
            RETURNING idx
        """)
        idx = db.execute(sql_insert, {
            "np": np,
            "brand": (payload.car_brand or "").strip() or None,
            "prov":  (payload.province   or "").strip() or None,
        }).scalar()

        db.commit()
        return {"idx": idx}
    except IntegrityError:
        db.rollback()
        # กรณีมี unique index กันซ้ำไว้
        raise HTTPException(status_code=409, detail="ทะเบียนซ้ำ (ทะเบียน+จังหวัด)")
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@app.put("/api/cars/{idx}")
def update_car(idx: int, payload: CarCreate):
    db = SessionLocal()
    try:
        np = (payload.number_plate or "").strip()
        if np == "":
            raise HTTPException(status_code=400, detail="number_plate is required")

        sql = text("""
            UPDATE products.ss_car
               SET number_plate = :np,
                   car_brand    = :brand,
                   province     = :prov
             WHERE idx = :idx
        """)
        result = db.execute(sql, {
            "np": np,
            "brand": (payload.car_brand or "").strip() or None,
            "prov":  (payload.province   or "").strip() or None,
            "idx": idx
        })
        if result.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=404, detail="not found")

        db.commit()
        return {"ok": True}
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="ทะเบียนซ้ำ (ทะเบียน+จังหวัด)")
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.delete("/api/cars/{idx}", status_code=204)
def delete_car(idx: int):
    db = SessionLocal()
    try:
        result = db.execute(text("DELETE FROM products.ss_car WHERE idx = :idx"), {"idx": idx})
        if result.rowcount == 0:
            db.rollback()
            raise HTTPException(status_code=404, detail="not found")
        db.commit()
        return Response(status_code=204)
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

# invoice api 
@app.get("/api/invoices/check-number")
def api_check_invoice_number(number: str = Query(..., min_length=1)):
    db = SessionLocal()
    try:
        exists = db.query(models.Invoice).filter(models.Invoice.invoice_number == number).first() is not None
        return {"exists": bool(exists)}
    finally:
        db.close()
        
@app.post("/preview", response_class=HTMLResponse)
async def preview(request: Request, payload: dict):
     return templates.TemplateResponse(
        "invoice.html",
        {
            "request": request,   # << ต้องมีเสมอ
            "invoice": payload,   # << ส่งทั้งก้อนเป็น invoice
            "discount": payload.get("discount", 0),
            "vat_rate": payload.get("vat_rate", 7)
        }
     )

@app.get("/export-pdf/{invoice_id}")
async def export_pdf(invoice_id: int):
    invoice = crud.get_invoice(invoice_id)
    pdf_path = pdf_generator.generate_invoice_pdf(invoice)
    return FileResponse(pdf_path, media_type="application/pdf", filename="invoice.pdf")

@app.get("/healthz")
def healthz():
    return {"ok": True}

