# /app/bill_note.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import date

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

# --- API Endpoint ---
@router.get("/api/billing-note-invoices")
def get_invoices_for_billing_note(
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str = Query(..., description="YYYY-MM-DD"),
    customer_id: int = Query(..., description="Customer IDX from customer_list table"),
    db: Session = Depends(get_db)
):
    """
    API สำหรับดึงรายการใบกำกับภาษีของลูกค้าที่กำหนดในช่วงวันที่
    เพื่อนำไปสร้างใบวางบิล
    """
    d_start = _to_date(start)
    d_end = _to_date(end)

    # ดึงข้อมูลลูกค้าก่อน
    customer = db.query(models.CustomerList).filter(models.CustomerList.idx == customer_id).first()
    if not customer:
        return {"error": "Customer not found"}

    # ดึงข้อมูลใบกำกับภาษี
    invoices_query = db.query(
        models.Invoice.invoice_number,
        models.Invoice.invoice_date,
        models.Invoice.due_date
    ).filter(
        models.Invoice.personid == customer.personid,
        models.Invoice.invoice_date >= d_start,
        models.Invoice.invoice_date <= d_end
    ).order_by(models.Invoice.invoice_date.asc())
    
    # คำนวณยอดรวมของแต่ละใบ
    invoice_details = []
    total_amount = 0
    for inv_number, inv_date, due_date in invoices_query.all():
        # Logic คำนวณยอดรวมสุทธิ (grand total) ของแต่ละใบ
        # (ดึงมาจากโค้ด summary_invoices.py ที่เคยทำ)
        itm = models.InvoiceItem
        sub_q = db.query(
            (func.coalesce(itm.quantity, 0) * func.coalesce(itm.cf_itempricelevel_price, 0)).label('amount')
        ).filter(models.InvoiceItem.invoice_number == inv_number)
        
        sub_total = sum(item.amount for item in sub_q.all())
        vat = sub_total * 0.07
        grand_total = sub_total + vat
        total_amount += grand_total
        
        invoice_details.append({
            "invoice_number": inv_number,
            "invoice_date": inv_date.isoformat() if inv_date else None,
            "due_date": due_date.isoformat() if due_date else None,
            "amount": round(grand_total, 2)
        })

    return {
        "customer": {
            "name": customer.fname,
            "tax_id": customer.cf_taxid,
            "branch": "สำนักงานใหญ่" if customer.cf_hq == 1 else f"สาขาที่ {customer.cf_branch}",
            "address": customer.cf_personaddress,
            "person_id": customer.personid
        },
        "invoices": invoice_details,
        "summary": {
            "total_amount": round(total_amount, 2)
        }
    }