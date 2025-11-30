# app/models.py
from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, Text
from sqlalchemy.orm import relationship, foreign
from .database import Base

# ------------------ Invoices (schema: ss_invoices) ------------------

class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = {"schema": "ss_invoices"}

    idx = Column(Integer, primary_key=True)          # PK (int)
    invoice_number = Column(String, index=True)      # เลขที่ใบกำกับ (varchar)
    invoice_date = Column(Date,index=True)         # วันที่ใบกำกับ (date)
    grn_number = Column(String)
    dn_number = Column(String)
    po_number = Column(String)

    # Customer fields snapshot ที่เก็บมากับบิล
    fname = Column(String)                 # ชื่อลูกค้า
    personid = Column(String,index=True)   # รหัสลูกค้า
    tel = Column(String)
    mobile = Column(String)
    cf_personaddress = Column(String)
    cf_personzipcode = Column(String)
    cf_provincename = Column(String)
    cf_taxid = Column(String(13))
    cf_branch = Column(String)

    fmlpaymentcreditday = Column(Integer)
    due_date = Column(Date)

    car_numberplate = Column(String)
    driver_id = Column(String(10), ForeignKey("products.drivers.driver_id"), index=True)

    # ความสัมพันธ์กับ items โดย match ที่ "เลขที่บิล (varchar)" ไม่ใช่ idx
    items = relationship(
        "InvoiceItem",
        primaryjoin="Invoice.invoice_number == foreign(InvoiceItem.invoice_number)",
        foreign_keys="[InvoiceItem.invoice_number]",
        back_populates="invoice",
        viewonly=True,  # ป้องกัน SQLA บังคับ unique/constraint ฝั่ง parent
    )


class InvoiceItem(Base):
    __tablename__ = "invoice_items"
    __table_args__ = {"schema": "ss_invoices"}

    idx = Column(Integer, primary_key=True)

    # สำคัญ: เก็บเป็น String และ FK ไปที่ invoices.invoice_number (varchar)
    invoice_number = Column(
        String,
        ForeignKey("ss_invoices.invoices.invoice_number"),
        index=True
    )

    personid = Column(String)
    cf_itemid = Column(String(6))
    cf_itemname = Column(String(1000))
    cf_unitname = Column(String(20))
    cf_itempricelevel_price = Column(Float)  # ราคาต่อหน่วย
    cf_items_ordinary = Column(Integer)      # อันดับ/ลำดับ
    quantity = Column(Float)
    amount = Column(Float)                   # จำนวนเงิน (ถ้า null จะคำนวณจาก qty*price ตอนรวม)

    invoice = relationship(
        "Invoice",
        primaryjoin="foreign(InvoiceItem.invoice_number) == Invoice.invoice_number",
        viewonly=True,
    )

# ------------------ Billing Notes (schema: ss_bills) ------------------

class BillNote(Base):
    __tablename__ = "bill_note"
    __table_args__ = {"schema": "ss_bills"}

    idx = Column(Integer, primary_key=True)  # serial4 NOT NULL
    billnote_number = Column(String, index=True, unique=True) # varchar NULL
    bill_date = Column(Date, index=True)
    payment_duedate = Column(Date)

    # Customer fields snapshot
    prename = Column(Text)
    fname = Column(Text)                 # text NULL
    personid = Column(Text)              # text NULL
    tel = Column(Text)                   # text NULL
    mobile = Column(Text)                # text NULL
    cf_personaddress = Column(Text)      # text NULL
    cf_personzipcode = Column(String)    # varchar NULL
    cf_provincename = Column(String)     # varchar NULL
    cf_taxid = Column(String(13))        # varchar(13) NULL

    # Relationship to items
    items = relationship(
        "BillNoteItem",
        primaryjoin="BillNote.billnote_number == foreign(BillNoteItem.billnote_number)",
        cascade="all, delete-orphan"
    )

class BillNoteItem(Base):
    __tablename__ = "bill_note_item"
    __table_args__ = {"schema": "ss_bills"}

    idx = Column(Integer, primary_key=True)
    billnote_number = Column(String, index=True) # Foreign key to BillNote.billnote_number
    
    # Details from the original invoice
    invoice_number = Column(String)
    invoice_date = Column(Date)
    due_date = Column(Date)
    amount = Column(Float)

# ------------------ Customers (schema: products) ------------------

class CustomerList(Base):
    __tablename__ = "customer_list"
    __table_args__ = {"schema": "products"}

    idx = Column(Integer, primary_key=True, index=True)
    prename = Column(String)
    sysprename = Column(String)
    fname = Column(String)
    personid = Column(String)
    tel = Column(String)
    mobile = Column(String)
    syspersonid = Column(String)
    sex = Column(String)
    lname = Column(String)

    cf_personaddress_tel = Column(String)
    cf_personaddress_mobile = Column(String)
    cf_personaddress = Column(String)
    cf_personzipcode = Column(String)
    cf_provincename = Column(String)
    cf_taxid = Column(String(13))
    cf_hq = Column(Integer)
    cf_branch = Column(String) 
    fmlpaymentcreditday = Column(Integer)

# ------------------ Products (schema: products) ------------------

class ProductList(Base):
    __tablename__ = "product_list"
    __table_args__ = {"schema": "products"}

    idx = Column(Integer, primary_key=True, index=True)
    cf_itemid = Column(String(6))
    cf_itemname = Column(String(1000))
    cf_unitname = Column(String(20))
    cf_itempricelevel_price = Column(Float)
    cf_items_ordinary = Column(Integer)

# ------------------ Cars (schema: products) ------------------

class Car(Base):
    __tablename__ = "ss_car"
    __table_args__ = {"schema": "products"}

    idx = Column(Integer, primary_key=True, index=True, autoincrement=True)
    number_plate = Column(String, unique=True, index=True)
    car_brand = Column(String)
    province = Column(String)

# ------------------ Dictionaries (schema: public) ------------------

class CarBrand(Base):
    __tablename__ = "car_brand"
    __table_args__ = {"schema": "public"}

    brand_name = Column(String, primary_key=True)

class ProvinceNostra(Base):
    __tablename__ = "province_nostra"
    __table_args__ = {"schema": "public"}

    prov_nam_t = Column(String, primary_key=True)
