# app/products.py
from typing import Optional
from fastapi import APIRouter, Depends, Query, Form, HTTPException
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

# ---------- Utils ----------
def product_to_dict(p: models.ProductList) -> dict:
    return {
        "idx": p.idx,
        "cf_itemid": p.cf_itemid,
        "cf_itemname": p.cf_itemname,
        "cf_unitname": p.cf_unitname,
        "cf_itempricelevel_price": p.cf_itempricelevel_price,
        "cf_items_ordinary": p.cf_items_ordinary,
    }

# ---------- NEW: โหลดสินค้าทั้งหมด (ให้ product_form.js ใช้) ----------
@router.get("/api/products/all")
def api_products_all(db: Session = Depends(get_db)):
    rows = (
        db.query(models.ProductList)
        .order_by(
            models.ProductList.cf_items_ordinary.is_(None),  # ของที่ไม่มีลำดับไปท้าย
            models.ProductList.cf_items_ordinary.asc(),
            models.ProductList.cf_itemid.asc(),
        )
        .all()
    )
    return [product_to_dict(r) for r in rows]

# ---------- NEW: ตรวจข้อมูลซ้ำ (รหัส/ชื่อสินค้า) ----------
@router.post("/api/products/check-duplicate")
def api_products_check_duplicate(
    cf_itemid: str = Form(""),
    cf_itemname: str = Form(""),
    ignore_idx: Optional[int] = Form(None),
    db: Session = Depends(get_db),
):
    q = db.query(models.ProductList)
    cond = []
    if cf_itemid:  cond.append(models.ProductList.cf_itemid == cf_itemid)
    if cf_itemname: cond.append(models.ProductList.cf_itemname == cf_itemname)
    if cond:
        q = q.filter(or_(*cond))
    else:
        return {"duplicate": False}
    if ignore_idx:
        q = q.filter(models.ProductList.idx != ignore_idx)
    exists = db.query(q.exists()).scalar()
    return {"duplicate": bool(exists)}

# ---------- NEW: สร้างสินค้า ----------
@router.post("/api/products")
def api_products_create(
    cf_itemid: str = Form(...),
    cf_itemname: str = Form(...),
    cf_unitname: Optional[str] = Form(None),
    cf_itempricelevel_price: Optional[float] = Form(None),
    cf_items_ordinary: Optional[int] = Form(None),
    redirect_to_dashboard: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    # กันรหัสซ้ำ
    dup = db.query(models.ProductList).filter(models.ProductList.cf_itemid == cf_itemid).first()
    if dup:
        raise HTTPException(status_code=409, detail="duplicate product code")

    row = models.ProductList(
        cf_itemid=cf_itemid,
        cf_itemname=cf_itemname,
        cf_unitname=cf_unitname,
        cf_itempricelevel_price=cf_itempricelevel_price,
        cf_items_ordinary=cf_items_ordinary,
    )
    db.add(row); db.commit(); db.refresh(row)
    if redirect_to_dashboard:
        return RedirectResponse(url="/dashboard?msg=product_saved", status_code=303)
    return {"ok": True, "idx": row.idx, "product": product_to_dict(row)}

# ---------- NEW: แก้ไขสินค้า (product_form.js ใช้ POST) ----------
@router.post("/api/products/{idx}")
def api_products_update(
    idx: int,
    cf_itemid: Optional[str] = Form(None),
    cf_itemname: Optional[str] = Form(None),
    cf_unitname: Optional[str] = Form(None),
    cf_itempricelevel_price: Optional[float] = Form(None),
    cf_items_ordinary: Optional[int] = Form(None),
    redirect_to_dashboard: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    row = db.query(models.ProductList).filter(models.ProductList.idx == idx).first()
    if not row:
        raise HTTPException(status_code=404, detail="product not found")

    # ถ้าจะเปลี่ยนรหัส ตรวจซ้ำกับตัวอื่น
    if cf_itemid and cf_itemid != row.cf_itemid:
        dup = db.query(models.ProductList).filter(
            models.ProductList.cf_itemid == cf_itemid,
            models.ProductList.idx != idx
        ).first()
        if dup:
            raise HTTPException(status_code=409, detail="duplicate product code")

    mapping = {
        "cf_itemid": cf_itemid,
        "cf_itemname": cf_itemname,
        "cf_unitname": cf_unitname,
        "cf_itempricelevel_price": cf_itempricelevel_price,
        "cf_items_ordinary": cf_items_ordinary,
    }
    for k, v in mapping.items():
        if v is not None:
            setattr(row, k, v)

    db.commit(); db.refresh(row)
    if redirect_to_dashboard:
        return RedirectResponse(url="/dashboard?msg=product_saved", status_code=303)
    return {"ok": True, "product": product_to_dict(row)}

# ---------- NEW: ลบสินค้า ----------
@router.delete("/api/products/{idx}")
def api_products_delete(idx: int, db: Session = Depends(get_db)):
    row = db.query(models.ProductList).filter(models.ProductList.idx == idx).first()
    if not row:
        raise HTTPException(status_code=404, detail="product not found")
    db.delete(row); db.commit()
    return JSONResponse(status_code=204, content=None)

# ---------- เดิม: suggest สินค้าจากประวัติใบกำกับ ----------
@router.get("/api/products/suggest")
def suggest_products(
    q: str = Query("", description="ค้นหาจากรหัส/ชื่อสินค้า"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    it = models.InvoiceItem
    pat = f"%{q.strip()}%"
    rows = (
        db.query(
            it.cf_itemid.label("code"),
            it.cf_itemname.label("name"),
            func.avg(it.cf_itempricelevel_price).label("avg_price"),
            func.count().label("count_used")
        )
        .filter(or_(it.cf_itemid.ilike(pat), it.cf_itemname.ilike(pat)))
        .group_by(it.cf_itemid, it.cf_itemname)
        .order_by(func.count().desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "product_code": r.code,
            "description": r.name,
            "avg_unit_price": float(r.avg_price or 0),
            "used": int(r.count_used or 0)
        }
        for r in rows
    ]
