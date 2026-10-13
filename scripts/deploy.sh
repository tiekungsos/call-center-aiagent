#!/usr/bin/env sh
# Deploy บน server — รันจาก root ของ repo (เช่น /opt/aileo-callcenter)
#   ./scripts/deploy.sh
#
# หลักการ:
#   - โค้ดใน src/ ถูก mount เข้า container แบบ live (tsx watch) -> แก้แล้วมีผลทันที
#   - .env / docker-compose เปลี่ยน -> docker compose จะ recreate container ให้เอง
#   - docker/ เปลี่ยน -> rebuild image asterisk (จะตัดสายที่กำลังคุยอยู่ชั่วคราว)
#   - package.json เปลี่ยน -> recreate bridge เพื่อรัน npm install ใหม่
set -eu
cd "$(dirname "$0")/.."

git fetch --prune origin
before=$(git rev-parse HEAD)
git pull --ff-only
after=$(git rev-parse HEAD)
changed=$(git diff --name-only "$before" "$after" 2>/dev/null || true)

if [ -n "$changed" ]; then
  echo "[deploy] ไฟล์ที่เปลี่ยน $before..$after:"
  echo "$changed" | sed 's/^/  - /'
else
  echo "[deploy] ไม่มีไฟล์เปลี่ยน (HEAD = $after)"
fi

if echo "$changed" | grep -qE '^docker/'; then
  echo "[deploy] docker/ เปลี่ยน -> rebuild + recreate asterisk"
  docker compose up -d --build asterisk
fi

if echo "$changed" | grep -qE '^package(-lock)?\.json$'; then
  echo "[deploy] dependencies เปลี่ยน -> recreate bridge"
  docker compose up -d --force-recreate bridge
else
  docker compose up -d bridge
fi

docker compose ps
