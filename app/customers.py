# app/customers.py
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Form
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from .database import SessionLocal
from . import models

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ========== Utils ==========
def customer_to_dict(c: models.CustomerList) -> dict:
    return {
        "idx": c.idx,
        "prename": c.prename,
        "fname": c.fname,
        "lname": c.lname,
        "personid": c.personid,
        "cf_taxid": c.cf_taxid,
        "cf_personaddress_tel": c.cf_personaddress_tel,
        "cf_personaddress_mobile": c.cf_personaddress_mobile,
        "cf_personaddress": c.cf_personaddress,
        "cf_provincename": c.cf_provincename,
        "cf_personzipcode": c.cf_personzipcode,
        "fmlpaymentcreditday": c.fmlpaymentcreditday,
    }

# ========== NEW: โหลดรายการทั้งหมดให้ customer_form.js ==========
@router.get("/api/customers/all")
def api_customers_all(db: Session = Depends(get_db)):
    rows = db.query(models.CustomerList).order_by(models.CustomerList.idx.desc()).all()
    return [customer_to_dict(r) for r in rows]

# ========== NEW: ตรวจข้อมูลซ้ำ (ชื่อ/รหัส/เลขภาษี) ==========
@router.post("/api/customers/check-duplicate")
def api_customers_check_duplicate(
    fname: str = Form(""),
    personid: str = Form(""),
    cf_taxid: str = Form(""),
    ignore_idx: Optional[int] = Form(None),
    db: Session = Depends(get_db),
):
    q = db.query(models.CustomerList)
    cond = []
    if fname: cond.append(models.CustomerList.fname == fname)
    if personid: cond.append(models.CustomerList.personid == personid)
    if cf_taxid: cond.append(models.CustomerList.cf_taxid == cf_taxid)
    if cond:
        q = q.filter(or_(*cond))
    else:
        return {"duplicate": False}
    if ignore_idx:
        q = q.filter(models.CustomerList.idx != ignore_idx)
    exists = db.query(q.exists()).scalar()
    return {"duplicate": bool(exists)}

# ========== NEW: สร้างลูกค้า ==========
@router.post("/api/customers")
def api_customers_create(
    prename: Optional[str] = Form(None),
    fname: str = Form(...),
    lname: Optional[str] = Form(None),
    personid: Optional[str] = Form(None),
    cf_taxid: Optional[str] = Form(None),
    cf_personaddress_tel: Optional[str] = Form(None),
    cf_personaddress_mobile: Optional[str] = Form(None),
    cf_personaddress: Optional[str] = Form(None),
    cf_provincename: Optional[str] = Form(None),
    cf_personzipcode: Optional[str] = Form(None),
    fmlpaymentcreditday: Optional[int] = Form(None),
    redirect_to_dashboard: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    row = models.CustomerList(
        prename=prename,
        fname=fname,
        lname=lname,
        personid=personid,
        cf_taxid=cf_taxid,
        cf_personaddress_tel=cf_personaddress_tel,
        cf_personaddress_mobile=cf_personaddress_mobile,
        cf_personaddress=cf_personaddress,
        cf_provincename=cf_provincename,
        cf_personzipcode=cf_personzipcode,
        fmlpaymentcreditday=fmlpaymentcreditday,
    )
    db.add(row); db.commit(); db.refresh(row)
    if redirect_to_dashboard:
        return RedirectResponse(url="/dashboard?msg=customer_saved", status_code=303)
    return {"ok": True, "idx": row.idx, "customer": customer_to_dict(row)}

# ========== NEW: แก้ไขลูกค้า (ตามที่ JS ใช้ method POST) ==========
@router.post("/api/customers/{idx}")
def api_customers_update(
    idx: int,
    prename: Optional[str] = Form(None),
    fname: Optional[str] = Form(None),
    lname: Optional[str] = Form(None),
    personid: Optional[str] = Form(None),
    cf_taxid: Optional[str] = Form(None),
    cf_personaddress_tel: Optional[str] = Form(None),
    cf_personaddress_mobile: Optional[str] = Form(None),
    cf_personaddress: Optional[str] = Form(None),
    cf_provincename: Optional[str] = Form(None),
    cf_personzipcode: Optional[str] = Form(None),
    fmlpaymentcreditday: Optional[int] = Form(None),
    redirect_to_dashboard: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    row = db.query(models.CustomerList).filter(models.CustomerList.idx == idx).first()
    if not row:
        raise HTTPException(status_code=404, detail="customer not found")

    # อัปเดตเฉพาะค่าส่งมา
    mapping = {
        "prename": prename, "fname": fname, "lname": lname, "personid": personid,
        "cf_taxid": cf_taxid, "cf_personaddress_tel": cf_personaddress_tel,
        "cf_personaddress_mobile": cf_personaddress_mobile, "cf_personaddress": cf_personaddress,
        "cf_provincename": cf_provincename, "cf_personzipcode": cf_personzipcode,
        "fmlpaymentcreditday": fmlpaymentcreditday,
    }
    for k, v in mapping.items():
        if v is not None:
            setattr(row, k, v)

    db.commit(); db.refresh(row)
    if redirect_to_dashboard:
        return RedirectResponse(url="/dashboard?msg=customer_saved", status_code=303)
    return {"ok": True, "customer": customer_to_dict(row)}

# ========== delete customer ==========
@router.delete("/api/customers/{idx}")
def api_customers_delete(idx: int, db: Session = Depends(get_db)):
    row = db.query(models.CustomerList).filter(models.CustomerList.idx == idx).first()
    if not row:
        raise HTTPException(status_code=404, detail="customer not found")
    db.delete(row); db.commit()
    return JSONResponse(status_code=204, content=None)

# ========= suggest from invoice history =========
@router.get("/api/customers/suggest")
def suggest_customers(
    q: str = Query("", description="ค้นหาจากชื่อ/รหัสลูกค้า/เลขผู้เสียภาษี/โทร"),
    limit: int = Query(15, ge=1, le=50),
    db: Session = Depends(get_db),
):
    inv = models.Invoice
    qpat = f"%{q.strip()}%"
    rows = (
        db.query(
            inv.personid,
            inv.fname.label("customer_name"),
            inv.cf_taxid,
            inv.cf_provincename,
            inv.cf_personaddress,
            inv.tel,
            inv.mobile,
            func.max(inv.idx).label("last_idx"),
        )
        .filter(
            or_(
                inv.fname.ilike(qpat),
                inv.personid.ilike(qpat),
                inv.cf_taxid.ilike(qpat),
                inv.tel.ilike(qpat),
                inv.mobile.ilike(qpat),
            )
        )
        .group_by(
            inv.personid, inv.fname, inv.cf_taxid, inv.cf_provincename,
            inv.cf_personaddress, inv.tel, inv.mobile
        )
        .order_by(func.max(inv.idx).desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "personid": r.personid,
            "customer_name": r.customer_name,
            "taxid": r.cf_taxid,
            "province": r.cf_provincename,
            "address": r.cf_personaddress,
            "tel": r.tel, "mobile": r.mobile
        }
        for r in rows
    ]

# ========= get data from personid =========
@router.get("/api/customers/{personid}")
def get_customer(personid: str, db: Session = Depends(get_db)):
    inv = models.Invoice
    row = (
        db.query(inv)
        .filter(inv.personid == personid)
        .order_by(inv.idx.desc())
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="customer not found")
    return {
        "personid": row.personid,
        "customer_name": row.fname,
        "taxid": row.cf_taxid,
        "province": row.cf_provincename,
        "address": row.cf_personaddress,
        "tel": row.tel, "mobile": row.mobile,
    }

# ========= list of customers =========
@router.get("/api/customers")
def list_customers(
    search: str = Query("", description="ค้นหาจากชื่อ/รหัส/เลขผู้เสียภาษี"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    inv = models.Invoice
    q = db.query(
        inv.personid,
        inv.fname.label("customer_name"),
        inv.cf_taxid,
        inv.cf_provincename,
        inv.cf_personaddress,
        inv.tel, inv.mobile,
        func.max(inv.idx).label("last_idx")
    )
    if search.strip():
        pat = f"%{search.strip()}%"
        q = q.filter(or_(inv.fname.ilike(pat), inv.personid.ilike(pat), inv.cf_taxid.ilike(pat)))

    q = q.group_by(inv.personid, inv.fname, inv.cf_taxid, inv.cf_provincename, inv.cf_personaddress, inv.tel, inv.mobile)
    total = q.count()
    rows = q.order_by(func.max(inv.idx).desc()).offset((page-1)*page_size).limit(page_size).all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "personid": r.personid,
                "customer_name": r.customer_name,
                "taxid": r.cf_taxid,
                "province": r.cf_provincename,
                "address": r.cf_personaddress,
                "tel": r.tel, "mobile": r.mobile
            } for r in rows
        ]
    }
