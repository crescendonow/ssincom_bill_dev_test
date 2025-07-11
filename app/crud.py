from .models import Invoice, InvoiceItem
from .database import SessionLocal
from sqlalchemy.orm import joinedload

def create_invoice(data, items_data):
    db = SessionLocal()
    invoice = Invoice(**data)
    db.add(invoice)
    db.flush()
    for item in items_data:
        amount = item['quantity'] * item['unit_price']
        db.add(InvoiceItem(**item, amount=amount, invoice_id=invoice.id))
    db.commit()
    db.refresh(invoice)
    db.close()
    return invoice

def get_invoice(invoice_id):
    db = SessionLocal()
    invoice = db.query(Invoice)\
    .options(joinedload(Invoice.items))\
    .filter(Invoice.id == invoice_id)\
    .first()
    db.close()
    return invoice
