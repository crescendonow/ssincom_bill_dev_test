# เลือก base image (ปัจจุบัน python:3.11-slim เป็น Debian trixie)
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ไลบรารีกราฟิก + ฟอนต์ (ชื่อแพ็กเกจถูกสำหรับ Debian)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libgdk-pixbuf2.0-bin \
    libffi-dev \
    libglib2.0-0 \
    ca-certificates \
    curl \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto-core \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

# (ตัวเลือก) ติดตั้งฟอนต์ไทย TLWG — ถ้า repo ไม่มี ให้ลบบรรทัดนี้ออก
RUN apt-get update && apt-get install -y --no-install-recommends fonts-thai-tlwg \
 || true && rm -rf /var/lib/apt/lists/*

# เตรียมไดเรกทอรีแอป
WORKDIR /app

# copy requirements ก่อนเพื่อ cache layer การติดตั้ง pip
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# ค่อย copy โค้ดแอป
COPY ./app /app/app

# รัน uvicorn โดยใช้พอร์ตจาก Railway ($PORT) ถ้าไม่มีให้ fallback 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
