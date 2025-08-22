FROM python:3.11-slim

RUN apt-get update && apt-get install -y 
build-essential \
libcairo2 libpango1.0-0 \
libpangocairo-1.0-0 \
libgdk-pixbuf-2.0-0 \
libffi-dev \ 
libglib2.0-0 fonts-liberation fonts-dejavu-core fonts-thai-tlwg curl && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY ./app /app/app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
