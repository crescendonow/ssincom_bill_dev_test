# app/drivers_form.py
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import or_, Column, String
from .database import SessionLocal, Base

from datetime import date
from sqlalchemy import func
from . import models  # ต้องมี models.Invoice และ models.InvoiceItem อยู่แล้ว

VAT_RATE = 0.07

router = APIRouter()

class Driver(Base):
    __tablename__ = "drivers"
    __table_args__ = {"schema": "products"}
    driver_id = Column(String(8), primary_key=True, index=True)  # D0001
    citizen_id = Column(String(13), unique=True, index=True, nullable=False)
    prefix = Column(String(16))
    first_name = Column(String(64), nullable=False)
    last_name = Column(String(64), nullable=False)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class DriverIn(BaseModel):
    citizen_id: str
    prefix: Optional[str] = ""
    first_name: str
    last_name: str

    @field_validator("citizen_id")
    @classmethod
    def validate_citizen_id(cls, v: str) -> str:
        v = "".join(ch for ch in v if ch.isdigit())
        if len(v) != 13:
            raise ValueError("citizen_id ต้องมี 13 หลัก")
        return v

class DriverOut(BaseModel):
    driver_id: str
    citizen_id: str
    prefix: Optional[str] = ""
    first_name: str
    last_name: str

def gen_sequential_driver_id(db: Session) -> str:
    row = (
        db.query(Driver.driver_id)
        .filter(Driver.driver_id.like("D%"))
        .order_by(Driver.driver_id.desc())
        .first()
    )
    if not row or not row[0] or not row[0].startswith("D"):
        nxt = 1
    else:
        try:
            nxt = int(row[0][1:]) + 1
        except ValueError:
            nxt = 1
    return f"D{nxt:04d}"

@router.get("/api/drivers")
def list_drivers(
    search: str = Query("", description="ค้นหา (ชื่อ/สกุล/เลขบัตร)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db)
):
    q = db.query(Driver)
    if search.strip():
        pat = f"%{search.strip()}%"
        q = q.filter(or_(
            Driver.driver_id.ilike(pat), 
            Driver.first_name.ilike(pat),
            Driver.last_name.ilike(pat),
            Driver.citizen_id.ilike(pat),
            Driver.prefix.ilike(pat),
        ))
    total = q.count()
    rows = q.order_by(Driver.driver_id.asc(), Driver.first_name.asc()).offset((page-1)*page_size).limit(page_size).all()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {"driver_id": r.driver_id, "citizen_id": r.citizen_id, "prefix": r.prefix, "first_name": r.first_name, "last_name": r.last_name}
            for r in rows
        ]
    }

@router.post("/api/drivers", response_model=DriverOut)
def create_driver(data: DriverIn, db: Session = Depends(get_db)):
    exists = db.query(Driver).filter(Driver.citizen_id == data.citizen_id).first()
    if exists:
        raise HTTPException(status_code=409, detail="duplicate citizen_id")

    new_id = gen_sequential_driver_id(db)
    driver = Driver(
        driver_id = new_id,
        citizen_id = data.citizen_id,
        prefix = data.prefix or "",
        first_name = data.first_name,
        last_name = data.last_name
    )
    db.add(driver)
    db.commit()
    db.refresh(driver)
    return DriverOut(
        driver_id=driver.driver_id,
        citizen_id=driver.citizen_id,
        prefix=driver.prefix,
        first_name=driver.first_name,
        last_name=driver.last_name
    )

@router.put("/api/drivers/{driver_id}", response_model=DriverOut)
def update_driver(driver_id: str, data: DriverIn, db: Session = Depends(get_db)):
    driver = db.query(Driver).filter(Driver.driver_id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="not found")

    dup = db.query(Driver).filter(Driver.citizen_id == data.citizen_id, Driver.driver_id != driver_id).first()
    if dup:
        raise HTTPException(status_code=409, detail="duplicate citizen_id")

    driver.prefix = data.prefix or ""
    driver.first_name = data.first_name
    driver.last_name = data.last_name
    driver.citizen_id = data.citizen_id

    db.commit()
    db.refresh(driver)
    return DriverOut(
        driver_id=driver.driver_id,
        citizen_id=driver.citizen_id,
        prefix=driver.prefix,
        first_name=driver.first_name,
        last_name=driver.last_name
    )

@router.delete("/api/drivers/{driver_id}", status_code=204)
def delete_driver(driver_id: str, db: Session = Depends(get_db)):
    driver = db.query(Driver).filter(Driver.driver_id == driver_id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="not found")
    db.delete(driver)
    db.commit()
    return

@router.get("/api/driver-summary")
def driver_summary(
    driver_id: str = Query(..., min_length=2),
    granularity: str = Query("day", pattern="^(day|month|year)$"),
    start: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD"),
    month: Optional[str] = Query(None, description="YYYY-MM"),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    db: Session = Depends(get_db),
):
    inv = models.Invoice
    itm = models.InvoiceItem

    if granularity == "day":
        label_expr = func.to_char(inv.invoice_date, 'YYYY-MM-DD')
    elif granularity == "month":
        label_expr = func.to_char(inv.invoice_date, 'YYYY-MM')
    else:
        label_expr = func.to_char(inv.invoice_date, 'YYYY')

    # คำนวณยอดรวมของรายการต่อบิล
    sum_amount = func.sum(
        func.coalesce(
            itm.amount,
            func.coalesce(itm.quantity, 0) * func.coalesce(itm.cf_itempricelevel_price, 0)
        )
    )

    car_list = func.array_to_string(
            func.array_agg(func.distinct(inv.car_numberplate)),
            ', '
        )

    q = (
        db.query(
            label_expr.label("period"),
            func.count(func.distinct(inv.idx)).label("count"),
            func.coalesce(sum_amount, 0).label("amount"),
            car_list.label("car_plates"), 
        )
        .outerjoin(itm, itm.invoice_number == inv.invoice_number)
        .filter(inv.driver_id == driver_id)
    )

    def _to_date(s):
        if not s:
            return None
        try:
            return date.fromisoformat(s)
        except Exception:
            return None

    if granularity == "day":
        d1 = _to_date(start); d2 = _to_date(end)
        if d1: q = q.filter(inv.invoice_date >= d1)
        if d2: q = q.filter(inv.invoice_date <= d2)
    elif granularity == "month":
        if month and len(month) == 7:
            q = q.filter(func.to_char(inv.invoice_date, 'YYYY-MM') == month)
    else:
        if year:
            q = q.filter(func.extract("year", inv.invoice_date) == year)

    q = q.group_by("period").order_by("period")

    out = []
    for period, count, amount, car_plates in q.all():
        amount = float(amount or 0.0)
        before_vat = amount
        vat = before_vat * VAT_RATE
        grand = before_vat + vat
        out.append({
            "period": period,
            "count": int(count or 0),
            "car_plates": car_plates or "",
            "amount": round(amount, 2),
            "before_vat": round(before_vat, 2),
            "vat": round(vat, 2),
            "grand": round(grand, 2),
        })
    return out


@router.get("/api/driver-invoices")
def driver_invoices(
    driver_id: str = Query(..., min_length=2),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
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
            inv.grn_number,
            inv.dn_number,
            inv.car_numberplate,
            func.coalesce(sub.c.amount, 0).label("amount"),
        )
        .outerjoin(sub, sub.c.inv_no == inv.invoice_number)
        .filter(inv.driver_id == driver_id)
    )

    def _to_date(s):
        if not s:
            return None
        try:
            return date.fromisoformat(s)
        except Exception:
            return None

    d1 = _to_date(start); d2 = _to_date(end)
    if d1: q = q.filter(inv.invoice_date >= d1)
    if d2: q = q.filter(inv.invoice_date <= d2)

    if qtext and qtext.strip():
        pat = f"%{qtext.strip()}%"
        q = q.filter(
            (inv.invoice_number.ilike(pat)) |
            (inv.fname.ilike(pat)) |
            (inv.po_number.ilike(pat))
        )

    q = q.order_by(inv.invoice_date.desc(), inv.idx.desc())

    out = []
    for idx, invoice_date, invoice_number, fname, po_number, grn_number, dn_number, car_numberplate, amount in q.all():
        out.append({
            "idx": idx,
            "invoice_date": invoice_date.isoformat() if invoice_date else None,
            "invoice_number": invoice_number,
            "fname": fname,
            "po_number": po_number,
            "grn_number": grn_number or "",
            "dn_number": dn_number or "",
            "car_numberplate": car_numberplate or "",
        })
    return out

