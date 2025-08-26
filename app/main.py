from fastapi import FastAPI, Form, Request, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_, and_, func, cast, Integer, Date
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.encoders import jsonable_encoder
from . import models, database, pdf_generator
from .models import CustomerList, ProductList
from .database import SessionLocal
# app/main.py
from .form import router as form_router
from .customers import router as customers_router
from .products import router as products_router
from .cars import router as cars_router

from datetime import date, datetime, timedelta
from typing import List
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
import re
import os
from urllib.parse import quote
from starlette.middleware.sessions import SessionMiddleware

app = FastAPI()
#models.Base.metadata.create_all(bind=database.engine)
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET", "ymB4BaVZOwDSM1UhXu7uh"),
    max_age=60*60*2,  # 2 ชั่วโมง
)


BASE_DIR = Path(__file__).resolve().parent
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})

@app.post("/login")
async def do_login(request: Request, username: str = Form(...), password: str = Form(...), next: str = Form("/dashboard")):
    VALID_USER = os.getenv("APP_USER", "admin")
    VALID_PASS = os.getenv("APP_PASS", "1234")
    if username == VALID_USER and password == VALID_PASS:
        request.session["user"] = {"name": username}
        return RedirectResponse(url=next or "/dashboard", status_code=303)
    return RedirectResponse(url=f"/login?error=1&next={quote(next or '/dashboard')}", status_code=303)

@app.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/login", status_code=303)

@app.get("/", response_class=HTMLResponse)
@app.get("/dashboard", response_class=HTMLResponse)
@app.get("/dashboard.html", response_class=HTMLResponse)

async def dashboard(request: Request):
    if not request.session.get("user"):
        # พาไปล็อกอินก่อน
        return RedirectResponse(url="/login", status_code=303)
    return templates.TemplateResponse("dashboard.html", {"request": request, "user": request.session.get("user")})

# install router 
app.include_router(form_router)
app.include_router(customers_router)
app.include_router(products_router)
app.include_router(cars_router)

# ========= (ตัวอย่าง) export-pdf ใช้ ORM แทน crud =========
@app.get("/export-pdf/{invoice_id}")
async def export_pdf(invoice_id: int):
    db = SessionLocal()
    try:
        inv = db.query(models.Invoice)\
                .options(joinedload(models.Invoice.items))\
                .filter(models.Invoice.idx == invoice_id)\
                .first()
        if not inv:
            raise HTTPException(status_code=404, detail="invoice not found")
        pdf_path = pdf_generator.generate_invoice_pdf(inv)
        return FileResponse(pdf_path, media_type="application/pdf", filename=f"invoice_{inv.invoice_number}.pdf")
    finally:
        db.close()

@app.get("/healthz")
def healthz():
    return {"ok": True}