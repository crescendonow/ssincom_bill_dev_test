# /app/bill_note.py
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import Optional, List
from datetime import date, datetime
from pydantic import BaseModel

from . import models
from .database import SessionLocal

router = APIRouter()

# --- DB Session ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Helper ---
def _to_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except Exception:
        return None

def generate_next_billnote_number(db: Session):
    """ สร้างเลขที่ใบวางบิล BNTS<YY><MM><NNNNNN> """
    now = datetime.now()
    year_be = now.year + 543
    year_prefix = str(year_be)[-2:]
    month_prefix = f"{now.month:02d}"
    search_prefix = f"BNTS{year_prefix}{month_prefix}"

    latest_bill = (
        db.query(models.BillNote.billnote_number)
        .filter(models.BillNote.billnote_number.like(f"{search_prefix}%"))
        .order_by(models.BillNote.billnote_number.desc())
        .first()
    )

    next_running_number = 1
    if latest_bill and latest_bill[0]:
        try:
            prefix_len = len(search_prefix)
            last_running_str = latest_bill[0][prefix_len:]
            next_running_number = int(last_running_str) + 1
        except (ValueError, IndexError):
            next_running_number = 1

    return f"{search_prefix}{next_running_number:06d}"

# --- Duplicate guard helpers ---

def _used_invoice_numbers(db: Session, exclude_billnote: Optional[str] = None) -> set[str]:
    q = db.query(models.BillNoteItem.invoice_number)
    if exclude_billnote:
        q = q.filter(models.BillNoteItem.billnote_number != exclude_billnote)
    return {r[0] for r in q.all()}

# --- Pydantic payloads ---
class BillNoteItemPayload(BaseModel):
    invoice_number: str
    invoice_date: Optional[date] = None
    due_date: Optional[date] = None
    amount: float

class BillNotePayload(BaseModel):
    customer_id: int
    items: List[BillNoteItemPayload]
    total_amount: float
    bill_date: Optional[date] = None

class BillNoteUpdatePayload(BaseModel):
    items: List[BillNoteItemPayload] = []
    total_amount: Optional[float] = None
    bill_date: Optional[date] = None
    customer_id: Optional[int] = None

# --- APIs ---
@router.get("/api/customers/all")
def get_all_customers(db: Session = Depends(get_db)):
    rows = (
        db.query(models.CustomerList.idx, models.CustomerList.personid, models.CustomerList.fname)
        .order_by(models.CustomerList.fname.asc())
        .limit(5000)
        .all()
    )
    return [
        {
            "idx": idx,
            "personid": personid or "",
            "fname": fname or "",
            "customer_name": (fname or ""),
        }
        for (idx, personid, fname) in rows
    ]

@router.get("/api/billing-notes/{bill_note_number}")
def get_billing_note_details(bill_note_number: str, db: Session = Depends(get_db)):
    bill_note = db.query(models.BillNote).filter(models.BillNote.billnote_number == bill_note_number).first()
    if not bill_note:
        raise HTTPException(status_code=404, detail="Bill Note not found")

    items = (
        db.query(models.BillNoteItem)
        .filter(models.BillNoteItem.billnote_number == bill_note_number)
        .order_by(models.BillNoteItem.invoice_date.asc())
        .all()
    )

    if not items:
        return {
            "customer": {
                "name": bill_note.fname,
                "tax_id": bill_note.cf_taxid,
                "branch": "สำนักงานใหญ่",
                "address": bill_note.cf_personaddress,
                "person_id": bill_note.personid,
            },
            "invoices": [],
            "summary": {"total_amount": 0},
            "bill_note_number": bill_note.billnote_number,
            "bill_date": datetime.now().date().isoformat(),
        }

    invoice_numbers = [it.invoice_number for it in items]

    inv = models.Invoice
    itm = models.InvoiceItem

    target_invoices = (
        db.query(inv.idx, inv.invoice_number)
        .filter(inv.invoice_number.in_(invoice_numbers))
        .all()
    )

    target_idxs_as_str = {str(i.idx) for i in target_invoices}
    target_numbers = {i.invoice_number for i in target_invoices}

    amount_subq = (
        db.query(
            itm.invoice_number,
            func.sum(func.coalesce(itm.quantity, 0) * func.coalesce(itm.cf_itempricelevel_price, 0)).label("sub_total"),
        )
        .filter(or_(itm.invoice_number.in_(target_numbers), itm.invoice_number.in_(target_idxs_as_str)))
        .group_by(itm.invoice_number)
        .subquery()
    )

    amounts_raw = db.query(amount_subq).all()

    invoice_map = {str(i.idx): i.invoice_number for i in target_invoices}
    amounts = {}
    for row in amounts_raw:
        main_no = invoice_map.get(row.invoice_number, row.invoice_number)
        amounts[main_no] = float(row.sub_total or 0)

    invoice_details = []
    total_amount = 0.0
    for it in items:
        sub_total = amounts.get(it.invoice_number, 0.0)
        vat = sub_total * 0.07
        grand_total = sub_total + vat
        total_amount += grand_total
        invoice_details.append(
            {
                "invoice_number": it.invoice_number,
                "invoice_date": it.invoice_date.isoformat() if it.invoice_date else None,
                "due_date": it.due_date.isoformat() if it.due_date else None,
                "amount": round(grand_total, 2),
            }
        )

    customer = db.query(models.CustomerList).filter(models.CustomerList.personid == bill_note.personid).first()
    branch_info = "สำนักงานใหญ่" if not customer or customer.cf_hq == 1 else f"สาขาที่ {customer.cf_branch}"

    return {
        "customer": {
            "name": bill_note.fname,
            "tax_id": bill_note.cf_taxid,
            "branch": branch_info,
            "address": bill_note.cf_personaddress,
            "person_id": bill_note.personid,
        },
        "invoices": invoice_details,
        "summary": {"total_amount": round(total_amount, 2)},
        "bill_note_number": bill_note.billnote_number,
        "bill_date": bill_note.bill_date.isoformat() if bill_note.bill_date else None,
        "payment_duedate": bill_note.payment_duedate.isoformat() if bill_note.payment_duedate else None,
    }

@router.get("/api/billing-note-invoices")
def get_invoices_for_billing_note(
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str = Query(..., description="YYYY-MM-DD"),
    customer_id: int = Query(..., description="Customer IDX from customer_list table"),
    db: Session = Depends(get_db),
):
    """
    ดึงรายการใบกำกับภาษีของลูกค้าในช่วงวันที่ เพื่อนำไปสร้างใบวางบิล
    *จะ **ตัด** invoice ที่ถูกใช้งานแล้วในใบวางบิลอื่น ๆ ออกเสมอ*
    """
    d_start = _to_date(start)
    d_end = _to_date(end)

    customer = db.query(models.CustomerList).filter(models.CustomerList.idx == customer_id).first()
    if not customer:
        return {"error": "Customer not found"}

    inv = models.Invoice
    invoices_query = (
        db.query(inv.idx, inv.invoice_number, inv.invoice_date, inv.due_date)
        .filter(inv.personid == customer.personid, inv.invoice_date.between(d_start, d_end))
        .order_by(inv.invoice_date.asc())
        .all()
    )

    if not invoices_query:
        return {
            "customer": {
                "name": customer.fname,
                "tax_id": customer.cf_taxid,
                "branch": "สำนักงานใหญ่" if customer.cf_hq == 1 else f"สาขาที่ {customer.cf_branch}",
                "address": customer.cf_personaddress,
                "person_id": customer.personid,
            },
            "invoices": [],
            "summary": {"total_amount": 0.0},
        }

    # --- ตัดใบที่ถูกใช้แล้วใน Bill Note อื่น ๆ ---
    used = _used_invoice_numbers(db)
    invoices_query = [r for r in invoices_query if r.invoice_number not in used]

    # ถ้าเหลือว่างหลังตัด ให้ตอบกลับโครงสร้างปกติ
    if not invoices_query:
        return {
            "customer": {
                "name": customer.fname,
                "tax_id": customer.cf_taxid,
                "branch": "สำนักงานใหญ่" if customer.cf_hq == 1 else f"สาขาที่ {customer.cf_branch}",
                "address": customer.cf_personaddress,
                "person_id": customer.personid,
            },
            "invoices": [],
            "summary": {"total_amount": 0.0},
        }

    invoice_numbers = [r.invoice_number for r in invoices_query]
    invoice_idxs_as_str = [str(r.idx) for r in invoices_query]

    itm = models.InvoiceItem
    amount_subq = (
        db.query(
            itm.invoice_number,
            func.sum(func.coalesce(itm.quantity, 0) * func.coalesce(itm.cf_itempricelevel_price, 0)).label("sub_total"),
        )
        .filter(or_(itm.invoice_number.in_(invoice_numbers), itm.invoice_number.in_(invoice_idxs_as_str)))
        .group_by(itm.invoice_number)
        .subquery()
    )

    amounts_raw = db.query(amount_subq).all()
    invoice_map = {str(r.idx): r.invoice_number for r in invoices_query}

    amounts = {}
    for row in amounts_raw:
        main_no = invoice_map.get(row.invoice_number, row.invoice_number)
        amounts[main_no] = float(row.sub_total or 0)

    details, total_amount = [], 0.0
    for inv_row in invoices_query:
        sub_total = amounts.get(inv_row.invoice_number, 0.0)
        vat = sub_total * 0.07
        grand_total = sub_total + vat
        total_amount += grand_total
        details.append(
            {
                "invoice_number": inv_row.invoice_number,
                "invoice_date": inv_row.invoice_date.isoformat() if inv_row.invoice_date else None,
                "due_date": inv_row.due_date.isoformat() if inv_row.due_date else None,
                "amount": round(grand_total, 2),
            }
        )

    return {
        "customer": {
            "name": customer.fname,
            "tax_id": customer.cf_taxid,
            "branch": "สำนักงานใหญ่" if customer.cf_hq == 1 else f"สาขาที่ {customer.cf_branch}",
            "address": customer.cf_personaddress,
            "person_id": customer.personid,
        },
        "invoices": details,
        "summary": {"total_amount": round(total_amount, 2)},
    }

@router.post("/api/billing-notes")
def create_billing_note(payload: BillNotePayload, db: Session = Depends(get_db)):
    customer = db.query(models.CustomerList).filter(models.CustomerList.idx == payload.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Guard: prevent reusing invoices already in any bill
    wanted = {it.invoice_number for it in payload.items}
    used = _used_invoice_numbers(db)
    dup = sorted(list(wanted & used))
    if dup:
        raise HTTPException(status_code=409, detail={"message": "บางใบกำกับถูกใช้ในใบวางบิลอื่นแล้ว", "duplicates": dup})

    new_bill_number = generate_next_billnote_number(db)

    bill_date_today = payload.bill_date
    payment_due = None
    if payload.items:
        latest_invoice_date = max((it.invoice_date for it in payload.items if it.invoice_date), default=None)
        payment_due = latest_invoice_date

    new_bill = models.BillNote(
        billnote_number=new_bill_number,
        bill_date=bill_date_today,
        payment_duedate=payment_due,
        fname=customer.fname,
        personid=customer.personid,
        tel=customer.tel,
        mobile=customer.mobile,
        cf_personaddress=customer.cf_personaddress,
        cf_personzipcode=customer.cf_personzipcode,
        cf_provincename=customer.cf_provincename,
        cf_taxid=customer.cf_taxid,
    )
    db.add(new_bill)

    for it in payload.items:
        db.add(
            models.BillNoteItem(
                billnote_number=new_bill_number,
                invoice_number=it.invoice_number,
                invoice_date=it.invoice_date,
                due_date=it.due_date,
                amount=it.amount,
            )
        )

    db.commit()
    db.refresh(new_bill)
    return {"ok": True, "billnote_number": new_bill.billnote_number, "idx": new_bill.idx}

@router.get("/api/suggest/bill-notes")
def suggest_bill_note_numbers(q: Optional[str] = None, db: Session = Depends(get_db)):
    if not q or len(q.strip()) < 2:
        return []
    search_term = f"%{q.strip()}%"
    query = (
        db.query(models.BillNote.billnote_number)
        .filter(models.BillNote.billnote_number.ilike(search_term))
        .order_by(models.BillNote.billnote_number.desc())
        .limit(10)
    )
    return [r[0] for r in query.all()]

@router.get("/api/search-billing-notes")
def search_billing_notes(start: Optional[str] = None, end: Optional[str] = None, q: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(models.BillNote)
    if start:
        query = query.filter(models.BillNote.bill_date >= _to_date(start))
    if end:
        query = query.filter(models.BillNote.bill_date <= _to_date(end))
    if q:
        search_term = f"%{q.strip()}%"
        query = query.filter(
            or_(
                models.BillNote.billnote_number.ilike(search_term),
                models.BillNote.fname.ilike(search_term),
                models.BillNote.personid.ilike(search_term),
            )
        )
    return query.order_by(models.BillNote.bill_date.desc(), models.BillNote.billnote_number.desc()).limit(100).all()

@router.put("/api/billing-notes/{bill_note_number}")
def update_billing_note(bill_note_number: str, payload: BillNoteUpdatePayload, db: Session = Depends(get_db)):
    bill_note = db.query(models.BillNote).filter(models.BillNote.billnote_number == bill_note_number).first()
    if not bill_note:
        raise HTTPException(status_code=404, detail="Bill Note not found")

    # Guard: prevent reusing invoices that belong to other bills
    wanted = {it.invoice_number for it in payload.items}
    used_elsewhere = _used_invoice_numbers(db, exclude_billnote=bill_note_number)
    dup = sorted(list(wanted & used_elsewhere))
    if dup:
        raise HTTPException(status_code=409, detail={"message": "บางใบกำกับถูกใช้ในใบวางบิลอื่นแล้ว", "duplicates": dup})

    bill_note.bill_date = payload.bill_date or datetime.now().date()
    if payload.items:
        latest_invoice_date = max((it.invoice_date for it in payload.items if it.invoice_date), default=None)
        bill_note.payment_duedate = latest_invoice_date
    else:
        bill_note.payment_duedate = None

    # replace items
    db.query(models.BillNoteItem).filter(models.BillNoteItem.billnote_number == bill_note_number).delete()
    for it in payload.items:
        db.add(
            models.BillNoteItem(
                billnote_number=bill_note_number,
                invoice_number=it.invoice_number,
                invoice_date=it.invoice_date,
                due_date=it.due_date,
                amount=it.amount,
            )
        )

    db.commit()
    return {"ok": True, "billnote_number": bill_note_number}

@router.delete("/api/billing-notes/{bill_note_number}")
def delete_billing_note(bill_note_number: str, db: Session = Depends(get_db)):
    bill_note = db.query(models.BillNote).filter(models.BillNote.billnote_number == bill_note_number).first()
    if not bill_note:
        raise HTTPException(status_code=404, detail="Bill Note not found")
    db.delete(bill_note)
    db.commit()
    return {"ok": True}