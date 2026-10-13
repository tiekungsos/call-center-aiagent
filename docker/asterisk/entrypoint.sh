#!/bin/sh
set -eu

: "${ASTERISK_BIND_IP:?ต้องตั้ง ASTERISK_BIND_IP (IP LAN ของเครื่อง) ใน .env}"
for v in SIP_PASSWORD_1001 SIP_PASSWORD_2001 SIP_PASSWORD_2002; do
  eval "p=\${$v:-}"
  echo "$p" | grep -Eq '^[A-Za-z0-9]{20,}$' || { echo "$v ต้องเป็น A-Za-z0-9 ยาว >= 20 ตัว" >&2; exit 1; }
done

# AMI (ให้ bridge สั่งโทรออก) — ถ้าไม่ตั้งจะสุ่มให้ เพื่อไม่ให้เปิด AMI ด้วยรหัสว่าง
if [ -z "${AMI_PASSWORD:-}" ]; then
  AMI_PASSWORD=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)
  echo "AMI_PASSWORD ไม่ได้ตั้ง -> สุ่มให้ (โทรออกจาก bridge จะใช้ไม่ได้จนกว่าจะตั้ง AMI_PASSWORD ใน .env)"
fi
export AMI_PASSWORD

# Linux + host network: bind ตรง IP LAN เท่านั้น
# Docker Desktop (Mac/Win): IP LAN ไม่อยู่ใน VM -> bind ใน container แล้ว publish port เฉพาะ IP LAN (docker-compose.desktop.yml)
if hostname -I | tr ' ' '\n' | grep -qx "$ASTERISK_BIND_IP"; then
  SIP_BIND=$ASTERISK_BIND_IP
  SIP_EXTERNAL=""
elif [ "${DOCKER_DESKTOP:-0}" = 1 ]; then
  SIP_BIND=0.0.0.0
  SIP_EXTERNAL="external_media_address=$ASTERISK_BIND_IP
external_signaling_address=$ASTERISK_BIND_IP"
else
  echo "ASTERISK_BIND_IP=$ASTERISK_BIND_IP ไม่มีบน interface ของเครื่องนี้ (มี: $(hostname -I)) — ไม่ยอม bind 0.0.0.0" >&2
  exit 1
fi
export SIP_BIND SIP_EXTERNAL RECORD_CALLS="${RECORD_CALLS:-1}" PORT="${PORT:-8080}" AUDIOSOCKET_PORT="${AUDIOSOCKET_PORT:-9093}"

# config ใน repo mount มาที่ /config (read-only) แล้ว render *.tmpl ลง /etc/asterisk เพื่อไม่ให้รหัสผ่านถูกเขียนกลับเข้า repo
rm -rf /etc/asterisk/*
cp /config/* /etc/asterisk/
for t in /etc/asterisk/*.tmpl; do
  envsubst '$SIP_BIND $SIP_EXTERNAL $SIP_PASSWORD_1001 $SIP_PASSWORD_2001 $SIP_PASSWORD_2002 $AMI_PASSWORD $RECORD_CALLS $PORT $AUDIOSOCKET_PORT' <"$t" >"${t%.tmpl}"
  rm "$t"
done
chown -R root:asterisk /etc/asterisk && chmod 640 /etc/asterisk/*
mkdir -p /recordings /var/run/asterisk
chown asterisk:asterisk /recordings /var/run/asterisk

exec asterisk -f -U asterisk -G asterisk -vvv
