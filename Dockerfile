# ใช้ Python 3.11 บน Debian bookworm (stable)
FROM python:3.11-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ติดตั้ง dependencies (cairo, pango, pixbuf, fonts รวมไทย)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    libglib2.0-0 \
    ca-certificates \
    curl \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-thai-tlwg \
    fonts-noto-core \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

# เตรียมไดเรกทอรีแอป
WORKDIR /app

# copy requirements และติดตั้ง python dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# copy โค้ดจริง
COPY ./app /app/app

# ใช้พอร์ตที่ Railway กำหนด ($PORT) ถ้าไม่มี fallback 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

