#!/bin/sh
# ทดสอบอัตโนมัติ: 2001/2002 รอรับสาย (auto answer), 1001 โทร 1599 แล้วเล่น wav เข้าสาย
# ใช้: sh docker/sip-test/test-1599.sh [wav 8kHz mono] [วินาที]
set -eu
cd "$(dirname "$0")/../.."
. ./.env
WAV=${1:-docker/sip-test/hello.wav}
SECS=${2:-40}
OUT=logs/sip-test
mkdir -p "$OUT"
docker build -q -t aileo-sip-test docker/sip-test >/dev/null
docker rm -f sip2001 sip2002 >/dev/null 2>&1 || true
for e in 2001 2002; do
  eval "p=\$SIP_PASSWORD_$e"
  docker run -d --name "sip$e" -v "$PWD/$WAV:/in.wav:ro" -v "$PWD/$OUT/$e:/out" aileo-sip-test "$e" "$p" "$ASTERISK_BIND_IP" $((SECS + 30)) >/dev/null
done
sleep 5
docker run --rm -v "$PWD/$WAV:/in.wav:ro" -v "$PWD/$OUT/1001:/out" aileo-sip-test 1001 "$SIP_PASSWORD_1001" "$ASTERISK_BIND_IP" "$SECS" 1599 >"$OUT/1001.log" 2>&1 || true
for e in 2001 2002; do docker logs "sip$e" >"$OUT/$e.log" 2>&1; docker rm -f "sip$e" >/dev/null; done
echo "== dialplan"; docker logs --since "$((SECS + 10))s" pc-asterisk-1 2>&1 | grep -aE 'police-ai .* NEXT=|Queue\(|is ringing|answered' | sed 's/\x1b\[[0-9;]*m//g' | tail -15
for e in 2001 2002; do grep -q 'Call established' "$OUT/$e.log" && echo "== $e รับสาย ✓" || echo "== $e ไม่ได้รับสาย"; done
ls -la "$OUT"/*/ 2>/dev/null | grep wav || true
