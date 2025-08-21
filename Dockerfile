FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libcairo2 libpango-1.0-0 libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 libgdk-pixbuf2.0-bin libffi-dev libglib2.0-0 \
    ca-certificates curl \
    fonts-liberation fonts-dejavu-core \
    fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

# (ตัวเลือก) TLWG — ถ้า mirror ไม่มี ให้คอมเมนต์บรรทัดนี้
# RUN apt-get update && apt-get install -y --no-install-recommends fonts-thai-tlwg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# ต้องมีไฟล์ /app/app/__init__.py
COPY ./app /app/app

# ใช้พอร์ตของ Railway ผ่าน $PORT (fallback 8000)
CMD ["sh","-c","uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
