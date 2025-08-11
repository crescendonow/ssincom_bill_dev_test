from fastapi import FastAPI, Form, Request, HTTPException, Query
from sqlalchemy import or_, and_, func, cast, Integer, Date
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.encoders import jsonable_encoder
from . import models, database, crud, pdf_generator
from .models import CustomerList, ProductList 
from .database import SessionLocal
from datetime import date, datetime
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

#function duplicate check invoice_number 
def check_invoice_number(number: str = Query(..., min_length=1)):
    db = SessionLocal()
    try:
        exists = db.query(models.Invoice)\
                   .filter(models.Invoice.invoice_number == number)\
                   .first() is not None
        return {"exists": bool(exists)}
    finally:
        db.close()
        
#api for submit invoice from form.html 
@app.post("/submit")
async def submit(
    invoice_number: str = Form(...),
    invoice_date: str = Form(None),
    grn_number: str = Form(None),
    dn_number: str = Form(None),
    po_number: str = Form(None),

    # from form
    customer_name: str = Form(None),
    customer_taxid: str = Form(None),
    customer_address: str = Form(None),

    # new column add
    personid: str = Form(None),
    tel: str = Form(None),
    mobile: str = Form(None),
    cf_personzipcode: str = Form(None),
    cf_provincename: str = Form(None),
    fmlpaymentcreditday: int = Form(None),

    product_code: List[str] = Form(...),
    description: List[str] = Form(...),
    quantity: List[float] = Form(...),
    unit_price: List[float] = Form(...)
):
    from datetime import datetime
    db = SessionLocal()
    try:
        # parse date 
        d = None
        if invoice_date:
            for fmt in ("%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d"):
                try:
                    d = datetime.strptime(invoice_date, fmt).date()
                    break
                except:
                    pass

        # check duplicate number 
        if db.query(models.Invoice).filter(models.Invoice.invoice_number == invoice_number).first():
            return JSONResponse(status_code=409, content={"detail": "Duplicate invoice_number"})

        inv = models.Invoice(
            invoice_number=invoice_number,
            invoice_date=d,
            grn_number=grn_number,
            dn_number=dn_number,
            po_number=po_number,  
            fname=customer_name,
            personid=personid,
            tel=tel,
            mobile=mobile,
            cf_personaddress=customer_address,
            cf_personzipcode=cf_personzipcode,
            cf_provincename=cf_provincename,
            cf_taxid=customer_taxid,
            fmlpaymentcreditday=fmlpaymentcreditday
        )
        db.add(inv)
        db.flush()

        for i in range(len(product_code)):
            qty   = float(quantity[i] or 0)
            price = float(unit_price[i] or 0)
            db.add(models.InvoiceItem(
                invoice_number=inv.idx,
                personid=personid,
                cf_itemid=product_code[i],
                cf_itemname=description[i],
                cf_unitname=None,
                cf_itempricelevel_price=price,
                cf_items_ordinary=i+1,
                quantity=qty,
                amount=qty*price
            ))

        db.commit()
        return {"message": "saved", "invoice_idx": inv.idx, "invoice_number": inv.invoice_number}
    except:
        db.rollback()
        raise
    finally:
        db.close()

# ========= page summary =========
@app.get("/summary_invoices.html", response_class=HTMLResponse)
async def summary_invoices_page(request: Request):
    return templates.TemplateResponse("summary_invoices.html", {"request": request})

# ========= API summary =========
@app.get("/api/invoices/summary")
def api_invoice_summary(
    granularity: str = Query("day", regex="^(day|month|year)$"),
    start: str | None = None,
    end: str | None = None,
    month: str | None = None,
    year: str | None = None
):
    db = SessionLocal()
    try:
        inv = models.Invoice
        it  = models.InvoiceItem

        j = db.query(
            inv.idx.label("inv_id"),
            inv.invoice_date.label("inv_date"),
            func.sum(it.quantity * it.cf_itempricelevel_price).label("amount")
        ).join(
            it, cast(it.invoice_number, Integer) == inv.idx  # << cast ฝั่ง items ให้เป็น int
        )

        # filters
        if granularity == "day":
            if start:
                j = j.filter(inv.invoice_date >= cast(start, Date))
            if end:
                j = j.filter(inv.invoice_date <= cast(end, Date))
            period_expr = cast(inv.invoice_date, Date)  # จะได้ python date
        elif granularity == "month":
            if month:
                y, m = month.split("-")
                j = j.filter(func.extract("year", inv.invoice_date) == int(y))
                j = j.filter(func.extract("month", inv.invoice_date) == int(m))
            period_expr = func.to_char(inv.invoice_date, "YYYY-MM")
        else:
            if year:
                j = j.filter(func.extract("year", inv.invoice_date) == int(year))
            period_expr = func.to_char(inv.invoice_date, "YYYY")

        # รวมยอดต่อใบก่อน
        q = j.group_by(inv.idx, inv.invoice_date)
        sub = q.subquery()

        # group ต่อ period
        if granularity == "day":
            group_period = cast(sub.c.inv_date, Date)
        elif granularity == "month":
            group_period = func.to_char(sub.c.inv_date, "YYYY-MM")
        else:
            group_period = func.to_char(sub.c.inv_date, "YYYY")

        agg = db.query(
            group_period.label("period"),
            func.count().label("count"),
            func.coalesce(func.sum(sub.c.amount), 0).label("amount")
        ).group_by(group_period).order_by(group_period)

        rows = []
        VAT_RATE = 0.07
        for period, count, amount in agg.all():
            # แปลง period ให้เป็น string เสมอ (กัน date serialize error)
            if hasattr(period, "isoformat"):  # เป็น date/datetime
                period_str = period.isoformat()
            else:
                period_str = str(period)

            discount = 0.0
            before_vat = (amount or 0) - discount
            vat = before_vat * VAT_RATE
            grand = before_vat + vat

            rows.append({
                "period": period_str,
                "count": int(count or 0),
                "amount": float(amount or 0),
                "discount": float(discount),
                "before_vat": float(before_vat),
                "vat": float(vat),
                "grand": float(grand),
            })

        # ใช้ jsonable_encoder กันชนิดพิเศษ
        return JSONResponse(content=jsonable_encoder(rows))
    finally:
        db.close()
                
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
            and_(CustomerList.fname == fname, CustomerList.personid == personid),
            CustomerList.cf_taxid == cf_taxid
        )
    ).first()
    if dup:
        db.close()
        raise HTTPException(status_code=409, detail="duplicate (name personid tax_id)")

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
            and_(CustomerList.fname == fname, CustomerList.personid == personid),
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

#product management part 
@app.get("/products", response_class=HTMLResponse)
async def products_page(request: Request):
    return templates.TemplateResponse("product_form.html", {"request": request})

# get product all columns 
@app.get("/api/products/all")
def api_get_products_all():
    db = SessionLocal()
    rows = db.query(ProductList).order_by(ProductList.idx.desc()).all()
    db.close()
    return [
        {
            "idx": r.idx,
            "cf_itemid": r.cf_itemid,
            "cf_itemname": r.cf_itemname,
            "cf_unitname": r.cf_unitname,
            "cf_itempricelevel_price": r.cf_itempricelevel_price,
            "cf_items_ordinary": r.cf_items_ordinary,
        } for r in rows
    ]

# check duplicate:cf_itemid and cf_itemname 
@app.post("/api/products/check-duplicate")
async def api_products_check_duplicate(
    cf_itemid: str = Form(None),
    cf_itemname: str = Form(None),
    ignore_idx: int = Form(None),
):
    db = SessionLocal()
    q = db.query(ProductList)
    cond = or_(
        ProductList.cf_itemid == cf_itemid,
        ProductList.cf_itemname == cf_itemname
    )
    if ignore_idx:
        q = q.filter(ProductList.idx != ignore_idx)
    exists = db.query(q.filter(cond).exists()).scalar()
    db.close()
    return {"duplicate": bool(exists)}

# add new product 
@app.post("/api/products")
async def api_create_product(
    cf_itemid: str = Form(...),
    cf_itemname: str = Form(...),
    cf_unitname: str = Form(None),
    cf_itempricelevel_price: float = Form(0),
    cf_items_ordinary: int = Form(None),
    redirect_to_dashboard: str = Form(None),
):
    db = SessionLocal()
    dup = db.query(ProductList).filter(
        or_(ProductList.cf_itemid == cf_itemid, ProductList.cf_itemname == cf_itemname)
    ).first()
    if dup:
        db.close()
        raise HTTPException(status_code=409, detail="ข้อมูลซ้ำ (รหัสหรือชื่อสินค้า)")

    p = ProductList(
        cf_itemid=cf_itemid,
        cf_itemname=cf_itemname,
        cf_unitname=cf_unitname,
        cf_itempricelevel_price=cf_itempricelevel_price,
        cf_items_ordinary=cf_items_ordinary
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    db.close()

    if redirect_to_dashboard == "1":
        return RedirectResponse(url="/?msg=เพิ่มสินค้าสำเร็จ", status_code=303)
    return {"message": "created", "idx": p.idx}

# edit product 
@app.post("/api/products/{idx}")
async def api_update_product(
    idx: int,
    cf_itemid: str = Form(...),
    cf_itemname: str = Form(...),
    cf_unitname: str = Form(None),
    cf_itempricelevel_price: float = Form(0),
    cf_items_ordinary: int = Form(None),
    redirect_to_dashboard: str = Form(None),
):
    db = SessionLocal()
    p = db.query(ProductList).filter(ProductList.idx == idx).first()
    if not p:
        db.close()
        raise HTTPException(status_code=404, detail="ไม่พบสินค้า")

    dup = db.query(ProductList).filter(
        ProductList.idx != idx,
        or_(ProductList.cf_itemid == cf_itemid, ProductList.cf_itemname == cf_itemname)
    ).first()
    if dup:
        db.close()
        raise HTTPException(status_code=409, detail="ข้อมูลซ้ำ (รหัสหรือชื่อสินค้า)")

    p.cf_itemid = cf_itemid
    p.cf_itemname = cf_itemname
    p.cf_unitname = cf_unitname
    p.cf_itempricelevel_price = cf_itempricelevel_price
    p.cf_items_ordinary = cf_items_ordinary

    db.commit()
    db.close()

    if redirect_to_dashboard == "1":
        return RedirectResponse(url="/?msg=แก้ไขสินค้าสำเร็จ", status_code=303)
    return {"message": "updated"}

# delete proudct
@app.delete("/api/products/{idx}")
def api_delete_product(idx: int):
    db = SessionLocal()
    p = db.query(ProductList).filter(ProductList.idx == idx).first()
    if not p:
        db.close()
        raise HTTPException(status_code=404, detail="ไม่พบสินค้า")
    db.delete(p)
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


@app.get("/api/invoices/check-number")
def api_check_invoice_number(number: str = Query(..., min_length=1)):
    db = SessionLocal()
    try:
        exists = db.query(models.Invoice).filter(models.Invoice.invoice_number == number).first() is not None
        return {"exists": bool(exists)}
    finally:
        db.close()
        
@app.post("/preview", response_class=HTMLResponse)
async def preview(request: Request, payload: dict):
     return templates.TemplateResponse(
        "invoice.html",
        {
            "request": request,   # << ต้องมีเสมอ
            "invoice": payload,   # << ส่งทั้งก้อนเป็น invoice
            "discount": payload.get("discount", 0),
            "vat_rate": payload.get("vat_rate", 7)
        }
     )

@app.get("/export-pdf/{invoice_id}")
async def export_pdf(invoice_id: int):
    invoice = crud.get_invoice(invoice_id)
    pdf_path = pdf_generator.generate_invoice_pdf(invoice)
    return FileResponse(pdf_path, media_type="application/pdf", filename="invoice.pdf")
