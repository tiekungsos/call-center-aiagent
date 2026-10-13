#!/bin/sh
# ua.sh <ext> <password> <asterisk-ip> <seconds> [dial-target]
#   ไม่มี dial-target = รอรับสาย (auto answer); เสียงที่ได้ยินเซฟที่ /out/*.wav (sndfile), เสียงที่ส่งอ่านจาก /in.wav
set -eu
ext=$1 pass=$2 ip=$3 secs=$4 dial=${5:-}
mkdir -p /cfg /out
cat >/cfg/config <<CFG
module_path /usr/lib/baresip/modules
sip_listen 0.0.0.0:5060
audio_source aufile,/in.wav
audio_player aufile,/dev/null
audio_alert aufile,/dev/null
snd_path /out
module g711.so
module aufile.so
module sndfile.so
module_app account.so
module_app menu.so
CFG
echo "<sip:$ext@$ip>;auth_pass=$pass;answermode=auto;regint=60" >/cfg/accounts
[ -n "$dial" ] && set -- -e "/dial sip:$dial@$ip" || set --
exec baresip -f /cfg -t "$secs" "$@"
