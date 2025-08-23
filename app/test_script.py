# main.py (เวอร์ชันทดสอบ)
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Test successful!"}

@app.get("/healthz")
def healthz():
    return {"ok": True}