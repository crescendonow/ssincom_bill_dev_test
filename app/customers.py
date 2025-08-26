# app/customers.py
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
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
