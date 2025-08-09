from fastapi import FastAPI, Form, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from sqlalchemy import or_, and_
from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from . import models, database, crud, pdf_generator
from .models import CustomerList, ProductList 
from .database import SessionLocal
from datetime import date
from typing import List
from pathlib import Path

app = FastAPI()
models.Base.metadata.create_all(bind=database.engine)

BASE_DIR = Path(__file__).resolve().parent
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})


@app.get("/form", response_class=HTMLResponse)
async def form_page(request: Request):
    return templates.TemplateResponse("form.html", {"request": request})

@app.get("/customers", response_class=HTMLResponse)
async def customer_page(request: Request):
    # load one page table and form 
    return templates.TemplateResponse("customer_form.html", {"request": request})

@app.get("/api/customers/all")
def api_get_customers_all():
    db = SessionLocal()
    rows = db.query(CustomerList).order_by(CustomerList.idx.desc()).all()
    db.close()
    def to_dict(c):
        return {
            "idx": c.idx,
            "prename": c.prename, "sysprename": c.sysprename,
            "fname": c.fname, "lname": c.lname, "sex": c.sex,
            "personid": c.personid, "syspersonid": c.syspersonid,
            "tel": c.tel, "mobile": c.mobile,
            "cf_personaddress_tel": c.cf_personaddress_tel,
            "cf_personaddress_mobile": c.cf_personaddress_mobile,
            "cf_personaddress": c.cf_personaddress,
            "cf_personzipcode": c.cf_personzipcode,
            "cf_provincename": c.cf_provincename,
            "cf_taxid": c.cf_taxid,
            "fmlpaymentcreditday": c.fmlpaymentcreditday
        }
    return JSONResponse([to_dict(c) for c in rows])

# check duplicate (use front)
@app.post("/api/customers/check-duplicate")
async def api_check_duplicate(
    fname: str = Form(None),
    personid: str = Form(None),
    cf_taxid: str = Form(None),
    ignore_idx: int = Form(None)  # if edit skip row
):
    db = SessionLocal()
    q = db.query(CustomerList)
    # duplicate if taxid or (name personid ) match
    cond = or_(
        and_(CustomerList.fname == fname, CustomerList.personid == personid),
        CustomerList.cf_taxid == cf_taxid
    )
    if ignore_idx:
        q = q.filter(CustomerList.idx != ignore_idx)
    exists = db.query(q.filter(cond).exists()).scalar()
    db.close()
    return {"duplicate": bool(exists)}

# add customer 
@app.post("/api/customers")
async def api_create_customer(
    prename: str = Form(None),
    sysprename: str = Form(None),
    fname: str = Form(...),
    lname: str = Form(None),
    personid: str = Form(None),
    tel: str = Form(None),
    mobile: str = Form(None),
    syspersonid: str = Form(None),
    sex: str = Form(None),
    cf_personaddress_tel: str = Form(None),
    cf_personaddress_mobile: str = Form(None),
    cf_personaddress: str = Form(None),
    cf_personzipcode: str = Form(None),
    cf_provincename: str = Form(None),
    cf_taxid: str = Form(None),
    fmlpaymentcreditday: int = Form(None),
    redirect_to_dashboard: str = Form(None) # "1" = save and back to  dashboard
):
    db = SessionLocal()
    # duplicate check
    dup = db.query(CustomerList).filter(
        or_(
            and_(CustomerList.fname == fname, CustomerList.personid == personid,
            CustomerList.cf_taxid == cf_taxid
        )
    ).first()
    if dup:
        db.close()
        raise HTTPException(status_code=409, detail="ข้อมูลซ้ำ (ชื่อ รหัสลูกค้า หรือ เลขภาษี)")

    c = CustomerList(
        prename=prename, sysprename=sysprename,
        fname=fname, lname=lname, personid=personid, tel=tel, mobile=mobile,
        syspersonid=syspersonid, sex=sex,
        cf_personaddress_tel=cf_personaddress_tel,
        cf_personaddress_mobile=cf_personaddress_mobile,
        cf_personaddress=cf_personaddress, cf_personzipcode=cf_personzipcode,
        cf_provincename=cf_provincename, cf_taxid=cf_taxid,
        fmlpaymentcreditday=fmlpaymentcreditday
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    db.close()

    if redirect_to_dashboard == "1":
        return RedirectResponse(url="/?msg=เพิ่มลูกค้าเรียบร้อยแล้ว", status_code=303)
    return {"message": "created", "idx": c.idx}

# edit customer
@app.post("/api/customers/{idx}")
async def api_update_customer(
    idx: int,
    prename: str = Form(None),
    sysprename: str = Form(None),
    fname: str = Form(...),
    lname: str = Form(None),
    personid: str = Form(None),
    tel: str = Form(None),
    mobile: str = Form(None),
    syspersonid: str = Form(None),
    sex: str = Form(None),
    cf_personaddress_tel: str = Form(None),
    cf_personaddress_mobile: str = Form(None),
    cf_personaddress: str = Form(None),
    cf_personzipcode: str = Form(None),
    cf_provincename: str = Form(None),
    cf_taxid: str = Form(None),
    fmlpaymentcreditday: int = Form(None),
    redirect_to_dashboard: str = Form(None)
):
    db = SessionLocal()
    c = db.query(CustomerList).filter(CustomerList.idx == idx).first()
    if not c:
        db.close()
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลลูกค้า")

    # duplicate check (ยกเว้นตัวเอง)
    dup = db.query(CustomerList).filter(
        CustomerList.idx != idx,
        or_(
            and_(CustomerList.fname == fname, CustomerList.personid == personid,
            CustomerList.cf_taxid == cf_taxid
        )
    ).first()
    if dup:
        db.close()
        raise HTTPException(status_code=409, detail="ข้อมูลซ้ำ (ชื่อ รหัสลูกค้า หรือ เลขภาษี)")

    # update fields
    c.prename = prename
    c.sysprename = sysprename
    c.fname = fname
    c.lname = lname
    c.personid = personid
    c.tel = tel
    c.mobile = mobile
    c.syspersonid = syspersonid
    c.sex = sex
    c.cf_personaddress_tel = cf_personaddress_tel
    c.cf_personaddress_mobile = cf_personaddress_mobile
    c.cf_personaddress = cf_personaddress
    c.cf_personzipcode = cf_personzipcode
    c.cf_provincename = cf_provincename
    c.cf_taxid = cf_taxid
    c.fmlpaymentcreditday = fmlpaymentcreditday

    db.commit()
    db.close()

    if redirect_to_dashboard == "1":
        return RedirectResponse(url="/?msg=แก้ไขลูกค้าเรียบร้อยแล้ว", status_code=303)
    return {"message": "updated"}

# delete customer 
@app.delete("/api/customers/{idx}")
def api_delete_customer(idx: int):
    db = SessionLocal()
    c = db.query(CustomerList).filter(CustomerList.idx == idx).first()
    if not c:
        db.close()
        raise HTTPException(status_code=404, detail="ไม่พบข้อมูลลูกค้า")
    db.delete(c)
    db.commit()
    db.close()
    return {"message": "deleted"}

@app.get("/api/customers")
def get_customers():
    db = SessionLocal()
    customers = db.query(CustomerList).all()
    db.close()
    return JSONResponse(content=[{"id": c.idx, "fname": c.fname, "address": c.cf_personaddress, "taxid": c.cf_taxid} for c in customers])

#get data from productlist 
@app.get("/api/products")
def get_products():
    db = SessionLocal()
    products = db.query(ProductList).all()
    db.close()
    return JSONResponse(content=[
        {
            "code": p.cf_itemid,
            "name": p.cf_itemname,
            "price": p.cf_itempricelevel_price
        }
        for p in products
    ])


@app.post("/submit")
async def submit(
    invoice_number: str = Form(...),
    invoice_date: date = Form(...),
    customer_name: str = Form(...),
    customer_taxid: str = Form(...),
    customer_address: str = Form(...),
    product_code: List[str] = Form(...),
    description: List[str] = Form(...),
    quantity: List[float] = Form(...),
    unit_price: List[float] = Form(...)
):
    data = {
        "invoice_number": invoice_number,
        "invoice_date": invoice_date,
        "customer_name": customer_name,
        "customer_taxid": customer_taxid,
        "customer_address": customer_address
    }
    items = []
    for i in range(len(product_code)):
        items.append({
            "product_code": product_code[i],
            "description": description[i],
            "quantity": quantity[i],
            "unit_price": unit_price[i]
        })
    invoice = crud.create_invoice(data, items)
    return {"message": "saved", "invoice_id": invoice.id}

@app.post("/preview", response_class=HTMLResponse)
async def preview_invoice(request: Request):
    invoice_data = await request.json()
    return templates.TemplateResponse("invoice.html", {"request": request, "invoice": invoice_data})

@app.get("/export-pdf/{invoice_id}")
async def export_pdf(invoice_id: int):
    invoice = crud.get_invoice(invoice_id)
    pdf_path = pdf_generator.generate_invoice_pdf(invoice)
    return FileResponse(pdf_path, media_type="application/pdf", filename="invoice.pdf")
