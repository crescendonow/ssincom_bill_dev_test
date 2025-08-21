FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libcairo2 libpango-1.0-0 libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 libgdk-pixbuf2.0-bin libffi-dev libglib2.0-0 \
    ca-certificates curl fonts-liberation fonts-dejavu-core \
    fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# โค้ดจะอยู่ที่ /app/app แต่เราจะ WORKDIR เข้าไปเพื่อ import เป็น main:app
COPY ./app /app/app
WORKDIR /app/app

CMD ["sh","-c","uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
