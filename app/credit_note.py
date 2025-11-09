# app/credit_note.py
from fastapi import APIRouter, Request, Depends, Body, HTTPException, Query
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, func, text
from datetime import datetime, date
from pathlib import Path
import tempfile, uuid

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
    unit_price = Column(Float)

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

@router.get("/credit_note.html", response_class=HTMLResponse)
def credit_note_page(request: Request):
    return templates.TemplateResponse("credit_note.html", {"request": request})

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
            unit_price=float(it.get("unit_price") or 0),
        ))
    db.commit()
    return {"ok": True, "creditnote_number": cn_number}

@router.post("/api/credit-notes/preview", response_class=HTMLResponse)
def preview_credit_note(request: Request, payload: dict = Body(...)):
    d = payload or {}
    items = d.get("items") or []
    total = sum((float(i.get("quantity") or 0) * float(i.get("unit_price") or 0) for i in items), 0.0)
    html = f"""
    <div class="A4-page">
  <div class="credit-note">
    <div class="cn-title-row">
      <div></div><div class="cn-title">ใบลดหนี้</div>
    </div>
    <div class="cn-header" style="border-top: var(--border);">
      <div class="cell">
        <div class="cn-store-title">สถานที่ออกเอกสาร</div>
        <div class="cn-kv" style="margin-bottom:6px;">
          <div>ผู้ขาย/ผู้ประกอบการ</div><div id="seller_name">บริษัท เอส แอนด์ เอส อินคอม จำกัด</div>
          <div>ที่อยู่</div><div id="seller_address">69 หมู่ 10 ตำบลพังตรุ อำเภอพนมทวน จังหวัดกาญจนบุรี 71140</div>
          <div>โทร.</div><div id="seller_phone">0888088840</div>
          <div>สถานประกอบการ</div><div id="seller_branch">สำนักงานใหญ่</div>
          <div>เลขประจำตัวผู้เสียภาษี</div><div id="seller_tax">0715544000020</div>
        </div>
        <div class="cn-kv">
          <div>ผู้ซื้อ</div><div id="buyer_name">บริษัท แพนีน่า เพาเวอร์ แอนด์ แก๊ส จำกัด</div>
          <div>ที่อยู่</div><div id="buyer_address">94/1 หมู่ 3 ต.ควนลัง อ.หาดใหญ่ จ.สงขลา 90110</div>
          <div>สถานประกอบการ</div><div id="buyer_branch">สำนักงานใหญ่</div>
          <div>เลขประจำตัวผู้เสียภาษี</div><div id="buyer_tax">0245554000137</div>
        </div>
      </div>
      <div class="cell">
        <div class="cn-kv"><div>วันที่ออกเอกสาร</div><div id="doc_date">30/08/2568</div></div>
      </div>
      <div class="cell">
        <div class="cn-kv"><div>เลขที่</div><div id="doc_no">SSCR1-30082568</div></div>
      </div>
    </div>

    <table class="cn-table">
      <thead>
        <tr>
          <th style="width:17%;">วันที่</th>
          <th style="width:20%;">ใบกำกับภาษีเดิม เลขที่</th>
          <th>รายละเอียด</th>
          <th class="num" style="width:16%;">มูลค่าสินค้า/บริการ (เดิม)</th>
          <th class="num" style="width:16%;">มูลค่าสินค้า/บริการ (ใหม่)</th>
        </tr>
      </thead>
      <tbody id="cn_rows">
        <tr>
          <td>28/08/2568</td>
          <td>68800085</td>
          <td>ทรายคัดขนาดพิเศษขนาด 0.5 - 1.4 มิลลิเมตร</td>
          <td class="num">28,256.80</td>
          <td class="num">27,360.19</td>
        </tr>
      </tbody>
    </table>

    <table class="cn-summary">
      <tr><td class="label">มูลค่าที่ปรับปรุงลดลง (บาท)</td><td class="num" id="sum_reduce_value">3,042.08</td></tr>
      <tr><td class="label">ภาษีมูลค่าเพิ่มที่ลดลง (บาท)</td><td class="num" id="sum_reduce_vat">212.95</td></tr>
      <tr><td class="label">รวมเป็นเงินจำนวนที่ปรับปรุง</td><td class="num" id="sum_total">3,255.03</td></tr>
    </table>

    <div class="cn-reason">มีการลดหนี้เนื่องจาก : <span id="reason">คัดราคาสินค้าไม่ถูกต้อง</span></div>

    <div class="cn-signatures">
      <div class="sig-col"><div class="sig-line"></div><div class="sig-label">ผู้ออกเอกสาร</div></div>
      <div class="sig-col"><div class="sig-line"></div><div class="sig-label">ผู้มีอำนาจลงนาม</div></div>
    </div>

    <div class="cn-footnote">ต้นฉบับ - ให้ลูกค้าใช้เป็นใบกำกับภาษี</div>
  </div>
</div>
    """
    return HTMLResponse(content=html)

@router.post("/export-creditnote-pdf")
def export_creditnote_pdf(payload: dict = Body(...)):
    base_dir = BASE_DIR
    css_path = base_dir / "static" / "css" / "credit_note.css"
    static_root_uri = (base_dir / "static").as_uri()
    from fastapi import Request
    dummy_req = Request(scope={"type": "http"})
    html_inner = preview_credit_note(dummy_req, payload).body.decode("utf-8")
    html_str = f'''<!DOCTYPE html><html><head><meta charset="utf-8" />
<link rel="stylesheet" href="{static_root_uri}/css/credit_note.css" />
</head><body><div class="A4-page">{html_inner}</div></body></html>'''
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

