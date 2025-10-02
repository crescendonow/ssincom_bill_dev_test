# app/customers.py
from __future__ import annotations
import os
from math import ceil
from typing import List, Optional, Dict, Any
from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from .database import SessionLocal
from . import models

router = APIRouter()

# ---------------- DB Session ----------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# -------------- Helpers ---------------------
def _row_to_dict(c: models.CustomerList) -> Dict[str, Any]:
    """
    แปลง ORM -> dict ให้สอดคล้องกับ Frontend
    NOTE: ส่งคีย์เลขภาษีให้ครบ 3 แบบ เพื่อรองรับหน้าเว็บ/สคริปต์เก่า:
      - cf_taxid (มาตรฐานใหม่)
      - tax_id   (บางที่ใช้ snake_case)
      - taxid    (คีย์เก่าที่เคยใช้)
    """
    customer_name = (c.fname or "").strip()  # รักษาพฤติกรรมเดิม ถ้าต้องรวม lname ค่อยปรับฝั่ง DB/ETL
    return {
        "idx": c.idx,
        "personid": c.personid,
        "customer_name": customer_name,
        "prename": c.prename,

        # เลขภาษี: ส่งให้ครบทั้งสามคีย์
        "cf_taxid": c.cf_taxid,
        "tax_id": c.cf_taxid,
        "taxid": c.cf_taxid,

        # ที่อยู่/จังหวัด/รหัสไปรษณีย์: คงคีย์คู่ทั้งแบบสั้นและแบบเต็มเพื่อความเข้ากันได้
        "address": c.cf_personaddress,
        "cf_personaddress": c.cf_personaddress,

        "province": c.cf_provincename,
        "cf_provincename": c.cf_provincename,

        "zipcode": c.cf_personzipcode,
        "cf_personzipcode": c.cf_personzipcode,

        # เบอร์โทร
        "tel": c.tel,
        "mobile": c.mobile,
        "cf_personaddress_tel": c.tel,
        "cf_personaddress_mobile": c.mobile,
        "cf_hq": c.cf_hq,
        "cf_branch": c.cf_branch,

        # เครดิต (วัน)
        "fmlpaymentcreditday": c.fmlpaymentcreditday,
    }

def _find_template(filename: str) -> Optional[str]:
    """พยายามหาไฟล์ HTML หลาย path"""
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, filename),
        os.path.join(here, "templates", filename),
        os.path.join(os.getcwd(), filename),
        os.path.join(os.getcwd(), "templates", filename),
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None

# -------------- Pages (optional) -------------
@router.get("/customers", response_class=HTMLResponse)
def customers_page():
    """เสิร์ฟหน้า customer_form.html (ถ้าไม่พบไฟล์จะ 404)"""
    path = _find_template("customer_form.html")
    if not path:
        raise HTTPException(status_code=404, detail="templates/customer_form.html not found")
    return FileResponse(path)

# -------------- APIs ------------------------
@router.get("/api/customers/all")
def api_customers_all(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """ดึงลูกค้าทั้งหมด (ไว้ใช้ทำ datalist/fallback)"""
    rows = (
        db.query(models.CustomerList)
        .order_by(models.CustomerList.idx.desc())
        .all()
    )
    return [_row_to_dict(r) for r in rows]

@router.get("/api/customers/suggest")
def api_customers_suggest(
    q: str = Query(..., min_length=1, description="ค้นหาจาก ชื่อ/รหัส/ภาษี/จังหวัด/โทร/มือถือ"),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """autocomplete ลูกค้า (ลิมิต 20)"""
    q = q.strip()
    CL = models.CustomerList
    pat = f"%{q}%"
    rows = (
        db.query(CL)
        .filter(or_(
            CL.fname.ilike(pat),
            CL.personid.ilike(pat),
            CL.cf_taxid.ilike(pat),
            CL.cf_provincename.ilike(pat),
            CL.tel.ilike(pat),
            CL.mobile.ilike(pat),
        ))
        .order_by(CL.fname.asc())
        .limit(20)
        .all()
    )
    return [_row_to_dict(r) for r in rows]

@router.get("/api/customers/detail")
def api_customer_detail(
    personid: Optional[str] = Query(None),
    name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """ดึงรายละเอียดลูกค้ารายเดียว (ใช้เติมเครดิตวัน/ที่อยู่ ฯลฯ ให้ชัวร์)"""
    if not personid and not name:
        raise HTTPException(status_code=400, detail="personid or name is required")

    q = db.query(models.CustomerList)
    if personid:
        q = q.filter(models.CustomerList.personid == personid)
    else:
        q = q.filter(models.CustomerList.fname == name)

    c = q.first()
    if not c:
        raise HTTPException(status_code=404, detail="customer not found")
    return _row_to_dict(c)

@router.get("/api/customers")
def api_customers_list(
    q: Optional[str] = Query(None, description="ค้นหาจาก ชื่อ/รหัส/ภาษี/จังหวัด/โทร/มือถือ"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    ลิสต์ลูกค้าแบบแบ่งหน้า (ใช้กับตารางรายชื่อใน customer_form)
    คืนค่า: { items: [...], total, page, pages, limit }
    """
    CL = models.CustomerList
    base = db.query(CL)

    if q and q.strip():
        pat = f"%{q.strip()}%"
        base = base.filter(or_(
            CL.fname.ilike(pat),
            CL.personid.ilike(pat),
            CL.cf_taxid.ilike(pat),
            CL.cf_provincename.ilike(pat),
            CL.tel.ilike(pat),
            CL.mobile.ilike(pat),
        ))

    total = base.with_entities(func.count(CL.idx)).scalar() or 0
    pages = max(1, ceil(total / limit))
    page = min(max(1, page), pages)

    rows = (
        base.order_by(CL.fname.asc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    return {
        "items": [_row_to_dict(r) for r in rows],
        "total": total,
        "page": page,
        "pages": pages,
        "limit": limit,
    }

# ====== เพิ่ม: อัปเดต/เช็กซ้ำลูกค้า ======
class CustomerUpdate(BaseModel):
    prename: str | None = None
    fname: str | None = None
    lname: str | None = None
    personid: str | None = None
    cf_taxid: str | None = None
    cf_personaddress: str | None = None
    cf_personzipcode: str | None = None
    cf_provincename: str | None = None
    tel: str | None = None
    mobile: str | None = None
    fmlpaymentcreditday: int | None = None

@router.post("/api/customers/check-duplicate")
def api_customers_check_duplicate(payload: dict):
    """
    ทำให้เข้ากันได้กับฟรอนต์เก่า: ตอบว่าซ้ำหรือไม่
    โจทย์ต้องการ 'อัปเดตโดยไม่ต้องเช็กซ้ำ' เลยตอบให้ 'ไม่ซ้ำ' ตลอด
    """
    return {"duplicate": False}

@router.put("/api/customers/{idx}")
def api_customers_update(idx: int, payload: CustomerUpdate, db: Session = Depends(get_db)):
    """
    อัปเดตข้อมูลลูกค้าในตาราง CustomerList ตาม idx
    """
    c = db.query(models.CustomerList).filter(models.CustomerList.idx == idx).first()
    if not c:
        raise HTTPException(status_code=404, detail="customer not found")

    # map field จาก payload -> ORM
    for field in [
        "prename", "fname", "lname", "personid",
        "cf_taxid",
        "cf_personaddress", "cf_personzipcode", "cf_provincename",
        "tel", "mobile",
        "fmlpaymentcreditday",
    ]:
        val = getattr(payload, field)
        if val is not None:
            setattr(c, field, val)

    db.commit()
    return {"ok": True, "idx": idx}

