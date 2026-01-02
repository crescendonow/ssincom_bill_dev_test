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
        sum_amount.label("before_vat")
    ).outerjoin(
        itm,
        or_(
            itm.invoice_number == inv.invoice_number,
            itm.invoice_number == cast(inv.idx, String)
        )
    ).outerjoin(
        cust,
        cust.personid == inv.personid
    )

    # ---- เงื่อนไขช่วงเวลา ----
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
        cust.cf_hq, cust.cf_branch
    ).order_by(inv.invoice_date.asc(), inv.invoice_number.asc())

    rows = []
    for idx, inv_no, inv_date, company, personid, tax_id, hq, branch, sum_qty, before in q.all():
        qty = float(sum_qty or 0.0)
        before = float(before or 0.0)

        vat = before * VAT_RATE
        grand = before + vat

        branch_text = (
            "สำนักงานใหญ่"
            if (hq == 1 or hq == "1")
            else (f"สาขาที่ {branch}" if branch else "-")
        )

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
