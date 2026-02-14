# /app/saletax_report.py
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, cast, String, case
from typing import Optional, List
from datetime import date, datetime

from . import models
from .database import SessionLocal

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def _to_date(s: Optional[str]) -> Optional[date]:
    if not s: return None
    try:
        return date.fromisoformat(s)
    except Exception:
        return None

VAT_RATE = 0.07

# -------- รายการใบกำกับ (ละเอียด) ภายในช่วง --------
@router.get("/api/saletax/list")
def saletax_list(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    month: Optional[str] = Query(None),   # YYYY-MM
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    inv = models.Invoice
    itm = models.InvoiceItem
    cust = models.CustomerList
    drv = models.Driver

    qty_in_ton = func.sum(
    case(
        (itm.quantity >= 1000, func.coalesce(itm.quantity, 0) / 1000.0),
        else_=func.coalesce(itm.quantity, 0)
        )
    ).label("sum_qty")

    sum_amount = func.sum(
        func.coalesce(
            itm.amount,
            func.coalesce(itm.quantity, 0) * func.coalesce(itm.cf_itempricelevel_price, 0)
        )
    )

    q = db.query(
        inv.idx,
        inv.invoice_number,
        inv.invoice_date,
        inv.fname.label("company"),
        inv.personid,
        func.coalesce(inv.cf_taxid, cust.cf_taxid).label("tax_id"),
        cust.cf_hq.label("hq"),
        cust.cf_branch.label("branch"),
        qty_in_ton,
        sum_amount.label("before_vat"),
        func.concat(
            func.coalesce(drv.prefix, ''), ' ',
            func.coalesce(drv.first_name, ''), ' ',
            func.coalesce(drv.last_name, '')
        ).label("driver_name"),
    ).outerjoin(
        itm,
        or_(
            itm.invoice_number == inv.invoice_number,
            itm.invoice_number == cast(inv.idx, String)
        )
    ).outerjoin(
        cust,
        cust.personid == inv.personid
    ).outerjoin(
        drv,
        inv.driver_id == drv.driver_id
    )

    if month and len(month) == 7:
        q = q.filter(func.to_char(inv.invoice_date, 'YYYY-MM') == month)
    elif year:
        q = q.filter(func.extract('year', inv.invoice_date) == year)
    else:
        d1, d2 = _to_date(start), _to_date(end)
        if d1:
            q = q.filter(inv.invoice_date >= d1)
        if d2:
            q = q.filter(inv.invoice_date <= d2)

    q = q.group_by(
        inv.idx, inv.invoice_number, inv.invoice_date,
        inv.fname, inv.personid,
        func.coalesce(inv.cf_taxid, cust.cf_taxid),
        cust.cf_hq, cust.cf_branch,
        drv.prefix, drv.first_name, drv.last_name
    ).order_by(inv.invoice_date.asc(), inv.invoice_number.asc())

    results = q.all()

    # Batch-load items
    inv_ids = [r[0] for r in results]
    inv_number_map = {r[0]: r[1] for r in results}

    items_by_inv = {idx: [] for idx in inv_ids}
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

        inv_no_to_idx = {}
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
                })

    rows = []
    for idx, inv_no, inv_date, company, personid, tax_id, hq, branch, sum_qty, before, driver_name in results:
        qty = float(sum_qty or 0.0)
        before = float(before or 0.0)
        vat = before * VAT_RATE
        grand = before + vat

        branch_text = (
            "\u0e2a\u0e33\u0e19\u0e31\u0e01\u0e07\u0e32\u0e19\u0e43\u0e2b\u0e0d\u0e48"
            if (hq == 1 or hq == "1")
            else (f"\u0e2a\u0e32\u0e02\u0e32\u0e17\u0e35\u0e48 {branch}" if branch else "-")
        )

        drv_name = (driver_name or "").strip()
        if not drv_name or drv_name.replace(" ", "") == "":
            drv_name = "-"

        rows.append({
            "idx": idx,
            "invoice_number": inv_no,
            "invoice_date": inv_date.isoformat() if inv_date else None,
            "company": company,
            "personid": personid,
            "cf_taxid": tax_id,
            "cf_hq": hq,
            "cf_branch": branch,
            "branch_text": branch_text,
            "sum_qty": round(qty, 3),
            "before_vat": round(before, 2),
            "vat": round(vat, 2),
            "grand": round(grand, 2),
            "driver_name": drv_name,
            "items": items_by_inv.get(idx, []),
        })

    return rows

# -------- สรุปยอดต่อช่วง (ไม่แยก/แยกบริษัท) --------
@router.get("/api/saletax/summary")
def saletax_summary(
    granularity: str = Query("day", pattern="^(day|month|year)$"),
    start: Optional[str] = Query(None), end: Optional[str] = Query(None),
    month: Optional[str] = Query(None), year: Optional[int] = Query(None),
    split_by_company: bool = Query(False),
    db: Session = Depends(get_db)
):
    inv = models.Invoice
    itm = models.InvoiceItem

    if granularity == "day":
        label_expr = func.to_char(inv.invoice_date, 'YYYY-MM-DD')
    elif granularity == "month":
        label_expr = func.to_char(inv.invoice_date, 'YYYY-MM')
    else:
        label_expr = func.to_char(inv.invoice_date, 'YYYY')

    join_cond = or_(
        itm.invoice_number == inv.invoice_number,
        itm.invoice_number == cast(inv.idx, String)
    )
    sum_amount = func.sum(
        func.coalesce(itm.amount, func.coalesce(itm.quantity,0) * func.coalesce(itm.cf_itempricelevel_price,0))
    )

    cols = [label_expr.label("period")]
    if split_by_company:
        cols.append(inv.fname.label("company"))
    cols += [
        func.count(func.distinct(inv.idx)).label("count"),
        func.coalesce(sum_amount, 0).label("before_vat")
    ]

    q = db.query(*cols).outerjoin(itm, join_cond)

    # filter
    if granularity == "day":
        d1, d2 = _to_date(start), _to_date(end)
        if d1: q = q.filter(inv.invoice_date >= d1)
        if d2: q = q.filter(inv.invoice_date <= d2)
    elif granularity == "month":
        if month and len(month) == 7:
            q = q.filter(func.to_char(inv.invoice_date, 'YYYY-MM') == month)
    else:
        if year:
            q = q.filter(func.extract('year', inv.invoice_date) == year)

    groups = ["period"] + (["company"] if split_by_company else [])
    q = q.group_by(*groups).order_by(*groups)

    out = []
    for row in q.all():
        if split_by_company:
            period, company, count, before = row
        else:
            period, count, before = row
            company = None
        before = float(before or 0)
        vat = before * VAT_RATE
        grand = before + vat
        out.append({
            "period": period,
            "company": company,
            "count": int(count or 0),
            "before_vat": round(before,2),
            "vat": round(vat,2),
            "grand": round(grand,2),
        })
    return out