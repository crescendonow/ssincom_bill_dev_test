# /app/bill_note.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List, Dict, Any
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
    """
    สร้างเลขที่ใบวางบิลใหม่ (billnote_number) ตามรูปแบบ BNTS<YY><MM><NNNNNN>
    YY = 2 หลักสุดท้ายของปี พ.ศ.
    MM = เดือนปัจจุบัน (2 หลัก)
    NNNNNN = running number ในเดือนนั้นๆ
    """
    # 1. หาส่วนของปีและเดือนปัจจุบัน
    now = datetime.now()
    year_be = now.year + 543
    year_prefix = str(year_be)[-2:]
    month_prefix = f"{now.month:02d}"
    
    # 2. สร้าง Prefix สำหรับค้นหา เช่น "BNTS6809"
    search_prefix = f"BNTS{year_prefix}{month_prefix}"
    
    # 3. ค้นหารหัสล่าสุดของเดือนนี้
    latest_bill = db.query(models.BillNote.billnote_number)\
        .filter(models.BillNote.billnote_number.like(f"{search_prefix}%"))\
        .order_by(models.BillNote.billnote_number.desc())\
        .first()
        
    next_running_number = 1
    if latest_bill:
        try:
            # ดึงเลข 6 หลักสุดท้ายออกมา แล้ว +1
            last_running_str = latest_bill[0][10:] # BNTS(4) + YY(2) + MM(2) -> index 10
            next_running_number = int(last_running_str) + 1
        except (ValueError, IndexError):
            next_running_number = 1
            
    # 4. สร้างรหัสใหม่โดยเติม 0 ข้างหน้าให้ครบ 6 หลัก
    new_id = f"{search_prefix}{next_running_number:06d}"
    
    return new_id

# --- Pydantic Models for Payload ---
class BillNoteItemPayload(BaseModel):
    invoice_number: str
    invoice_date: Optional[date] = None
    due_date: Optional[date] = None
    amount: float

class BillNotePayload(BaseModel):
    customer_id: int
    bill_date: date
    items: List[BillNoteItemPayload]
    total_amount: float

# --- API Endpoint ---
@router.get("/api/billing-notes/{bill_note_number}")
def get_billing_note_details(bill_note_number: str, db: Session = Depends(get_db)):
    """
    ดึงข้อมูลใบวางบิลที่บันทึกแล้วจากฐานข้อมูลตาม billnote_number
    """
    # 1. ดึงข้อมูลหัวบิล
    bill_note = db.query(models.BillNote).filter(models.BillNote.billnote_number == bill_note_number).first()
    if not bill_note:
        raise HTTPException(status_code=404, detail="Bill Note not found")

    # 2. ดึงรายการใบกำกับภาษีที่อยู่ในบิลนั้น
    items = db.query(models.BillNoteItem).filter(models.BillNoteItem.billnote_number == bill_note_number).order_by(models.BillNoteItem.invoice_date.asc()).all()

    invoice_details = []
    total_amount = 0
    for item in items:
        # คำนวณยอดเงินใหม่จากตาราง invoice_items เพื่อความถูกต้องล่าสุด
        itm = models.InvoiceItem
        sub_q = db.query(
            (func.coalesce(itm.quantity, 0) * func.coalesce(itm.cf_itempricelevel_price, 0)).label('amount')
        ).filter(models.InvoiceItem.invoice_number == item.invoice_number).all()

        sub_total = sum(i.amount for i in sub_q)
        vat = sub_total * 0.07
        grand_total = sub_total + vat
        total_amount += grand_total
        
        invoice_details.append({
            "invoice_number": item.invoice_number,
            "invoice_date": item.invoice_date.isoformat() if item.invoice_date else None,
            "due_date": item.due_date.isoformat() if item.due_date else None,
            "amount": round(grand_total, 2)
        })

    # 3. จัดรูปแบบข้อมูลเพื่อส่งกลับ
    return {
        "customer": {
            "name": bill_note.fname,
            "tax_id": bill_note.cf_taxid,
            "branch": "สำนักงานใหญ่", # หมายเหตุ: ข้อมูลสาขาไม่ได้เก็บใน bill_note, อาจต้องดึงใหม่
            "address": bill_note.cf_personaddress,
            "person_id": bill_note.personid
        },
        "invoices": invoice_details,
        "summary": {
            "total_amount": round(total_amount, 2)
        },
        "bill_note_number": bill_note.billnote_number,
        "bill_date": datetime.now().date().isoformat() # ใช้วันที่ปัจจุบันในการแสดงผล
    }
    
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

@router.post("/api/billing-notes")
def create_billing_note(payload: BillNotePayload, db: Session = Depends(get_db)):
    """
    บันทึกข้อมูลใบวางบิลลงในฐานข้อมูล
    """
    # 1. ดึงข้อมูลลูกค้า
    customer = db.query(models.CustomerList).filter(models.CustomerList.idx == payload.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
        
    # 2. สร้างเลขที่ใบวางบิลใหม่
    new_bill_number = generate_next_billnote_number(db)
    
    # 3. สร้าง Record หลักของใบวางบิล
    new_bill = models.BillNote(
        billnote_number=new_bill_number,
        fname=customer.fname,
        personid=customer.personid,
        tel=customer.tel,
        mobile=customer.mobile,
        cf_personaddress=customer.cf_personaddress,
        cf_personzipcode=customer.cf_personzipcode,
        cf_provincename=customer.cf_provincename,
        cf_taxid=customer.cf_taxid
    )
    db.add(new_bill)
    
    # 4. เพิ่มรายการใบกำกับภาษี
    for item_data in payload.items:
        bill_item = models.BillNoteItem(
            billnote_number=new_bill_number,
            invoice_number=item_data.invoice_number,
            invoice_date=item_data.invoice_date,
            due_date=item_data.due_date,
            amount=item_data.amount
        )
        db.add(bill_item)
        
    db.commit()
    db.refresh(new_bill)
    
    return {"ok": True, "billnote_number": new_bill.billnote_number, "idx": new_bill.idx}