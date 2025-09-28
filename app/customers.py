# app/customers.py
from __future__ import annotations
import os
from datetime import datetime, timezone, timedelta
from math import ceil
from typing import List, Optional, Dict, Any
from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from sqlalchemy.exc import IntegrityError

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

def generate_personid(db: Session) -> str:
    """PC + 2 หลักท้ายปี พ.ศ. + running 4 หลัก (รีเทิร์นค่าใหม่ที่ยังไม่ซ้ำ)"""
    # ปี พ.ศ. จากเวลาประเทศไทย (หรือใช้ UTC + 543 ก็ได้)
    th_year = datetime.now().year + 543
    yy = th_year % 100
    prefix = f"PC{yy:02d}"

    # หา running สูงสุดของปีนั้น (ท้าย 4 หลัก) จาก personid ที่ขึ้นต้นด้วย prefix
    # เช่น PC68xxxx -> ดึง xxxx มากสุด
    q = (db.query(models.CustomerList.personid)
           .filter(models.CustomerList.personid.like(f"{prefix}%")))
    max_run = 0
    for (pid,) in q.all():
        if isinstance(pid, str) and len(pid) >= 8 and pid.startswith(prefix):
            tail = pid[-4:]
            if tail.isdigit():
                max_run = max(max_run, int(tail))

    # ลองจองเลขใหม่ (กันชนกันด้วย unique)
    for _ in range(20):  # ลองสัก 20 ครั้งพอ
        next_run = max_run + 1
        candidate = f"{prefix}{next_run:04d}"
        # ตรวจว่ามีหรือยัง
        exists = db.query(models.CustomerList).filter(models.CustomerList.personid == candidate).first()
        if not exists:
            return candidate
        max_run += 1

    # ถ้าเกิน 20 ครั้ง (ไม่น่าเกิด) โยน error
    raise RuntimeError("Cannot allocate new personid")

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

        # เครดิต (วัน)
        "fmlpaymentcreditday": c.fmlpaymentcreditday,

        "cf_hq": c.cf_hq,
        "cf_branch": c.cf_branch,
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
class CustomerPayload(BaseModel):
    prename: str | None = None
    fname: str | None = None
    lname: str | None = None
    personid: str | None = None
    cf_taxid: str | None = None
    cf_personaddress: str | None = None
    cf_personzipcode: str | None = None
    cf_provincename: str | None = None
    # ใช้ Key ให้ตรงกับที่ JavaScript ส่งมา
    cf_personaddress_tel: str | None = None
    cf_personaddress_mobile: str | None = None
    fmlpaymentcreditday: int | None = None
    cf_hq: int | None = None
    cf_branch: str | None = None

@router.post("/api/customers")
async def api_customers_create(payload: CustomerPayload, db: Session = Depends(get_db)):
    data = payload.dict()
    personid = (data.get("personid") or "").strip() or generate_personid(db)

    obj = models.CustomerList(
        prename=data.get("prename"),
        fname=data.get("fname"),
        lname=data.get("lname"),
        personid=personid,
        cf_personaddress=data.get("cf_personaddress"),
        cf_personzipcode=data.get("cf_personzipcode"),
        cf_provincename=data.get("cf_provincename"),
        cf_taxid=data.get("cf_taxid"),
        fmlpaymentcreditday=data.get("fmlpaymentcreditday"),
        cf_hq=data.get("cf_hq"),
        cf_branch=data.get("cf_branch"),
        # แก้ไข: Mapping field โทรศัพท์ให้ครบทั้ง 2 ชุดคอลัมน์
        tel=data.get("cf_personaddress_tel"),
        mobile=data.get("cf_personaddress_mobile"),
        cf_personaddress_tel=data.get("cf_personaddress_tel"),
        cf_personaddress_mobile=data.get("cf_personaddress_mobile"),
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return {"ok": True, "idx": obj.idx, "personid": obj.personid}


@router.post("/api/customers/check-duplicate")
def api_customers_check_duplicate(payload: dict):
    """
    ทำให้เข้ากันได้กับฟรอนต์เก่า: ตอบว่าซ้ำหรือไม่
    โจทย์ต้องการ 'อัปเดตโดยไม่ต้องเช็กซ้ำ' เลยตอบให้ 'ไม่ซ้ำ' ตลอด
    """
    return {"duplicate": False}

@router.put("/api/customers/{idx}")
def api_customers_update(idx: int, payload: CustomerPayload, db: Session = Depends(get_db)):
    """
    อัปเดตข้อมูลลูกค้าในตาราง CustomerList ตาม idx
    """
    c = db.query(models.CustomerList).filter(models.CustomerList.idx == idx).first()
    if not c:
        raise HTTPException(status_code=404, detail="customer not found")

    # ใช้ exclude_unset=True เพื่ออัปเดตเฉพาะฟิลด์ที่ถูกส่งมาเท่านั้น
    update_data = payload.dict(exclude_unset=True)

    # วนลูปเพื่ออัปเดตข้อมูลทีละฟิลด์
    for field, val in update_data.items():
        # กรณีพิเศษ: อัปเดตฟิลด์เบอร์โทรศัพท์ทั้ง 2 ชุด
        if field == 'cf_personaddress_tel':
            setattr(c, 'tel', val)
            setattr(c, 'cf_personaddress_tel', val)
        elif field == 'cf_personaddress_mobile':
            setattr(c, 'mobile', val)
            setattr(c, 'cf_personaddress_mobile', val)
        elif hasattr(c, field):
            setattr(c, field, val)

    db.commit()
    return {"ok": True, "idx": idx}

