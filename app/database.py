import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL", "", sslmode="require")
engine = create_engine(DATABASE_URL, pool_pre_ping=True)  # pool_pre_ping กันคอนเนกชันค้าง
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()
