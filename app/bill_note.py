# /app/bill_note.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, cast, String
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
    items: List[BillNoteItemPayload]
    total_amount: float

# --- API Endpoint ---
@router.get("/api/billing-notes/{bill_note_number}")
def get_billing_note_details(bill_note_number: str, db: Session = Depends(get_db)):
    """
    ดึงข้อมูลใบวางบิลที่บันทึกแล้ว (ปรับปรุงใหม่ให้เร็วและถูกต้อง)
    """
    bill_note = db.query(models.BillNote).filter(models.BillNote.billnote_number == bill_note_number).first()
    if not bill_note:
        raise HTTPException(status_code=404, detail="Bill Note not found")

    # --- Step 1: ดึงรายการ invoice number ทั้งหมดในบิล ---
    items = db.query(models.BillNoteItem).filter(
        models.BillNoteItem.billnote_number == bill_note_number
    ).order_by(models.BillNoteItem.invoice_date.asc()).all()

    invoice_numbers_str = [item.invoice_number for item in items]

    if not items:
        # if not data fill base data.
        return {
            "customer": { "name": bill_note.fname, "tax_id": bill_note.cf_taxid, "branch": "สำนักงานใหญ่", "address": bill_note.cf_personaddress, "person_id": bill_note.personid },
            "invoices": [], "summary": { "total_amount": 0 }, "bill_note_number": bill_note.billnote_number, "bill_date": datetime.now().date().isoformat()
        }

    invoice_numbers = [item.invoice_number for item in items]
    
     # --- Step 2: คำนวณยอดรวมของทุกใบใน Query เดียว (ปรับปรุงใหม่) ---
    inv = models.Invoice
    itm = models.InvoiceItem
    
    # Query invoices เพื่อเอา idx มาใช้ join
    target_invoices = db.query(inv.idx, inv.invoice_number).filter(inv.invoice_number.in_(invoice_numbers_str)).all()
    target_invoice_idxs_as_str = {str(i.idx) for i in target_invoices}
    target_invoice_numbers = {i.invoice_number for i in target_invoices}

    amount_subquery = db.query(
        itm.invoice_number,
        func.sum(func.coalesce(itm.quantity, 0) * func.coalesce(itm.cf_itempricelevel_price, 0)).label("sub_total")
    ).filter(
        or_(
            itm.invoice_number.in_(target_invoice_numbers),
            itm.invoice_number.in_(target_invoice_idxs_as_str)
        )
    ).group_by(itm.invoice_number).subquery()
    
    amounts_raw = db.query(amount_subquery).all()
    
    # Map ยอดรวมกลับไปที่ invoice_number หลัก
    amounts = {}
    invoice_map = {str(i.idx): i.invoice_number for i in target_invoices}
    for row in amounts_raw:
        # หาก key คือ idx (ที่เป็น string) ให้ map กลับไปที่ invoice_number จริง
        main_inv_no = invoice_map.get(row.invoice_number, row.invoice_number)
        amounts[main_inv_no] = float(row.sub_total or 0)

    # --- Step 3: ประกอบร่างข้อมูลใน Python ---
    invoice_details = []
    total_amount = 0
    for item in items:
        sub_total = amounts.get(item.invoice_number, 0.0)
        vat = sub_total * 0.07
        grand_total = sub_total + vat
        total_amount += grand_total
        
        invoice_details.append({
            "invoice_number": item.invoice_number,
            "invoice_date": item.invoice_date.isoformat() if item.invoice_date else None,
            "due_date": item.due_date.isoformat() if item.due_date else None,
            "amount": round(grand_total, 2)
        })
        
    # ดึงข้อมูลลูกค้าล่าสุดเพื่อความถูกต้องของ "สาขา"
    customer = db.query(models.CustomerList).filter(models.CustomerList.personid == bill_note.personid).first()
    branch_info = "สำนักงานใหญ่"
    if customer and customer.cf_hq == 0:
        branch_info = f"สาขาที่ {customer.cf_branch}"

    return {
        "customer": {
            "name": bill_note.fname, "tax_id": bill_note.cf_taxid, "branch": branch_info,
            "address": bill_note.cf_personaddress, "person_id": bill_note.personid
        },
        "invoices": invoice_details, 
        "summary": { "total_amount": round(total_amount, 2) },
        "bill_note_number": bill_note.billnote_number, 
        "bill_date": bill_note.bill_date.isoformat() if bill_note.bill_date else None, 
        "payment_duedate": bill_note.payment_duedate.isoformat() if bill_note.payment_duedate else None 
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

    # --- Step 1: ดึงใบกำกับภาษีที่ต้องการทั้งหมดใน Query เดียว ---
    inv = models.Invoice
    invoices_query = db.query(
        inv.idx, # <--- ดึง idx มาด้วย
        inv.invoice_number,
        inv.invoice_date,
        inv.due_date
    ).filter(
        inv.personid == customer.personid,
        inv.invoice_date.between(d_start, d_end)
    ).order_by(inv.invoice_date.asc()).all()

    if not invoices_query:
        # ... (โค้ด Return ค่าว่างเหมือนเดิม) ...
        pass

    invoice_numbers = [inv.invoice_number for inv in invoices_query]
    invoice_idxs_as_str = [str(inv.idx) for inv in invoices_query] # <--- สร้าง list ของ idx ที่เป็น string

    # --- Step 2: คำนวณยอดรวมของทุกใบใน Query เดียว (ปรับปรุงใหม่) ---
    itm = models.InvoiceItem
    amount_subquery = db.query(
        itm.invoice_number,
        func.sum(func.coalesce(itm.quantity, 0) * func.coalesce(itm.cf_itempricelevel_price, 0)).label("sub_total")
    ).filter(
        or_(
            itm.invoice_number.in_(invoice_numbers),
            itm.invoice_number.in_(invoice_idxs_as_str) # <--- เพิ่มเงื่อนไขค้นหาด้วย idx ที่เป็น string
        )
    ).group_by(itm.invoice_number).subquery()
    
    amounts_raw = db.query(amount_subquery).all()

    # Map ผลลัพธ์กลับไปที่ invoice_number หลัก (เผื่อ join เจอด้วย idx)
    amounts = {}
    invoice_map = {str(inv.idx): inv.invoice_number for inv in invoices_query}
    for row in amounts_raw:
        main_inv_no = invoice_map.get(row.invoice_number, row.invoice_number)
        amounts[main_inv_no] = float(row.sub_total or 0)

    # --- Step 3: ประกอบร่างข้อมูลใน Python (ปรับปรุงเล็กน้อย) ---
    invoice_details = []
    total_amount = 0
    for inv in invoices_query:
        # ใช้ inv.invoice_number เป็น key หลักในการดึงยอด
        sub_total = amounts.get(inv.invoice_number, 0.0)
        vat = sub_total * 0.07
        grand_total = sub_total + vat
        total_amount += grand_total
        
        invoice_details.append({
            "invoice_number": inv.invoice_number,
            "invoice_date": inv.invoice_date.isoformat() if inv.invoice_date else None,
            "due_date": inv.due_date.isoformat() if inv.due_date else None,
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
        "summary": { "total_amount": round(total_amount, 2) }
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

    bill_date_today = datetime.now().date()
    payment_due = None
    if payload.items:
        latest_invoice_date = max(item.invoice_date for item in payload.items if item.invoice_date)
        payment_due = latest_invoice_date
    
    # 3. สร้าง Record หลักของใบวางบิล
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

@router.get("/api/suggest/bill-notes")
def suggest_bill_note_numbers(q: Optional[str] = None, db: Session = Depends(get_db)):
    """
    API สำหรับค้นหา billnote_number เพื่อใช้ใน Autocomplete
    """
    if not q or len(q.strip()) < 2:
        return []
        
    search_term = f"%{q.strip()}%"
    query = db.query(models.BillNote.billnote_number)\
        .filter(models.BillNote.billnote_number.ilike(search_term))\
        .order_by(models.BillNote.billnote_number.desc())\
        .limit(10)
        
    # [r[0] for r in query.all()] เพื่อดึงค่า string ออกมาจาก tuple
    return [r[0] for r in query.all()]

#------------------- API Search ---------------------#
@router.get("/api/search-billing-notes")
def search_billing_notes(
    start: Optional[str] = None,
    end: Optional[str] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db)
):
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
                models.BillNote.personid.ilike(search_term)
            )
        )
    
    results = query.order_by(models.BillNote.bill_date.desc(), models.BillNote.billnote_number.desc()).limit(100).all()
    return results

#------------------- API update bill ---------------------#
@router.put("/api/billing-notes/{bill_note_number}")
def update_billing_note(bill_note_number: str, payload: BillNotePayload, db: Session = Depends(get_db)):
    # ตรวจสอบว่ามี Bill Note นี้อยู่จริง
    bill_note = db.query(models.BillNote).filter(models.BillNote.billnote_number == bill_note_number).first()
    if not bill_note:
        raise HTTPException(status_code=404, detail="Bill Note not found")

    bill_note.bill_date = datetime.now().date()
    if payload.items:
        # หา invoice_date ล่าสุดจากรายการ items
        latest_invoice_date = max(item.invoice_date for item in payload.items if item.invoice_date)
        bill_note.payment_duedate = latest_invoice_date
    else:
        bill_note.payment_duedate = None

    # ลบรายการเก่าทั้งหมด
    db.query(models.BillNoteItem).filter(models.BillNoteItem.billnote_number == bill_note_number).delete()

    # เพิ่มรายการใหม่เข้าไป
    for item_data in payload.items:
        bill_item = models.BillNoteItem(
            billnote_number=bill_note_number,
            invoice_number=item_data.invoice_number,
            invoice_date=item_data.invoice_date,
            due_date=item_data.due_date,
            amount=item_data.amount
        )
        db.add(bill_item)
    
    db.commit()
    return {"ok": True, "billnote_number": bill_note_number}

#------------------- API delete bill ---------------------#
@router.delete("/api/billing-notes/{bill_note_number}")
def delete_billing_note(bill_note_number: str, db: Session = Depends(get_db)):
    bill_note = db.query(models.BillNote).filter(models.BillNote.billnote_number == bill_note_number).first()
    if not bill_note:
        raise HTTPException(status_code=404, detail="Bill Note not found")
        
    # Cascade delete จะลบ items ที่เกี่ยวข้องโดยอัตโนมัติ
    db.delete(bill_note)
    db.commit()
    return {"ok": True}

