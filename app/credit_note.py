# app/credit_note.py
from fastapi import APIRouter, Request, Depends, Body, HTTPException, Query
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, func, text
from datetime import datetime, date
from pathlib import Path
import tempfile, uuid
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
    created_at = Column(Date, default=func.now())
    updated_at = Column(Date, nullable=True)

class CreditNoteItem(Base):
    __tablename__ = "credit_note_item"
    __table_args__ = {"schema": "credits"}
    id = Column(Integer, primary_key=True, autoincrement=True)
    creditnote_number = Column(String, ForeignKey("credits.credit_note.creditnote_number"), index=True)
    grn_number = Column(String)
    invoice_number = Column(String)
    cf_itemid = Column(String(50))
    cf_itemname = Column(String(1000))
    quantity = Column(Float)
    fine = Column(Float)
    price_after_fine = Column(Float)

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

def _to_date(s: str) -> date:
    try: return date.fromisoformat(s)
    except Exception: return datetime.now().date()

def _be_year(ad: int) -> int: return ad + 543

def generate_creditnote_number(db: Session, doc_date: date) -> str:
    # Pattern: SSCR{running}-{DD}{MM}/{YYYY(BE)}
    dd = f"{doc_date.day:02d}"; mm = f"{doc_date.month:02d}"; be = _be_year(doc_date.year)
    suffix = f"-{dd}{mm}/{be}"
    like_pat = f"%/{be}"
    rows = db.query(CreditNote.creditnote_number).filter(CreditNote.creditnote_number.like(like_pat)).all()
    rows = [r[0] for r in rows if r and f"/{be}" in r and f"{mm}/" in r.replace('-', '/')]
    max_run = 0
    for no in rows:
        try:
            head = no.split('-', 1)[0]
            run_str = head.replace("SSCR", "")
            run = int(run_str)
            if run > max_run: max_run = run
        except Exception:
            continue
    next_run = max_run + 1
    return f"SSCR{next_run}{suffix}"

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

    # สร้างข้อมูลสำหรับรายงาน
    rows = []
    sum_reduce_value = 0.0

    # เดิม = base_price = price_after_fine + fine
    for it in items:
        qty   = float(it.quantity or 0)
        fine  = float(it.fine or 0)
        newp  = float(it.price_after_fine or 0)              # ราคาใหม่ (หลังบทปรับ)
        basep = newp + fine                                  # ราคาเดิม (ก่อนหักบทปรับ)
        amt_old = basep * qty
        amt_new = newp  * qty
        rows.append({
            "grn": it.grn_number or "",
            "inv": it.invoice_number or "",
            "desc": it.cf_itemname or "",
            "qty": qty,
            "amt_old": amt_old,
            "amt_new": amt_new
        })
        sum_reduce_value += max(0.0, (amt_old - amt_new))    # ยอดที่ลดลงจริง

    vat = round(sum_reduce_value * 0.07, 2)
    grand = round(sum_reduce_value + vat, 2)

    # วันที่ (พ.ศ.)
    d = head.created_at or datetime.now().date()
    be_date = f"{d.day:02d}/{d.month:02d}/{d.year + 543}"

    # ส่งให้ template credit_note.html (หน้ารายงาน)
    ctx = {
        "request": request,
        "doc_no": head.creditnote_number,
        "doc_date_be": be_date,
        "rows": rows,
        "sum_reduce_value": sum_reduce_value,
        "sum_reduce_vat": vat,
        "sum_total": grand,
        # mock ข้อมูลผู้ขาย/ผู้ซื้อ (แก้เป็นของจริงได้)
        "seller": {
            "name": "บริษัท เอส แอนด์ เอส อินคอม จำกัด",
            "addr": "69 หมู่ 10 ต.พังตรุ อ.พนมทวน จ.กาญจนบุรี 71140",
            "phone": "0888088840",
            "branch": "สำนักงานใหญ่",
            "tax": "0715544000020",
        },
        "buyer": {
            "name": "บริษัท แพนเทอรา เพาเวอร์ แอนด์ แก๊ส จำกัด",
            "addr": "94/1 หมู่ 3 ต.เขาหินซ้อน อ.พนมสารคาม จ.ฉะเชิงเทรา 24120",
            "branch": "สำนักงานใหญ่",
            "tax": "0245554001317",
        },
        "reason": "ราคาสินค้าไม่ถูกต้อง",
    }
    return templates.TemplateResponse("credit_note.html", ctx)

# --- API JSON สำหรับ read / export ---
@router.get("/api/credit-notes/{no}")
def get_credit_note(no: str, db: Session = Depends(get_db)):
    head = db.query(CreditNote).filter(CreditNote.creditnote_number == no).first()
    if not head:
        raise HTTPException(404, "not found")
    items = db.query(CreditNoteItem).filter(CreditNoteItem.creditnote_number == no).all()
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
                "quantity": it.quantity,
                "fine": it.fine,
                "price_after_fine": it.price_after_fine,
            } for it in items
        ]
    }

@router.get("/export-creditnote-pdf")
def export_creditnote_pdf(no: str = Query(...), db: Session = Depends(get_db)):
    # reuse หน้า credit_note.html เป็น HTML รายงาน
    # เรนเดอร์ Template แล้วค่อยแปลง PDF
    # (โหลด css เดิม /static/css/credit_note.css)
    from fastapi import Request
    req = Request(scope={"type": "http"})
    html = credit_note_preview_page(req, no, db)  # TemplateResponse
    html_str = html.body.decode("utf-8")

    css_path = (BASE_DIR / "static" / "css" / "credit_note.css")
    tmp_pdf = Path(tempfile.gettempdir()) / f"credit_note_{no}.pdf"
    HTML(string=html_str, base_url=str(BASE_DIR)).write_pdf(str(tmp_pdf), stylesheets=[CSS(filename=str(css_path))])
    return FileResponse(path=tmp_pdf, media_type="application/pdf", filename=tmp_pdf.name)


@router.get("/api/credit-notes/generate-number")
def api_generate_number(date: str, db: Session = Depends(get_db)):
    d = _to_date(date)
    return {"number": generate_creditnote_number(db, d)}

@router.post("/api/credit-notes")
def create_credit_note(payload: dict = Body(...), db: Session = Depends(get_db)):
    cn_number = (payload.get("creditnote_number") or "").strip()
    cn_date = payload.get("creditnote_date")
    items = payload.get("items") or []
    if not cn_number:
        raise HTTPException(status_code=400, detail="missing creditnote_number")
    if db.query(CreditNote).filter(CreditNote.creditnote_number == cn_number).first():
        raise HTTPException(status_code=409, detail="เลขเอกสารถูกใช้แล้ว")
    head = CreditNote(creditnote_number=cn_number, created_at=_to_date(cn_date))
    db.add(head)
    for it in items:
        db.add(CreditNoteItem(
            creditnote_number=cn_number,
            grn_number=(it.get("grn_number") or "").strip(),
            invoice_number=(it.get("invoice_number") or "").strip(),
            cf_itemid=(it.get("cf_itemid") or "").strip(),
            cf_itemname=(it.get("cf_itemname") or "").strip(),
            quantity=float(it.get("quantity") or 0),
            fine=float(it.get("fine") or 0),
            price_after_fine=float(it.get("price_after_fine") or 0),
))

    db.commit()
    return {"ok": True, "creditnote_number": cn_number}

# ==============================================================================
# START: โค้ดที่แก้ไข
# ==============================================================================
@router.post("/api/credit-notes/preview", response_class=HTMLResponse)
def preview_credit_note(request: Request, payload: dict = Body(...)):
    d = payload or {}
    items = d.get("items") or []

    # ... (โค้ดคำนวณแถวเดิมคงไว้)

    # === ใช้ buyer จาก payload ถ้ามี ===
    buyer = d.get("buyer") or {}
    buyer_name = buyer.get("name") or "บริษัท แพนเทอรา เพาเวอร์ แอนด์ แก๊ส จำกัด"
    buyer_addr = buyer.get("addr") or "94/1 หมู่ 3 ต.เขาหินซ้อน อ.พนมสารคาม จ.ฉะเชิงเทรา 24120"
    buyer_branch = "สำนักงานใหญ่"  # ใส่เพิ่มภายหลังได้หากมีใน payload
    buyer_tax = buyer.get("tax") or "0245554001317"

    # ... (วันที่/เลขที่ เดิม)

    html = f"""
<div class="A4-page">
  <div class="credit-note">
    <div class="cn-title-row"><div></div><div class="cn-title">ใบลดหนี้</div></div>

    <div class="cn-header" style="border-top: var(--border);">
      <div class="cell">
        <div class="cn-store-title">สถานที่ออกเอกสาร</div>
        <div class="cn-kv" style="margin-bottom:6px;">
          <div>ผู้ขาย/ผู้ประกอบการ</div><div>บริษัท เอส แอนด์ เอส อินคอม จำกัด</div>
          <div>ที่อยู่</div><div>69 หมู่ 10 ต.พังตรุ อ.พนมทวน จ.กาญจนบุรี 71140</div>
          <div>โทร.</div><div>0888088840</div>
          <div>สถานประกอบการ</div><div>สำนักงานใหญ่</div>
          <div>เลขประจำตัวผู้เสียภาษี</div><div>0715544000020</div>
        </div>
        <div class="cn-kv">
          <div>ผู้ซื้อ</div><div>{buyer_name}</div>
          <div>ที่อยู่</div><div>{buyer_addr}</div>
          <div>สถานประกอบการ</div><div>{buyer_branch}</div>
          <div>เลขประจำตัวผู้เสียภาษี</div><div>{buyer_tax}</div>
        </div>
      </div>
      <div class="cell">
        <div class="cn-kv"><div>วันที่ออกเอกสาร</div><div>{doc_date_be}</div></div>
      </div>
      <div class="cell">
        <div class="cn-kv"><div>เลขที่</div><div>{doc_no}</div></div>
      </div>
    </div>

    <!-- ตาราง/สรุปเดิม -->
    <table class="cn-table">
      <thead>
        <tr>
          <th style="width:15%;">เลขที่ใบรับสินค้า</th>
          <th style="width:15%;">เลขที่ใบกำกับ</th>
          <th>รายละเอียด</th>
          <th class="num" style="width:12%;">จำนวน</th>
          <th class="num" style="width:15%;">มูลค่าสินค้า/บริการ (เดิม)</th>
          <th class="num" style="width:15%;">มูลค่าสินค้า/บริการ (ใหม่)</th>
        </tr>
      </thead>
      <tbody>
        {table_rows_html}
      </tbody>
    </table>

    <table class="cn-summary">
      <tr><td class="label">มูลค่าที่ปรับปรุงลดลง (บาท)</td><td class="num">{sum_reduce_value:,.2f}</td></tr>
      <tr><td class="label">ภาษีมูลค่าเพิ่มที่ลดลง (บาท)</td><td class="num">{sum_reduce_vat:,.2f}</td></tr>
      <tr><td class="label">รวมเป็นเงินปรับปรุงทั้งสิ้น</td><td class="num">{sum_total:,.2f}</td></tr>
    </table>

    <div class="cn-reason">มีการลดหนี้เนื่องจาก : <span>ราคาสินค้าไม่ถูกต้อง</span></div>
    <div class="cn-signatures">
      <div class="sig-col"><div class="sig-line"></div><div class="sig-label">ผู้ออกเอกสาร</div></div>
      <div class="sig-col"><div class="sig-line"></div><div class="sig-label">ผู้มีอำนาจลงนาม</div></div>
    </div>
    <div class="cn-footnote">ต้นฉบับ - ให้ลูกค้าใช้เป็นใบกำกับภาษี</div>
  </div>
</div>
    """
    return HTMLResponse(content=html)

# ==============================================================================
# END: โค้ดที่แก้ไข
# ==============================================================================

@router.post("/export-creditnote-pdf")
def export_creditnote_pdf(payload: dict = Body(...)):
    base_dir = BASE_DIR
    css_path = base_dir / "static" / "css" / "credit_note.css"

    # เรนเดอร์ HTML จาก preview_credit_note (ซึ่ง "มี" .A4-page แล้ว)
    from fastapi import Request
    dummy_req = Request(scope={"type": "http"})
    html_inner = preview_credit_note(dummy_req, payload).body.decode("utf-8")

    html_str = f'<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body>{html_inner}</body></html>'

    tmp_pdf = Path(tempfile.gettempdir()) / f"credit_note_{payload.get('creditnote_number','document')}.pdf"
    HTML(string=html_str, base_url=str(base_dir)).write_pdf(str(tmp_pdf), stylesheets=[CSS(filename=str(css_path))])
    return FileResponse(path=tmp_pdf, media_type="application/pdf", filename=tmp_pdf.name)

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
    # Join condition per requirement:
    # ss_invoices.invoices.idx = ss_invoices.invoice_items.invoice_number
    sql = text("""
        WITH src AS (
            SELECT inv.invoice_number, it.cf_itemid, it.cf_itemname, it.quantity
            FROM ss_invoices.invoices AS inv
            JOIN ss_invoices.invoice_items AS it
              ON inv.idx::text = it.invoice_number
            WHERE inv.grn_number = :grn
        )
        SELECT
            (SELECT MIN(invoice_number) FROM src) AS invoice_number,
            (SELECT ARRAY_AGG(DISTINCT cf_itemid) FROM src) AS product_codes,
            (SELECT ARRAY_AGG(DISTINCT cf_itemname) FROM src) AS descriptions,
            (SELECT COALESCE(SUM(quantity),0) FROM src) AS quantity_sum
    """)
    row = db.execute(sql, {"grn": grn}).first()
    if not row or row[0] is None:
        return {"invoice_number": None, "product_codes": [], "descriptions": [], "quantity_sum": 0}
    return {
        "invoice_number": row[0],
        "product_codes": row[1] or [],
        "descriptions": row[2] or [],
        "quantity_sum": float(row[3] or 0)
    }

