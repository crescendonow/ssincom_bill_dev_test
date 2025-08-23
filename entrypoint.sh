#!/bin/sh
# entrypoint.sh (เวอร์ชันสมบูรณ์ + Debug)

set -e # ให้สคริปต์หยุดทำงานทันทีถ้ามีคำสั่งไหนล้มเหลว

echo "--- Starting Entrypoint Script ---"

# --- ส่วน Debug ---
# พิมพ์ตัวแปร Environment ทั้งหมดที่มีใน Container ออกมาดู
echo "Printing all environment variables:"
printenv
echo "------------------------------------"
# ------------------

# ตรวจสอบว่ามีตัวแปร PORT หรือไม่ ถ้าไม่มีให้ใช้ 8000
PORT_TO_USE=${PORT:-8000}

echo "PORT variable is set to: $PORT"
echo "Uvicorn will be started on port: $PORT_TO_USE"

# รัน Uvicorn ด้วย exec เพื่อให้เป็น Process หลัก
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT_TO_USE"