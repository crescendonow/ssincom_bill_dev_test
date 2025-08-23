# Python 3.11 บน Debian bookworm (stable)
FROM python:3.11-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ไลบรารี cairo/pango/pixbuf + ฟอนต์ (มีไทย)
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

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# คัดลอกโค้ดทั้งหมด (ต้องมีโฟลเดอร์ app/ ภายในโปรเจกต์)
COPY ./app /app/app

# ทำงานในโฟลเดอร์โค้ดโดยตรง -> import เป็น main:app
WORKDIR /app

COPY entrypoint.sh /app/entrypoint.sh
CMD ["/app/entrypoint.sh"]

