from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.templating import Jinja2Templates
from . import models, database, crud, pdf_generator
from datetime import date
from typing import List

app = FastAPI()
models.Base.metadata.create_all(bind=database.engine)
templates = Jinja2Templates(directory="app/templates")

@app.get("/", response_class=HTMLResponse)
async def form(request: Request):
    return templates.TemplateResponse("form.html", {"request": request})

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

@app.get("/export-pdf/{invoice_id}")
async def export_pdf(invoice_id: int):
    invoice = crud.get_invoice(invoice_id)
    pdf_path = pdf_generator.generate_invoice_pdf(invoice)
    return FileResponse(pdf_path, media_type="application/pdf", filename="invoice.pdf")
