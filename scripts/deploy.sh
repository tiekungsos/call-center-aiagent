#!/usr/bin/env sh
# Deploy บน server — รันจาก root ของ repo (เช่น /root/aileo-callcenter)
#   ./scripts/deploy.sh
#
# หลักการ:
#   - โค้ดใน src/ ถูก mount เข้า container แบบ live (tsx watch) -> แก้แล้วมีผลทันที
#   - .env / docker-compose เปลี่ยน -> docker compose จะ recreate container ให้เอง
#   - docker/asterisk/ เปลี่ยน -> rebuild image asterisk (จะตัดสายที่กำลังคุยอยู่ชั่วคราว)
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

# asterisk: rebuild เฉพาะเมื่อ config/image เปลี่ยน (docker/sip-test ไม่ต้อง)
if echo "$changed" | grep -qE '^docker/asterisk/'; then
  echo "[deploy] docker/asterisk เปลี่ยน -> rebuild + recreate asterisk"
  docker compose up -d --build asterisk
fi

# compose เปลี่ยน (เช่น publish port) -> recreate ทุก service
if echo "$changed" | grep -qE '^docker-compose.*\.ya?ml$'; then
  echo "[deploy] compose เปลี่ยน -> recreate ทุก service"
  docker compose up -d
fi

if echo "$changed" | grep -qE '^package(-lock)?\.json$'; then
  echo "[deploy] dependencies เปลี่ยน -> recreate bridge"
  docker compose up -d --force-recreate bridge
elif echo "$changed" | grep -qE '^(src|db)/'; then
  # อย่าพึ่ง tsx watch: inotify ไม่ส่ง event ข้าม bind mount ได้เสมอ (เจอแล้วว่าโค้ดใหม่ไม่ถูกโหลด)
  echo "[deploy] src/db เปลี่ยน -> restart bridge ให้แน่นอน"
  docker compose restart bridge
else
  docker compose up -d bridge
fi

docker compose ps
