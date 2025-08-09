from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base

# ===== invoices (schema ss_invoices) =====
class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = {"schema": "ss_invoices"}

    idx = Column(Integer, primary_key=True)              # PK
    invoice_number = Column(String)                      # เลขที่ใบกำกับ
    invoice_date = Column(Date)                          # วันที่
    grn_number = Column(String)                          # เลขที่ใบรับสินค้า
    dn_number = Column(String)                           # เลขที่ใบส่งสินค้า
    po_number = Column(String)                           # เลขที่ใบสั่งซื้อ 
    fname = Column(String)                               # ชื่อลูกค้า
    personid = Column(String)                            # รหัสลูกค้า (ถ้ายังไม่มี ส่งค่าว่างได้)
    tel = Column(String)
    mobile = Column(String)
    cf_personaddress = Column(String)
    cf_personzipcode = Column(String)
    cf_provincename = Column(String)
    cf_taxid = Column(String(13))
    fmlpaymentcreditday = Column(Integer)

    items = relationship("InvoiceItem", back_populates="invoice", cascade="all, delete-orphan")

# ===== invoice_items (schema ss_invoices) =====
class InvoiceItem(Base):
    __tablename__ = "invoice_items"
    __table_args__ = {"schema": "ss_invoices"}

    idx = Column(Integer, primary_key=True)  # PK
    # FK -> ss_invoices.invoices(invoice_number)
    invoice_number = Column(Integer, ForeignKey("ss_invoices.invoices.invoice_number"), index=True)

    personid = Column(String)                     # รหัสลูกค้า (ถ้ามี)
    cf_itemid = Column(String(6))                 # รหัสสินค้า
    cf_itemname = Column(String(1000))            # ชื่อสินค้า
    cf_unitname = Column(String(20))              # หน่วย (ยังไม่เก็บจากฟอร์มก็เว้นว่างได้)
    cf_itempricelevel_price = Column(Float)     # ราคา/หน่วย
    cf_items_ordinary = Column(Integer)           # ลำดับ
    quantity = Column(Float)                      # จำนวน
    amount = Column(Float)                        # จำนวนเงิน (qty * price)

    invoice = relationship("Invoice", back_populates="items")
    

#get data from customer_list
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
    fmlpaymentcreditday = Column(Integer)
 
#get data from product_list   
class ProductList(Base):
    __tablename__ = "product_list"
    __table_args__ = {"schema": "products"}

    idx = Column(Integer, primary_key=True, index=True)
    cf_itemid = Column(String(6))           # product id
    cf_itemname = Column(String(1000))      # product name
    cf_unitname = Column(String(20))        # unit
    cf_itempricelevel_price = Column(Float) # price
    cf_items_ordinary = Column(Integer)     # order/status
   