from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base

class Invoice(Base):
    __tablename__ = "invoices"
    id = Column(Integer, primary_key=True)
    invoice_number = Column(String)
    invoice_date = Column(Date)
    customer_name = Column(String)
    customer_taxid = Column(String)
    customer_address = Column(String)
    items = relationship("InvoiceItem", back_populates="invoice")

class InvoiceItem(Base):
    __tablename__ = "invoice_items"
    id = Column(Integer, primary_key=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"))
    product_code = Column(String)
    description = Column(String)
    quantity = Column(Float)
    unit_price = Column(Float)
    amount = Column(Float)
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
   