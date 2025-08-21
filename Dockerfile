# ใช้กับ python:3.11-slim (Debian trixie/bookworm)
ENV DEBIAN_FRONTEND=noninteractive

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

WORKDIR /app
COPY ./app /app/app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
RUN apt-get update && apt-get install -y --no-install-recommends fonts-thai-tlwg && rm -rf /var/lib/apt/lists/*

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
