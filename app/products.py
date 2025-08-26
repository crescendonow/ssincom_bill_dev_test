# app/products.py
from fastapi import APIRouter, Depends, Query
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
