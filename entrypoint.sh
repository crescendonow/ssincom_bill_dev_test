#!/bin/sh
# entrypoint.sh

# บรรทัดนี้จะรัน uvicorn โดยใช้ค่า PORT ที่ Railway ส่งมาให้
# หรือถ้าไม่มี จะใช้ค่า 8000 เป็นค่าเริ่มต้น
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}