# app/credit_note.py
from fastapi import APIRouter, Request, Depends, Body, HTTPException, Query
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, func, text, or_, Numeric
from datetime import datetime, date
from typing import Optional
from pathlib import Path
import tempfile, uuid
from math import ceil 
from . import models  

from .database import SessionLocal, Base
from weasyprint import HTML, CSS
from fastapi.templating import Jinja2Templates

router = APIRouter()
BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

class CreditNote(Base):
    __tablename__ = "credit_note"
    __table_args__ = {"schema": "credits"}
    idx = Column(Integer, primary_key=True, autoincrement=True)
    creditnote_number = Column(String, unique=True, index=True)
    created_at = Column(Date, default=date.today)
    updated_at = Column(Date, nullable=True)

class CreditNoteItem(Base):
    __tablename__ = "credit_note_item"
    __table_args__ = {"schema": "credits"}

    idx = Column(Integer, primary_key=True, autoincrement=True)  

    creditnote_number = Column(
        String,
        ForeignKey("credits.credit_note.creditnote_number"),
        index=True
    )

    grn_number = Column(String)
    invoice_number = Column(String)
    invoice_date = Column(Date)

    sum_quantity = Column("sum_quantity", Float)

    cf_itempricelevel_price = Column(Numeric)

    fine = Column(Float)
    price_after_fine = Column(Float)

    original_amount = Column(Float)
    new_amount = Column(Float)
    original_vat = Column(Float)
    new_vat = Column(Float)
    original_total = Column(Float)
    new_total = Column(Float)
    fine_difference = Column(Float)

    driver_id = Column(String(10))
    first_name = Column(String(64))
    last_name = Column(String(64))
    number_plate = Column(String(20))

    cf_itemid = Column(String(6))
    cf_itemname = Column(String(1000))

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

def _to_date(s: str) -> date:
    try: return date.fromisoformat(s)
    except Exception: return datetime.now().date()

def _be_year(ad: int) -> int: return ad + 543

def generate_creditnote_number(db: Session, doc_date: date) -> str:
    dd = f"{doc_date.day:02d}"
    mm = f"{doc_date.month:02d}"
    be = _be_year(doc_date.year)

    prefix = "SSCR"
    suffix = f"-{dd}{mm}/{be}"

    rows = (
        db.query(CreditNote.creditnote_number)
        .filter(CreditNote.creditnote_number.like(f"{prefix}%/{be}"))
        .all()
    )

    max_run = 0
    for (no,) in rows:
        try:
            run = int(no.replace(prefix, "").split("-", 1)[0])
            max_run = max(max_run, run)
        except Exception:
            pass

    return f"{prefix}{max_run + 1}{suffix}"

# --- PAGES ---
@router.get("/credit_note_form.html", response_class=HTMLResponse)
def credit_note_form_page(request: Request):
    return templates.TemplateResponse("credit_note_form.html", {"request": request})

@router.get("/api/customers/suggest-personid")
def api_cust_suggest_personid(q: str = Query(""), limit: int = Query(10, ge=1, le=50), db: Session = Depends(get_db)):
    q = q.strip()
    qs = db.query(models.CustomerList.personid).filter(models.CustomerList.personid.ilike(f"%{q}%"))\
            .order_by(models.CustomerList.personid.asc()).limit(limit).all()
    return {"items": [r[0] for r in qs if r[0]]}

@router.get("/api/customers/suggest-name")
def api_cust_suggest_name(q: str = Query(""), limit: int = Query(10, ge=1, le=50), db: Session = Depends(get_db)):
    q = q.strip()
    qs = db.query(models.CustomerList.fname).filter(models.CustomerList.fname.ilike(f"%{q}%"))\
            .order_by(models.CustomerList.fname.asc()).limit(limit).all()
    return {"items": [r[0] for r in qs if r[0]]}

@router.get("/api/customers/by-personid")
def api_cust_by_personid(personid: str = Query(...), db: Session = Depends(get_db)):
    c = db.query(models.CustomerList).filter(models.CustomerList.personid == personid).first()
    if not c:
        raise HTTPException(status_code=404, detail="customer not found")
    return {
        "personid": c.personid, "fname": c.fname,
        "tel": c.tel, "mobile": c.mobile,
        "cf_personaddress": c.cf_personaddress,
        "cf_personzipcode": c.cf_personzipcode,
        "cf_provincename": c.cf_provincename,
        "cf_taxid": c.cf_taxid,
    }

@router.get("/api/customers/by-name")
def api_cust_by_name(name: str = Query(...), db: Session = Depends(get_db)):
    c = db.query(models.CustomerList).filter(models.CustomerList.fname == name).first()
    if not c:
        raise HTTPException(status_code=404, detail="customer not found")
    return {
        "personid": c.personid, "fname": c.fname,
        "tel": c.tel, "mobile": c.mobile,
        "cf_personaddress": c.cf_personaddress,
        "cf_personzipcode": c.cf_personzipcode,
        "cf_provincename": c.cf_provincename,
        "cf_taxid": c.cf_taxid,
    }

@router.get("/credit_note.html", response_class=HTMLResponse)
def credit_note_preview_page(request: Request, no: str = Query(...), db: Session = Depends(get_db)):
    # ดึงหัวเอกสาร + รายการ
    head = db.query(CreditNote).filter(CreditNote.creditnote_number == no).first()
    if not head:
        return HTMLResponse("<div style='padding:20px'>ไม่พบเลขที่เอกสาร</div>", status_code=404)

    items = db.query(CreditNoteItem).filter(CreditNoteItem.creditnote_number == no).all()

    # --- map invoice_number -> วันที่ใบกำกับ (พ.ศ.) ---
    inv_date_map: dict[str, str] = {}
    from sqlalchemy import text  # ถ้ายังไม่ได้ import ไว้ข้างบนก็เพิ่มบรรทัดนี้

    for it in items:
        inv_no = (it.invoice_number or "").strip()
        if not inv_no or inv_no in inv_date_map:
            continue
        row = db.execute(
            text("""
                SELECT invoice_date
                FROM ss_invoices.invoices
                WHERE invoice_number = :inv
                LIMIT 1
            """),
            {"inv": inv_no},
        ).first()
        if row and row[0]:
            d = row[0]
            inv_date_map[inv_no] = f"{d.day:02d}/{d.month:02d}/{d.year + 543}"

    # สร้างข้อมูลสำหรับรายงาน
    rows = []
    sum_reduce_value = 0.0

    # เดิม = base_price = price_after_fine + fine
    for it in items:
        qty   = float(it.sum_quantity or 0)
        fine  = float(it.fine or 0)
        newp  = float(it.price_after_fine or 0)              # ราคาใหม่ (หลังบทปรับ)
        basep = newp + fine                                  # ราคาเดิม (ก่อนหักบทปรับ)
        amt_old = basep * qty
        amt_new = newp  * qty

        inv_no = (it.invoice_number or "").strip()
        row_date_be = inv_date_map.get(inv_no, "")

        rows.append({
            "date": row_date_be,               # << ใช้วันที่จาก invoice_date
            "inv": inv_no,
            "desc": it.cf_itemname or "",
            "amt_old": amt_old,
            "amt_new": amt_new
        })
        sum_reduce_value += max(0.0, (amt_old - amt_new))    # ยอดที่ลดลงจริง

    vat = round(sum_reduce_value * 0.07, 2)
    grand = round(sum_reduce_value + vat, 2)

    # ---------- แบ่งหน้า: 10 แถวต่อหน้า ----------
    from math import ceil
    ITEMS_PER_PAGE = 10
    total_pages = max(1, ceil(len(rows) / ITEMS_PER_PAGE)) if rows else 1
    pages = []
    for i in range(total_pages):
        start = i * ITEMS_PER_PAGE
        end = start + ITEMS_PER_PAGE
        pages.append({"rows": rows[start:end]})
    # -----------------------------------------------

    # วันที่เอกสาร (หัวใบลดหนี้) ให้ใช้ created_at เดิม
    d = head.created_at or datetime.now().date()
    be_date = f"{d.day:02d}/{d.month:02d}/{d.year + 543}"

    # ---------------- Buyer จาก DB ----------------
    buyer = None
    try:
        from . import models
        # ใช้ invoice แรกที่มีเลขที่
        first_inv_no = next((it.invoice_number for it in items if it.invoice_number), None)
        if first_inv_no:
            Inv = models.Invoice
            Cust = models.CustomerList
            buyer = (
                db.query(Cust)
                .join(Inv, Inv.personid == Cust.personid)
                .filter(Inv.invoice_number == first_inv_no)
                .first()
            )
    except Exception:
        buyer = None

    if buyer:
        branch_info = "สำนักงานใหญ่" if getattr(buyer, "cf_hq", 0) == 1 else (buyer.cf_branch or "")
        buyer_ctx = {
            "name": buyer.fname or "",
            "addr": buyer.cf_personaddress or "",
            "branch": branch_info,
            "tax": buyer.cf_taxid or "",
        }
    else:
        # fallback ค่าเดิม (กันกรณีหา customer ไม่เจอ)
        buyer_ctx = {
            "name": "—",
            "addr": "",
            "branch": "",
            "tax": "",
        }

    ctx = {
        "request": request,
        "doc_no": head.creditnote_number,
        "doc_date_be": be_date,
        "rows": rows,
        "pages": pages,
        "total_pages": total_pages,
        "sum_reduce_value": sum_reduce_value,
        "sum_reduce_vat": vat,
        "sum_total": grand,

        # Seller fix
        "seller": {
            "name": "บริษัท เอส แอนด์ เอส อินคอม จำกัด",
            "addr": "69 หมู่ 10 ต.พังตรุ อ.พนมทวน จ.กาญจนบุรี 71140",
            "phone": "0888088840",
            "branch": "สำนักงานใหญ่",
            "tax": "0715544000020",
        },

        # Buyer จาก products.customer_list
        "buyer": buyer_ctx,

        # เหตุผล default
        "reason": "คิดราคาสินค้าไม่ถูกต้อง",
    }
    return templates.TemplateResponse("credit_note.html", ctx)

@router.get("/api/credit-notes/generate-number/", response_class=JSONResponse)
def api_generate_number(
    date: str = Query(..., description="วันที่เอกสารรูปแบบ YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    doc_date = _to_date(date)
    number = generate_creditnote_number(db, doc_date)
    return {"number": number}

@router.post("/api/credit-notes")
def create_credit_note(payload: dict = Body(...), db: Session = Depends(get_db)):
    try:
        cn_number = (payload.get("creditnote_number") or "").strip()
        cn_date = payload.get("creditnote_date")
        items = payload.get("items") or []

        if not cn_number:
            raise HTTPException(400, "missing creditnote_number")

        if db.query(CreditNote).filter(
            CreditNote.creditnote_number == cn_number
        ).first():
            raise HTTPException(409, "เลขเอกสารถูกใช้แล้ว")

        head = CreditNote(
            creditnote_number=cn_number,
            created_at=_to_date(cn_date)
        )
        db.add(head)

        for it in items:
            db.add(CreditNoteItem(
                creditnote_number=cn_number,
                grn_number=str(it.get("grn_number") or ""),
                invoice_number=str(it.get("invoice_number") or ""),
                cf_itemid=str(it.get("cf_itemid") or ""),
                cf_itemname=str(it.get("cf_itemname") or ""),
                sum_quantity=float(it.get("quantity") or 0),
                fine=float(it.get("fine") or 0),
                price_after_fine=float(it.get("price_after_fine") or 0),
            ))

        db.commit()
        return {"ok": True, "creditnote_number": cn_number}

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"บันทึกไม่สำเร็จ: {str(e)}"
        )

# --- API JSON สำหรับ read / export ---
@router.get("/api/credit-notes/{no:path}")
def get_credit_note(no: str, db: Session = Depends(get_db)):
    head = db.query(CreditNote).filter(CreditNote.creditnote_number == no).first()
    if not head:
        raise HTTPException(404, "not found")

    items = db.query(CreditNoteItem).filter(
        CreditNoteItem.creditnote_number == no
    ).all()

    # ดึง buyer จาก invoice แรก
    buyer = None
    first_inv = next((i.invoice_number for i in items if i.invoice_number), None)
    if first_inv:
        buyer = (
            db.query(models.CustomerList)
            .join(models.Invoice, models.Invoice.personid == models.CustomerList.personid)
            .filter(models.Invoice.invoice_number == first_inv)
            .first()
        )

    return {
        "head": {
            "creditnote_number": head.creditnote_number,
            "created_at": str(head.created_at or ""),
        },
        "items": [
            {
                "grn_number": it.grn_number,
                "invoice_number": it.invoice_number,
                "cf_itemid": it.cf_itemid,
                "cf_itemname": it.cf_itemname,
                "sum_quantity": it.sum_quantity,
                "fine": it.fine,
                "price_after_fine": it.price_after_fine,
            } for it in items
        ],
        "buyer": {
            "personid": buyer.personid,
            "name": buyer.fname,
            "addr": buyer.cf_personaddress,
            "tax": buyer.cf_taxid,
            "tel": buyer.tel,
            "mobile": buyer.mobile,
            "zipcode": buyer.cf_personzipcode,
            "prov": buyer.cf_provincename,
        } if buyer else None
    }

@router.post("/export-creditnote-pdf")
def export_creditnote_pdf(payload: dict = Body(...), db: Session = Depends(get_db)):
    """
    สร้าง PDF ใบลดหนี้จาก payload เดียว แต่รวมทั้ง "ต้นฉบับ" และ "สำเนา"
    เป็นไฟล์ PDF เดียวกัน (2 หน้า)
    """
    base_dir = BASE_DIR
    css_path = base_dir / "static" / "css" / "credit_note.css"

    # 1) สร้าง context พื้นฐานเหมือน preview (ไม่สน variant ใน payload)
    ctx_common = _build_creditnote_context_from_payload(payload, db)

    # 2) เตรียม template
    try:
        template = templates.env.get_template("credit_note.html")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"template error: {e}")

    # 3) render HTML สองชุด: ต้นฉบับ + สำเนา
    try:
        ctx_original = {**ctx_common, "variant": "creditnote_original"}
        ctx_copy     = {**ctx_common, "variant": "creditnote_copy"}

        html_original = template.render(ctx_original)
        html_copy     = template.render(ctx_copy)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"render error: {e}")

    # 4) รวมเป็น HTML เดียว ใช้ page-break คั่นกลาง
    html_str = (
                "<!DOCTYPE html><html><head><meta charset='utf-8' /></head><body>"
                f"{html_original}"
                f"{html_copy}"
                "</body></html>"
    )

    # 5) เขียนไฟล์ PDF ด้วย WeasyPrint
    try:
        raw_no = (payload.get("creditnote_number") or "document").strip()
        safe_no = (
            raw_no.replace("/", "-")
                  .replace("\\", "-")
                  .replace(" ", "_")
        )
        tmp_pdf = Path(tempfile.gettempdir()) / f"credit_note_{safe_no}.pdf"

        HTML(string=html_str, base_url=str(base_dir)).write_pdf(
            str(tmp_pdf),
            stylesheets=[CSS(filename=str(css_path))]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"weasyprint error: {e}")

    if not tmp_pdf.exists():
        raise HTTPException(status_code=500, detail="PDF file not generated")

    return FileResponse(
        path=tmp_pdf,
        media_type="application/pdf",
        filename=tmp_pdf.name
    )

# ==============================================================================
# START: โค้ดที่แก้ไข
# ==============================================================================
from sqlalchemy import text  # ถ้ายังไม่ได้ import ด้านบนให้เพิ่ม

def _build_creditnote_context_from_payload(payload: dict, db: Session) -> dict:
    d = payload or {}
    items = d.get("items") or []

    # --- วันที่ / เลขที่เอกสาร ---
    date_str = d.get("creditnote_date") or datetime.now().date().isoformat()
    doc_date = _to_date(date_str)
    doc_date_be = f"{doc_date.day:02d}/{doc_date.month:02d}/{doc_date.year + 543}"

    doc_no = (d.get("creditnote_number") or "").strip() or "—"

    # --- map invoice_number -> วันที่ใบกำกับ (พ.ศ.) เหมือน credit_note_preview_page ---
    inv_date_map: dict[str, str] = {}

    for it in items:
        inv_no = (it.get("invoice_number") or "").strip()
        if not inv_no or inv_no in inv_date_map:
            continue
        row = db.execute(
            text("""
                SELECT invoice_date
                FROM ss_invoices.invoices
                WHERE invoice_number = :inv
                LIMIT 1
            """),
            {"inv": inv_no},
        ).first()
        if row and row[0]:
            d_inv = row[0]
            inv_date_map[inv_no] = f"{d_inv.day:02d}/{d_inv.month:02d}/{d_inv.year + 543}"

    # --- คำนวณรายการ เหมือน logic เดิม ---
    rows = []
    sum_reduce_value = 0.0

    for it in items:
        inv_no = (it.get("invoice_number") or "").strip()
        desc   = (it.get("cf_itemname") or "").strip()
        qty    = float(it.get("quantity") or 0)
        fine   = float(it.get("fine") or 0)
        newp   = float(it.get("price_after_fine") or 0)   # ราคาใหม่/หน่วย
        basep  = newp + fine                              # ราคาเดิม/หน่วย

        amt_old = basep * qty
        amt_new = newp  * qty

        row_date_be = inv_date_map.get(inv_no, "")

        rows.append({
            "date": row_date_be,
            "inv": inv_no,
            "desc": desc,
            "amt_old": amt_old,
            "amt_new": amt_new,
        })

        sum_reduce_value += max(0.0, (amt_old - amt_new))

    sum_reduce_vat = round(sum_reduce_value * 0.07, 2)
    sum_total = round(sum_reduce_value + sum_reduce_vat, 2)

    # ---------- แบ่งหน้า: 10 แถวต่อหน้า ----------
    ITEMS_PER_PAGE = 10
    total_pages = max(1, ceil(len(rows) / ITEMS_PER_PAGE)) if rows else 1
    pages = []
    for i in range(total_pages):
        start = i * ITEMS_PER_PAGE
        end = start + ITEMS_PER_PAGE
        pages.append({"rows": rows[start:end]})
    # -------------------------------------------

    # --- buyer จาก payload / DB ---
    buyer_payload = d.get("buyer") or {}
    personid = buyer_payload.get("personid")

    buyer = None
    if personid:
        try:
            from . import models
            c = db.query(models.CustomerList).filter(models.CustomerList.personid == personid).first()
            if c:
                branch_info = "สำนักงานใหญ่" if getattr(c, "cf_hq", 0) == 1 else (c.cf_branch or "")
                buyer = {
                    "name": c.fname or "",
                    "addr": c.cf_personaddress or "",
                    "branch": branch_info,
                    "tax": c.cf_taxid or "",
                }
        except Exception:
            buyer = None

    if not buyer:
        # fallback ใช้ค่าที่มาจากฟอร์ม
        buyer = {
            "name":   buyer_payload.get("name")   or "",
            "addr":   buyer_payload.get("addr")   or "",
            "branch": buyer_payload.get("branch") or "",
            "tax":    buyer_payload.get("tax")    or "",
        }

    # --- seller fixed เดิม ---
    seller = {
        "name":   "บริษัท เอส แอนด์ เอส อินคอม จำกัด",
        "addr":   "69 หมู่ 10 ต.พังตรุ อ.พนมทวน จ.กาญจนบุรี 71140",
        "phone":  "0888088840",
        "branch": "สำนักงานใหญ่",
        "tax":    "0715544000020",
    }

    ctx = {
        "doc_no": doc_no,
        "doc_date_be": doc_date_be,
        "rows": rows,
        "pages": pages,               # ✅ ใช้ใน template
        "total_pages": total_pages,   # ✅ ใช้ใน template
        "sum_reduce_value": sum_reduce_value,
        "sum_reduce_vat": sum_reduce_vat,
        "sum_total": sum_total,
        "seller": seller,
        "buyer": buyer,
        "reason": d.get("reason") or "คิดราคาสินค้าไม่ถูกต้อง",
        "variant": d.get("variant") or "creditnote_original",
    }
    return ctx

@router.post("/api/credit-notes/preview", response_class=HTMLResponse)
def preview_credit_note(request: Request, payload: dict = Body(...), db: Session = Depends(get_db)):
    """
    Preview จาก payload โดยใช้ template credit_note.html จริง
    """
    ctx = _build_creditnote_context_from_payload(payload, db)
    ctx["request"] = request
    return templates.TemplateResponse("credit_note.html", ctx)

# ==============================================================================
# END: โค้ดที่แก้ไข
# ==============================================================================

# -------- GRN APIs --------
@router.get("/api/grn/suggest")
def suggest_grn(q: str = Query(""), limit: int = Query(10, ge=1, le=50), db: Session = Depends(get_db)):
    sql = text("""
        SELECT DISTINCT grn_number
        FROM ss_invoices.invoices
        WHERE grn_number ILIKE :pat
        ORDER BY grn_number
        LIMIT :lim
    """)
    pat = f"%{q.strip()}%" if q else "%"
    rows = db.execute(sql, {"pat": pat, "lim": limit}).fetchall()
    return {"items": [r[0] for r in rows if r[0]]}

@router.get("/api/grn/summary")
def grn_summary(grn: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    sql = text("""
        WITH inv_first AS (
          SELECT invoice_number, personid
          FROM ss_invoices.invoices
          WHERE grn_number = :grn
          ORDER BY invoice_number
          LIMIT 1
        ),
        src AS (
          SELECT it.cf_itemid, it.cf_itemname, it.sum_quantity
          FROM ss_invoices.invoices AS inv
          JOIN ss_invoices.invoice_items AS it
            ON inv.idx::text = it.invoice_number
          WHERE inv.grn_number = :grn
        )
        SELECT
          (SELECT invoice_number FROM inv_first) AS invoice_number_first,
          (SELECT personid FROM inv_first) AS personid_first,
          (SELECT ARRAY_AGG(DISTINCT cf_itemid) FROM src) AS product_codes,
          (SELECT ARRAY_AGG(DISTINCT cf_itemname) FROM src) AS descriptions,
          (SELECT COALESCE(SUM(quantity),0) FROM src) AS quantity_sum
    """)
    row = db.execute(sql, {"grn": grn}).first()
    if not row:
        return {
            "invoice_number": None,
            "personid": None,
            "product_codes": [],
            "descriptions": [],
            "quantity_sum": 0,
            "buyer": None
        }

    invoice_number = row[0]
    personid = row[1]
    product_codes = row[2] or []
    descriptions = row[3] or []
    quantity_sum = float(row[4] or 0)

    # (ออปชัน) map personid -> ข้อมูลลูกค้า (ปรับ model ให้ตรงตารางของคุณ)
    buyer = None
    try:
        from . import models
        c = db.query(models.CustomerList).filter(models.CustomerList.personid == personid).first()
        if c:
            buyer = {
                "personid": c.personid,
                "name": c.fname,
                "addr": c.cf_personaddress,
                "tax": c.cf_taxid,
                "tel": c.tel,
                "mobile": c.mobile,
                "zipcode": c.cf_personzipcode,
                "prov": c.cf_provincename,
            }
    except Exception:
        buyer = None

    return {
        "invoice_number": invoice_number,
        "personid": personid,
        "product_codes": product_codes,
        "descriptions": descriptions,
        "quantity_sum": quantity_sum,
        "buyer": buyer
    }
@router.get("/api/products/price")
def api_product_price(
    code: str = Query(..., min_length=1),
    grn: str | None = Query(None),
    db: Session = Depends(get_db)
):
    """
    คืนราคา/หน่วย (cf_itempricelevel_price) ของรหัสสินค้า (cf_itemid)
    แหล่งข้อมูล: ss_invoices.invoice_items โดย join ss_invoices.invoices
    - ถ้าระบุ grn: เอาราคาจาก invoice ของ GRN นั้นก่อน (ใบล่าสุด)
    - ถ้าไม่พบ: fallback เป็นราคาล่าสุดของรหัสนั้นจากทุกใบ
    """
    # 1) พยายามเอาราคาจาก GRN เดียวกัน (ถ้ามีส่งมา)
    if grn:
        sql_grn = text("""
            SELECT it.cf_itempricelevel_price
            FROM ss_invoices.invoices AS inv
            JOIN ss_invoices.invoice_items AS it
              ON inv.idx::text = it.invoice_number
            WHERE inv.grn_number = :grn
              AND it.cf_itemid = :code
            ORDER BY inv.invoice_date DESC NULLS LAST, inv.invoice_number DESC
            LIMIT 1
        """)
        row = db.execute(sql_grn, {"grn": grn, "code": code}).first()
        if row and row[0] is not None:
            return {"code": code, "price": float(row[0])}

    # 2) fallback: ราคาล่าสุดของรหัสสินค้านี้ (ดูจากวันที่/เลขที่)
    sql_last = text("""
        SELECT it.cf_itempricelevel_price
        FROM ss_invoices.invoices AS inv
        JOIN ss_invoices.invoice_items AS it
          ON inv.idx::text = it.invoice_number
        WHERE it.cf_itemid = :code
        ORDER BY inv.invoice_date DESC NULLS LAST, inv.invoice_number DESC
        LIMIT 1
    """)
    row2 = db.execute(sql_last, {"code": code}).first()
    return {
        "code": code,
        "price": float(row2[0]) if row2 and row2[0] is not None else 0.0
    }


# ====================================================
# SEARCH / DETAIL / UPDATE / DELETE APIs
# ====================================================

@router.get("/api/search-credit-notes")
def search_credit_notes(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """ค้นหาใบลดหนี้ตามช่วงวันที่และคำค้นหา"""
    query = db.query(CreditNote)
    
    if start:
        d_start = _to_date(start)
        if d_start:
            query = query.filter(CreditNote.created_at >= d_start)
    if end:
        d_end = _to_date(end)
        if d_end:
            query = query.filter(CreditNote.created_at <= d_end)
    if q and q.strip():
        search_term = f"%{q.strip()}%"
        query = query.filter(CreditNote.creditnote_number.ilike(search_term))
    
    results = query.order_by(CreditNote.created_at.desc(), CreditNote.creditnote_number.desc()).limit(100).all()
    
    # สร้างผลลัพธ์พร้อมข้อมูลลูกค้าและยอดรวม
    output = []
    for cn in results:
        # ดึงรายการ items
        items = db.query(CreditNoteItem).filter(CreditNoteItem.creditnote_number == cn.creditnote_number).all()
        
        # คำนวณยอดรวม
        total_amount = 0.0
        customer_name = None
        
        for it in items:
            qty = float(it.sum_quantity or 0)
            price_after_fine = float(it.price_after_fine or 0)
            total_amount += qty * price_after_fine
        
        # หาชื่อลูกค้าจาก invoice แรก
        if items:
            first_inv = items[0].invoice_number
            if first_inv:
                inv_row = db.execute(
                    text("SELECT personid FROM ss_invoices.invoices WHERE invoice_number = :inv LIMIT 1"),
                    {"inv": first_inv}
                ).first()
                if inv_row and inv_row[0]:
                    cust = db.query(models.CustomerList).filter(models.CustomerList.personid == inv_row[0]).first()
                    if cust:
                        customer_name = cust.fname
        
        output.append({
            "creditnote_number": cn.creditnote_number,
            "created_at": str(cn.created_at) if cn.created_at else None,
            "customer_name": customer_name,
            "total_amount": round(total_amount, 2),
        })
    
    return output

@router.get("/api/credit-notes/detail")
def get_credit_note_detail(no: str = Query(...), db: Session = Depends(get_db)):
    """ดึงรายละเอียดใบลดหนี้สำหรับแก้ไข (รวมข้อมูลลูกค้า)"""
    head = db.query(CreditNote).filter(CreditNote.creditnote_number == no).first()
    if not head:
        raise HTTPException(404, "not found")
    
    items = db.query(CreditNoteItem).filter(CreditNoteItem.creditnote_number == no).all()
    
    # หาข้อมูลลูกค้าจาก invoice แรก
    buyer = None
    if items:
        first_inv = items[0].invoice_number
        if first_inv:
            inv_row = db.execute(
                text("SELECT personid FROM ss_invoices.invoices WHERE invoice_number = :inv LIMIT 1"),
                {"inv": first_inv}
            ).first()
            if inv_row and inv_row[0]:
                cust = db.query(models.CustomerList).filter(models.CustomerList.personid == inv_row[0]).first()
                if cust:
                    buyer = {
                        "personid": cust.personid,
                        "name": cust.fname,
                        "addr": cust.cf_personaddress,
                        "tax": cust.cf_taxid,
                        "tel": cust.tel,
                        "mobile": cust.mobile,
                        "zipcode": cust.cf_personzipcode,
                        "prov": cust.cf_provincename,
                    }
    
    return {
        "head": {
            "creditnote_number": head.creditnote_number,
            "created_at": str(head.created_at) if head.created_at else None,
        },
        "items": [
            {
                "grn_number": it.grn_number,
                "invoice_number": it.invoice_number,
                "cf_itemid": it.cf_itemid,
                "cf_itemname": it.cf_itemname,
                "quantity": it.sum_quantity,
                "fine": it.fine,
                "price_after_fine": it.price_after_fine,
            } for it in items
        ],
        "buyer": buyer,
    }


@router.put("/api/credit-notes/update")
def update_credit_note(no: str = Query(...), payload: dict = Body(...), db: Session = Depends(get_db)):
    """อัปเดตใบลดหนี้"""
    head = db.query(CreditNote).filter(CreditNote.creditnote_number == no).first()
    if not head:
        raise HTTPException(404, "not found")
    
    # อัปเดตวันที่ (ถ้ามี)
    if payload.get("creditnote_date"):
        head.created_at = _to_date(payload["creditnote_date"])
        head.updated_at = datetime.now().date()
    
    # ลบ items เดิมทั้งหมด
    db.query(CreditNoteItem).filter(CreditNoteItem.creditnote_number == no).delete()
    
    # เพิ่ม items ใหม่
    items = payload.get("items") or []
    for it in items:
        db.add(CreditNoteItem(
            creditnote_number=no,
            grn_number=(it.get("grn_number") or "").strip(),
            invoice_number=(it.get("invoice_number") or "").strip(),
            cf_itemid=(it.get("cf_itemid") or "").strip(),
            cf_itemname=(it.get("cf_itemname") or "").strip(),
            sum_quantity=float(it.get("sum_quantity") or 0),
            fine=float(it.get("fine") or 0),
            price_after_fine=float(it.get("price_after_fine") or 0),
        ))
    
    db.commit()
    return {"ok": True, "creditnote_number": no}


@router.delete("/api/credit-notes/{no:path}")
def delete_credit_note(no: str, db: Session = Depends(get_db)):
    head = db.query(CreditNote).filter(CreditNote.creditnote_number == no).first()
    if not head:
        raise HTTPException(404, "not found")

    db.query(CreditNoteItem).filter(
        CreditNoteItem.creditnote_number == no
    ).delete()

    db.delete(head)
    db.commit()
    return {"ok": True}
