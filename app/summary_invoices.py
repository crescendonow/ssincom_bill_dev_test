# app/summary_invoices.py
from __future__ import annotations
from typing import Optional, Dict, Any, List
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, cast, String

from .database import SessionLocal
from . import models

router = APIRouter()

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
# 1) SUMMARY
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

    # label ตามช่วง
    if granularity == "day":
        label_expr = func.to_char(inv.invoice_date, 'YYYY-MM-DD')
    elif granularity == "month":
        label_expr = func.to_char(inv.invoice_date, 'YYYY-MM')
    else:
        label_expr = func.to_char(inv.invoice_date, 'YYYY')

    # JOIN เผื่อทั้งกรณีอ้างด้วยเลขที่บิล และกรณีอ้างด้วย idx เป็นข้อความ
    join_cond = or_(
        itm.invoice_number == inv.invoice_number,
        itm.invoice_number == cast(inv.idx, String),
    )

    # SUM(COALESCE(amount, quantity * price))
    sum_amount = func.sum(
        func.coalesce(
            itm.amount,
            func.coalesce(itm.quantity, 0) * func.coalesce(itm.cf_itempricelevel_price, 0)
        )
    )

    q = (
        db.query(
            label_expr.label("period"),
            func.count(func.distinct(inv.idx)).label("count"),
            func.coalesce(sum_amount, 0).label("amount"),
        )
        .outerjoin(itm, join_cond)
    )

    # ช่วงเวลา
    if granularity == "day":
        d1 = _to_date(start)
        d2 = _to_date(end)
        if d1:
            q = q.filter(inv.invoice_date >= d1)
        if d2:
            q = q.filter(inv.invoice_date <= d2)
    elif granularity == "month":
        if month and len(month) == 7:
            q = q.filter(func.to_char(inv.invoice_date, 'YYYY-MM') == month)
    else:
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
# 2) รายการใบกำกับ (หัวบิล + ยอดรวมต่อใบ)
# ====================================================
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
    drv = models.Driver

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
            drv.driver_name,
        )
        .outerjoin(
            sub,
            or_(
                sub.c.inv_no == inv.invoice_number,
                sub.c.inv_no == cast(inv.idx, String),
            ),
        )
        .outerjoin(drv, inv.driver_id == drv.driver_id)
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

    results = q.all()
    inv_ids = [row[0] for row in results]
    inv_number_map: Dict[int, str] = {row[0]: row[2] for row in results}

    # Batch-load items for all invoices
    items_by_inv: Dict[int, List[Dict[str, Any]]] = {idx: [] for idx in inv_ids}
    if inv_ids:
        all_inv_numbers = set()
        all_idx_strings = set()
        for _idx in inv_ids:
            inv_no = inv_number_map.get(_idx)
            if inv_no:
                all_inv_numbers.add(inv_no)
            all_idx_strings.add(str(_idx))

        lookup_values = all_inv_numbers | all_idx_strings
        item_rows = (
            db.query(itm)
            .filter(itm.invoice_number.in_(lookup_values))
            .order_by(itm.idx.asc())
            .all()
        )

        inv_no_to_idx: Dict[str, int] = {}
        for _idx in inv_ids:
            inv_no = inv_number_map.get(_idx)
            if inv_no and inv_no not in inv_no_to_idx:
                inv_no_to_idx[inv_no] = _idx
            idx_str = str(_idx)
            if idx_str not in inv_no_to_idx:
                inv_no_to_idx[idx_str] = _idx

        for r in item_rows:
            parent_idx = inv_no_to_idx.get(r.invoice_number)
            if parent_idx is not None and parent_idx in items_by_inv:
                items_by_inv[parent_idx].append({
                    "cf_itemid": r.cf_itemid,
                    "cf_itemname": r.cf_itemname,
                    "quantity": _money(r.quantity),
                    "unit_price": _money(r.cf_itempricelevel_price),
                    "amount": _money(r.amount if r.amount is not None else _money(r.quantity) * _money(r.cf_itempricelevel_price)),
                })

    out: List[Dict[str, Any]] = []
    for idx, invoice_date, invoice_number, fname, po_number, amount, driver_name in results:
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
            "driver_name": driver_name,
            "items": items_by_inv.get(idx, []),
        })
    return out


# ====================================================
# 3) รายการสินค้าในใบเดียว
# ====================================================
@router.get("/api/invoices/{invoice_id}/items")
def api_invoice_items(invoice_id: int, db: Session = Depends(get_db)):
    inv = db.query(models.Invoice).filter(models.Invoice.idx == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="invoice not found")

    it = models.InvoiceItem
    rows = (
        db.query(it)
        .filter(or_(
            it.invoice_number == inv.invoice_number,
            it.invoice_number == cast(inv.idx, String),
        ))
        .order_by(it.idx.asc())
        .all()
    )
    return [
        {
            "cf_itemid": r.cf_itemid,
            "cf_itemname": r.cf_itemname,
            "quantity": _money(r.quantity),
            "unit_price": _money(r.cf_itempricelevel_price),
            "amount": _money(r.amount if r.amount is not None else _money(r.quantity) * _money(r.cf_itempricelevel_price)),
        }
        for r in rows
    ]


# ====================================================
# 4) รายละเอียดใบกำกับ + รายการสินค้า
# ====================================================
@router.get("/api/invoices/{invoice_id}/detail")
def api_invoice_detail(invoice_id: int, db: Session = Depends(get_db)):
    inv = db.query(models.Invoice).filter(models.Invoice.idx == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="invoice not found")

    it = models.InvoiceItem
    items_q = (
        db.query(it)
        .filter(or_(
            it.invoice_number == inv.invoice_number,
            it.invoice_number == cast(inv.idx, String),
        ))
        .order_by(it.idx.asc())
        .all()
    )
    items = [
        {
            "cf_itemid": r.cf_itemid,
            "cf_itemname": r.cf_itemname,
            "quantity": _money(r.quantity),
            "unit_price": _money(r.cf_itempricelevel_price),
            "amount": _money(r.amount if r.amount is not None else _money(r.quantity) * _money(r.cf_itempricelevel_price)),
        }
        for r in items_q
    ]

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
    return {"invoice": invoice, "items": items}


# ====================================================
# 5) อัปเดตบิล + รายการ
# ====================================================
@router.put("/api/invoices/{invoice_id}")
def api_invoice_update(invoice_id: int, payload: Dict[str, Any] = Body(...), db: Session = Depends(get_db)):
    inv = db.query(models.Invoice).filter(models.Invoice.idx == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="invoice not found")

    old_inv_no = inv.invoice_number

    head_fields = [
        "invoice_number", "invoice_date", "grn_number", "dn_number", "po_number",
        "fname", "personid", "tel", "mobile", "cf_personaddress", "cf_personzipcode",
        "cf_provincename", "cf_taxid", "fmlpaymentcreditday", "due_date", "car_numberplate"
    ]
    for k in head_fields:
        if k in payload:
            setattr(inv, k, payload[k])

    new_inv_no = inv.invoice_number or old_inv_no

    if "items" in payload and isinstance(payload["items"], list):
        # ลบของเดิม (เผื่อเคยบันทึกด้วยเลข idx เป็นข้อความ)
        db.query(models.InvoiceItem).filter(
            or_(
                models.InvoiceItem.invoice_number == old_inv_no,
                models.InvoiceItem.invoice_number == cast(inv.idx, String),
                models.InvoiceItem.invoice_number == new_inv_no,
            )
        ).delete(synchronize_session=False)

        for it in payload["items"]:
            qty = _money(it.get("quantity"))
            price = _money(it.get("unit_price"))
            row = models.InvoiceItem(
                invoice_number=new_inv_no,
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