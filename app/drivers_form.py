# app/drivers_form.py
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import or_, Column, String
from .database import SessionLocal, Base

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
            Driver.first_name.ilike(pat),
            Driver.last_name.ilike(pat),
            Driver.citizen_id.ilike(pat),
            Driver.prefix.ilike(pat),
        ))
    total = q.count()
    rows = q.order_by(Driver.first_name.asc(), Driver.last_name.asc())            .offset((page-1)*page_size).limit(page_size).all()
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
