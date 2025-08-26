# app/cars.py
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_

from .database import SessionLocal
from . import models

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --------- Pydantic ---------
class CarIn(BaseModel):
    number_plate: str
    car_brand: Optional[str] = None
    province: Optional[str] = None

class CarOut(BaseModel):
    idx: int
    number_plate: str
    car_brand: Optional[str] = None
    province: Optional[str] = None

# --------- Suggest ----------
@router.get("/api/suggest/number_plate")
def suggest_number_plate(q: str = Query("", min_length=1), limit: int = Query(15, ge=1, le=50), db: Session = Depends(get_db)):
    pat = f"%{q.strip()}%"
    rows = (
        db.query(models.Car)
        .filter(models.Car.number_plate.ilike(pat))
        .order_by(models.Car.number_plate.asc())
        .limit(limit)
        .all()
    )
    return [{"number_plate": r.number_plate} for r in rows]

# --------- List -------------
@router.get("/api/cars")
def list_cars(
    search: str = Query("", description="ค้นหา (ทะเบียน / ยี่ห้อ / จังหวัด)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db)
):
    q = db.query(models.Car)
    if search.strip():
        pat = f"%{search.strip()}%"
        q = q.filter(or_(
            models.Car.number_plate.ilike(pat),
            models.Car.car_brand.ilike(pat),
            models.Car.province.ilike(pat)
        ))
    total = q.count()
    rows = q.order_by(models.Car.idx.asc()).offset((page-1)*page_size).limit(page_size).all()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {"idx": r.idx, "number_plate": r.number_plate, "car_brand": r.car_brand, "province": r.province}
            for r in rows
        ]
    }

# --------- Create -----------
@router.post("/api/cars", response_model=CarOut)
def create_car(data: CarIn, db: Session = Depends(get_db)):
    exists = db.query(models.Car).filter(models.Car.number_plate == data.number_plate).first()
    if exists:
        raise HTTPException(status_code=409, detail="duplicate number_plate")
    car = models.Car(number_plate=data.number_plate, car_brand=data.car_brand, province=data.province)
    db.add(car); db.commit(); db.refresh(car)
    return CarOut(idx=car.idx, number_plate=car.number_plate, car_brand=car.car_brand, province=car.province)

# --------- Update -----------
@router.put("/api/cars/{idx}", response_model=CarOut)
def update_car(idx: int, data: CarIn, db: Session = Depends(get_db)):
    car = db.query(models.Car).filter(models.Car.idx == idx).first()
    if not car: raise HTTPException(status_code=404, detail="not found")
    # กันการชนทะเบียนกับคันอื่น
    dup = db.query(models.Car).filter(models.Car.number_plate == data.number_plate, models.Car.idx != idx).first()
    if dup: raise HTTPException(status_code=409, detail="duplicate number_plate")
    car.number_plate = data.number_plate
    car.car_brand = data.car_brand
    car.province = data.province
    db.commit(); db.refresh(car)
    return CarOut(idx=car.idx, number_plate=car.number_plate, car_brand=car.car_brand, province=car.province)

# --------- Delete -----------
@router.delete("/api/cars/{idx}", status_code=204)
def delete_car(idx: int, db: Session = Depends(get_db)):
    car = db.query(models.Car).filter(models.Car.idx == idx).first()
    if not car: raise HTTPException(status_code=404, detail="not found")
    db.delete(car); db.commit()
    return
