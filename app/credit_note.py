# app/credit_note.py
from fastapi import APIRouter, Request, Depends, Body, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, func
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
    <div class="p-6">
      <div class="flex justify-between items-start">
        <div>
          <h2 class="text-2xl font-bold">ใบลดหนี้ (Credit Note)</h2>
          <p class="text-sm text-gray-600">บริษัท เอส แอนด์ เอส อินคอม จำกัด</p>
        </div>
        <div class="text-right">
          <p><b>เลขที่:</b> {d.get('creditnote_number','')}</p>
          <p><b>วันที่:</b> {d.get('creditnote_date','')}</p>
        </div>
      </div>
      <table class="w-full text-sm border-collapse mt-4">
        <thead>
          <tr class="border-y-2 border-black">
            <th class="p-2 text-left">GRN</th>
            <th class="p-2 text-left">Invoice</th>
            <th class="p-2 text-left">รหัส</th>
            <th class="p-2 text-left">รายละเอียด</th>
            <th class="p-2 text-right">จำนวน</th>
            <th class="p-2 text-right">ราคา/หน่วย</th>
            <th class="p-2 text-right">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {''.join([
            f"<tr class='border-b'><td class='p-2'>{i.get('grn_number','')}</td><td class='p-2'>{i.get('invoice_number','')}</td><td class='p-2'>{i.get('cf_itemid','')}</td><td class='p-2'>{i.get('cf_itemname','')}</td><td class='p-2 text-right'>{float(i.get('quantity') or 0):,.2f}</td><td class='p-2 text-right'>{float(i.get('unit_price') or 0):,.2f}</td><td class='p-2 text-right'>{(float(i.get('quantity') or 0)*float(i.get('unit_price') or 0)):,.2f}</td></tr>"
            for i in items
          ])}
        </tbody>
        <tfoot>
          <tr class="border-t-2 border-black font-bold">
            <td colspan="6" class="p-2 text-right">รวมเป็นเงิน</td>
            <td class="p-2 text-right">{total:,.2f}</td>
          </tr>
        </tfoot>
      </table>
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
        FROM ss_invoices.invoice_items
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
        WITH src AS (
            SELECT invoice_number, cf_itemid, cf_itemname, quantity
            FROM ss_invoices.invoice_items
            WHERE grn_number = :grn
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
