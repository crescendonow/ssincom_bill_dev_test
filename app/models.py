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
    fname = Column(String)
    cf_personaddress = Column(String)
    cf_taxid = Column(String)
 
#get data from product_list   
class ProductList(Base):
    __tablename__ = "product_list"
    __table_args__ = {"schema": "products"}

    id = Column(Integer, primary_key=True, index=True)
    cf_itemid = Column(String)
    cf_itemname = Column(String)
    cf_itempricelevel_price = Column(Float)

   