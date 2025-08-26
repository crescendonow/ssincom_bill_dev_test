# app/summary_invoices.py
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_
from .database import SessionLocal
from . import models

router = APIRouter()

VAT_RATE = 0.07  # ใช้ 7% เป็นค่าเริ่มต้น

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ---------- Helpers ----------
def _money(v) -> float:
    return float(v or 0)

def _iso(d) -> Optional[str]:
    return d.isoformat() if d else None

# ---------- 1) SUMMARY: /api/invoices/summary ----------
@router.get("/api/invoices/summary")
def api_invoice_summary(
    granularity: str = Query("day", pattern="^(day|month|year)$"),
    start: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD"),
    month: Optional[str] = Query(None, description="YYYY-MM"),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    db: Session = Depends(get_db),
):
    inv = models.Invoice
    itm = models.InvoiceItem

    # label ช่วงเวลา
    if granularity == "day":
        label_expr = func.to_char(inv.invoice_date, 'YYYY-MM-DD')
    elif granularity == "month":
        label_expr = func.to_char(inv.invoice_date, 'YYYY-MM')
    else:
        label_expr = func.to_char(inv.invoice_date, 'YYYY')

    q = (
        db.query(
            label_expr.label("period"),
            func.count(inv.idx).label("count"),
            func.coalesce(func.sum(itm.amount), 0).label("amount"),
        )
        .outerjoin(itm, itm.invoice_number == inv.idx)
    )

    # เงื่อนไขเวลา
    if granularity == "day":
        if start:
            q = q.filter(inv.invoice_date >= start)
        if end:
            q = q.filter(inv.invoice_date <= end)
    elif granularity == "month":
        # month = 'YYYY-MM'
        if month and len(month) == 7:
            q = q.filter(func.to_char(inv.invoice_date, 'YYYY-MM') == month)
    else:  # year
        if year:
            q = q.filter(func.extract("year", inv.invoice_date) == year)

    q = q.group_by("period").order_by("period")

    rows = []
    for period, count, amount in q.all():
        amount = _money(amount)
        discount = 0.0
        before_vat = amount - discount
        vat = before_vat * VAT_RATE
        grand = before_vat + vat
        rows.append({
            "period": period,
            "count": int(count or 0),
            "amount": round(amount, 2),
            "discount": round(discount, 2),
            "before_vat": round(before_vat, 2),
            "vat": round(vat, 2),
            "grand": round(grand, 2),
        })
    return rows

# ---------- 2) LIST: /api/invoices ----------
@router.get("/api/invoices")
def api_invoices_list(
    start: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD"),
    qtext: Optional[str] = Query(None, alias="q"),
    db: Session = Depends(get_db),
):
    inv = models.Invoice
    itm = models.InvoiceItem

    # สรุปยอดต่อใบ (subquery)
    sub = (
        db.query(
            itm.invoice_number.label("inv_id"),
            func.coalesce(func.sum(itm.amount), 0).label("amount")
        )
        .group_by(itm.invoice_number)
        .subquery()
    )

    q = (
        db.query(
            inv.idx, inv.invoice_date, inv.invoice_number, inv.fname, inv.po_number,
            func.coalesce(sub.c.amount, 0).label("amount")
        )
        .outerjoin(sub, sub.c.inv_id == inv.idx)
    )

    if start:
        q = q.filter(inv.invoice_date >= start)
    if end:
        q = q.filter(inv.invoice_date <= end)
    if qtext and qtext.strip():
        pat = f"%{qtext.strip()}%"
        q = q.filter(or_(inv.invoice_number.ilike(pat), inv.fname.ilike(pat), inv.po_number.ilike(pat)))

    q = q.order_by(inv.invoice_date.desc(), inv.idx.desc())

    out = []
    for idx, invoice_date, invoice_number, fname, po_number, amount in q.all():
        amount = _money(amount)
        discount = 0.0
        before_vat = amount - discount
        vat = before_vat * VAT_RATE
        grand = before_vat + vat
        out.append({
            "idx": idx,
            "invoice_date": _iso(invoice_date),
            "invoice_number": invoice_number,
            "fname": fname,
            "po_number": po_number,
            "amount": round(amount, 2),
            "vat": round(vat, 2),
            "grand": round(grand, 2),
        })
    return out

# ---------- 3) ITEMS: /api/invoices/{id}/items ----------
@router.get("/api/invoices/{invoice_id}/items")
def api_invoice_items(invoice_id: int, db: Session = Depends(get_db)):
    it = models.InvoiceItem
    rows = (
        db.query(it)
        .filter(it.invoice_number == invoice_id)
        .order_by(it.idx.asc())
        .all()
    )
    return [
        {
            "cf_itemid": r.cf_itemid,
            "cf_itemname": r.cf_itemname,
            "quantity": _money(r.quantity),
            "unit_price": _money(r.cf_itempricelevel_price),
            "amount": _money(r.amount),
        }
        for r in rows
    ]

# ---------- 4) DETAIL: /api/invoices/{id}/detail ----------
@router.get("/api/invoices/{invoice_id}/detail")
def api_invoice_detail(invoice_id: int, db: Session = Depends(get_db)):
    inv = (
        db.query(models.Invoice)
        .options(joinedload(models.Invoice.items))
        .filter(models.Invoice.idx == invoice_id)
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="invoice not found")

    invoice = {
        "idx": inv.idx,
        "invoice_number": inv.invoice_number,
        "invoice_date": _iso(inv.invoice_date),
        "grn_number": inv.grn_number,
        "dn_number": inv.dn_number,
        "po_number": inv.po_number,
        "fname": inv.fname,
        "personid": inv.personid,
        "tel": inv.tel,
        "mobile": inv.mobile,
        "cf_personaddress": inv.cf_personaddress,
        "cf_personzipcode": inv.cf_personzipcode,
        "cf_provincename": inv.cf_provincename,
        "cf_taxid": inv.cf_taxid,
        "fmlpaymentcreditday": inv.fmlpaymentcreditday,
        "due_date": _iso(inv.due_date),
        "car_numberplate": inv.car_numberplate,
    }
    items = [
        {
            "cf_itemid": r.cf_itemid,
            "cf_itemname": r.cf_itemname,
            "quantity": _money(r.quantity),
            "unit_price": _money(r.cf_itempricelevel_price),
            "amount": _money(r.amount),
        }
        for r in (inv.items or [])
    ]
    return {"invoice": invoice, "items": items}

# ---------- 5) UPDATE: /api/invoices/{id} (PUT) ----------
@router.put("/api/invoices/{invoice_id}")
def api_invoice_update(invoice_id: int, payload: Dict[str, Any] = Body(...), db: Session = Depends(get_db)):
    inv = db.query(models.Invoice).filter(models.Invoice.idx == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="invoice not found")

    # อัปเดตหัวบิล (อัปเดตเฉพาะ key ที่ส่งมา)
    head_fields = [
        "invoice_number", "invoice_date", "grn_number", "dn_number", "po_number",
        "fname", "personid", "tel", "mobile", "cf_personaddress", "cf_personzipcode",
        "cf_provincename", "cf_taxid", "fmlpaymentcreditday", "due_date", "car_numberplate"
    ]
    for k in head_fields:
        if k in payload:
            setattr(inv, k, payload[k])

    # จัดการรายการสินค้าใหม่ (แทนที่ทั้งหมด)
    if "items" in payload and isinstance(payload["items"], list):
        # ลบทุกรายการเดิมของใบนี้
        db.query(models.InvoiceItem).filter(models.InvoiceItem.invoice_number == invoice_id).delete(synchronize_session=False)
        # เพิ่มรายการใหม่
        for it in payload["items"]:
            qty = float(it.get("quantity") or 0)
            price = float(it.get("unit_price") or 0)
            row = models.InvoiceItem(
                invoice_number=invoice_id,
                personid=inv.personid or None,
                cf_itemid=it.get("cf_itemid"),
                cf_itemname=it.get("cf_itemname"),
                cf_unitname=None,
                cf_itempricelevel_price=price,
                cf_items_ordinary=None,
                quantity=qty,
                amount=qty * price,
            )
            db.add(row)

    db.commit()
    return {"ok": True, "idx": inv.idx}
