# app/summary_invoices.py
from __future__ import annotations
from typing import Optional, Dict, Any, List
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from .database import SessionLocal
from . import models

router = APIRouter()

# ปรับตามระบบจริงได้ (หรือย้ายไป config)
VAT_RATE = 0.07


# -------------------- DB Session --------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# -------------------- Utils --------------------
def _money(v) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def _iso(d) -> Optional[str]:
    try:
        return d.isoformat() if d else None
    except Exception:
        return None


def _to_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s)  # 'YYYY-MM-DD'
    except Exception:
        return None


# ====================================================
# 1) SUMMARY: /api/invoices/summary
#    - JOIN ด้วยเลขที่บิล (string): invoice_items.invoice_number == invoices.invoice_number
#    - SUM: ใช้ COALESCE(amount, quantity * unit_price)
#    - กรองช่วงเวลาแบบปลอดภัย (parse -> date)
# ====================================================
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

    # label แสดงช่วงเวลา
    if granularity == "day":
        label_expr = func.to_char(inv.invoice_date, 'YYYY-MM-DD')
    elif granularity == "month":
        label_expr = func.to_char(inv.invoice_date, 'YYYY-MM')
    else:
        label_expr = func.to_char(inv.invoice_date, 'YYYY')

    # SUM(COALESCE(amount, quantity*price))
    sum_amount = func.sum(
        func.coalesce(
            itm.amount,
            func.coalesce(itm.quantity, 0) * func.coalesce(itm.cf_itempricelevel_price, 0)
        )
    )

    q = (
        db.query(
            label_expr.label("period"),
            func.count(inv.idx).label("count"),
            func.coalesce(sum_amount, 0).label("amount"),
        )
        .outerjoin(itm, itm.invoice_number == inv.invoice_number)  # << สำคัญ
    )

    # กรองช่วงเวลา
    if granularity == "day":
        d1 = _to_date(start)
        d2 = _to_date(end)
        if d1:
            q = q.filter(inv.invoice_date >= d1)
        if d2:
            q = q.filter(inv.invoice_date <= d2)
    elif granularity == "month":
        # month รูปแบบ 'YYYY-MM'
        if month and len(month) == 7:
            q = q.filter(func.to_char(inv.invoice_date, 'YYYY-MM') == month)
    else:  # year
        if year:
            q = q.filter(func.extract("year", inv.invoice_date) == year)

    q = q.group_by("period").order_by("period")

    out: List[Dict[str, Any]] = []
    for period, count, amount in q.all():
        amount = _money(amount)
        discount = 0.0
        before_vat = amount - discount
        vat = before_vat * VAT_RATE
        grand = before_vat + vat
        out.append({
            "period": period,
            "count": int(count or 0),
            "amount": round(amount, 2),
            "discount": round(discount, 2),
            "before_vat": round(before_vat, 2),
            "vat": round(vat, 2),
            "grand": round(grand, 2),
        })
    return out


# ====================================================
# 2) LIST: /api/invoices
#    - คืนหัวบิลพร้อมยอดรวม/ใบ (ใช้ subquery รวมยอดด้วย invoice_number)
#    - รองรับค้นหา q (invoice_number / fname / po_number)
#    - กรองช่วงเวลาแบบ parse -> date
# ====================================================
@router.get("/api/invoices")
def api_invoices_list(
    start: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD"),
    qtext: Optional[str] = Query(None, alias="q"),
    db: Session = Depends(get_db),
):
    inv = models.Invoice
    itm = models.InvoiceItem

    sub_amount = func.sum(
        func.coalesce(
            itm.amount,
            func.coalesce(itm.quantity, 0) * func.coalesce(itm.cf_itempricelevel_price, 0)
        )
    )

    sub = (
        db.query(
            itm.invoice_number.label("inv_no"),
            func.coalesce(sub_amount, 0).label("amount"),
        )
        .group_by(itm.invoice_number)
        .subquery()
    )

    q = (
        db.query(
            inv.idx,
            inv.invoice_date,
            inv.invoice_number,
            inv.fname,
            inv.po_number,
            func.coalesce(sub.c.amount, 0).label("amount"),
        )
        .outerjoin(sub, sub.c.inv_no == inv.invoice_number)  # << สำคัญ
    )

    d1 = _to_date(start)
    d2 = _to_date(end)
    if d1:
        q = q.filter(inv.invoice_date >= d1)
    if d2:
        q = q.filter(inv.invoice_date <= d2)

    if qtext and qtext.strip():
        pat = f"%{qtext.strip()}%"
        q = q.filter(or_(
            inv.invoice_number.ilike(pat),
            inv.fname.ilike(pat),
            inv.po_number.ilike(pat),
        ))

    q = q.order_by(inv.invoice_date.desc(), inv.idx.desc())

    out: List[Dict[str, Any]] = []
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


# ====================================================
# 3) ITEMS: /api/invoices/{id}/items
#    - รับ id = idx → หาเลขใบกำกับ (string) แล้วดึงรายการ
# ====================================================
@router.get("/api/invoices/{invoice_id}/items")
def api_invoice_items(invoice_id: int, db: Session = Depends(get_db)):
    inv = db.query(models.Invoice).filter(models.Invoice.idx == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="invoice not found")

    it = models.InvoiceItem
    rows = (
        db.query(it)
        .filter(it.invoice_number == inv.invoice_number)  # << ใช้เลขที่บิล (string)
        .order_by(it.idx.asc())
        .all()
    )
    return [
        {
            "cf_itemid": r.cf_itemid,
            "cf_itemname": r.cf_itemname,
            "quantity": _money(r.quantity),
            "unit_price": _money(r.cf_itempricelevel_price),
            "amount": _money(
                r.amount if r.amount is not None
                else _money(r.quantity) * _money(r.cf_itempricelevel_price)
            ),
        }
        for r in rows
    ]


# ====================================================
# 4) DETAIL: /api/invoices/{id}/detail
#    - ดึงหัวบิล (idx) + ดึงรายการด้วยเลขที่บิล (string)
# ====================================================
@router.get("/api/invoices/{invoice_id}/detail")
def api_invoice_detail(invoice_id: int, db: Session = Depends(get_db)):
    inv = db.query(models.Invoice).filter(models.Invoice.idx == invoice_id).first()
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

    it = models.InvoiceItem
    items_q = (
        db.query(it)
        .filter(it.invoice_number == inv.invoice_number)  # << ใช้เลขที่บิล (string)
        .order_by(it.idx.asc())
        .all()
    )
    items = [
        {
            "cf_itemid": r.cf_itemid,
            "cf_itemname": r.cf_itemname,
            "quantity": _money(r.quantity),
            "unit_price": _money(r.cf_itempricelevel_price),
            "amount": _money(
                r.amount if r.amount is not None
                else _money(r.quantity) * _money(r.cf_itempricelevel_price)
            ),
        }
        for r in items_q
    ]
    return {"invoice": invoice, "items": items}


# ====================================================
# 5) UPDATE: /api/invoices/{id} (PUT)
#    - อัปเดตหัวบิล
#    - ลบ/เพิ่ม items ใหม่ทั้งหมด โดยอิงเลขที่บิล (string)
#    - กรณีเปลี่ยนเลขที่บิล: ลบทั้งเลขเดิมและเลขใหม่ก่อนเพิ่ม
# ====================================================
@router.put("/api/invoices/{invoice_id}")
def api_invoice_update(invoice_id: int, payload: Dict[str, Any] = Body(...), db: Session = Depends(get_db)):
    inv = db.query(models.Invoice).filter(models.Invoice.idx == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="invoice not found")

    # เก็บเลขบิลเดิมไว้ก่อน (string)
    old_inv_no = inv.invoice_number

    # อัปเดตหัวบิล (อัปเดตเฉพาะ key ที่ส่งมา)
    head_fields = [
        "invoice_number", "invoice_date", "grn_number", "dn_number", "po_number",
        "fname", "personid", "tel", "mobile", "cf_personaddress", "cf_personzipcode",
        "cf_provincename", "cf_taxid", "fmlpaymentcreditday", "due_date", "car_numberplate"
    ]
    for k in head_fields:
        if k in payload:
            setattr(inv, k, payload[k])

    # ตัดสินใจเลขบิลที่จะใช้กับ items
    new_inv_no = inv.invoice_number or old_inv_no

    # แทนที่รายการสินค้า
    if "items" in payload and isinstance(payload["items"], list):
        # ลบของเดิมออกทั้งเลขเก่าและเลขใหม่ (กันกรณีเปลี่ยนเลขบิล)
        db.query(models.InvoiceItem).filter(models.InvoiceItem.invoice_number == old_inv_no).delete(synchronize_session=False)
        if new_inv_no != old_inv_no:
            db.query(models.InvoiceItem).filter(models.InvoiceItem.invoice_number == new_inv_no).delete(synchronize_session=False)

        # เพิ่มใหม่
        for it in payload["items"]:
            qty = _money(it.get("quantity"))
            price = _money(it.get("unit_price"))
            row = models.InvoiceItem(
                invoice_number=new_inv_no,         # << ใช้เลขบิล (string)
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
