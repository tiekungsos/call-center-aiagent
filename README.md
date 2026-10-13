# AILEO Police Call Center — Gemini 3.8 Live

AI รับสายโทรศัพท์ประชาชนแทนเจ้าหน้าที่ด่านแรก 24 ชม. ตอบคำถามจากฐานความรู้ที่หน่วยงานอนุมัติ
และ **โอนสายหาคนทันที** เมื่อเป็นเหตุด่วน / เรื่องเกินขอบเขต / ระบบ AI ล่ม

```mermaid
flowchart LR
  P[ประชาชนโทรเข้า] --> T{ช่องทาง}
  T -->|PoC| TW[Twilio Media Streams<br/>μ-law 8k WS]
  T -->|Production| AST[Asterisk + SIP trunk ไทย<br/>AudioSocket 8k TCP]
  TW --> B[Bridge Node.js<br/>8k↔16k/24k resample]
  AST --> B
  B <-->|WSS PCM16| G[gemini-3.8-live]
  G -->|function call| TOOLS[report_emergency<br/>transfer_to_officer<br/>create_case_ticket<br/>end_call]
  TOOLS -->|โอนสาย| OFF[เจ้าหน้าที่ / 191]
  B --> LOG[logs/*.jsonl<br/>transcript + tickets]
```

## โครงสร้าง
| ไฟล์ | หน้าที่ |
|---|---|
| `src/agent.ts` | 1 สาย = 1 `CallAgent` = 1 Gemini Live session, tool calls, session resumption, รอพูดจบก่อนโอนสาย |
| `src/prompt.ts` | ประกอบ system prompt จากโปรไฟล์ (persona + PDPA + เครื่องมือ + สไตล์พูด + ฐานความรู้) |
| `src/profiles/` | **บริบทธุรกิจ** — `police` / `hospital` / `hotel` / `retail` / `pawnshop` (persona + ฐานความรู้ + เครื่องมือ) |
| `src/kb.ts` | ฐานความรู้ตำรวจ — **ต้องให้หน่วยงานเติม/อนุมัติ** |
| `src/tools.ts` | เครื่องมือกลาง + เครื่องมือเฉพาะธุรกิจ, Function declarations + handler (ต่อ API จริงตรง TODO) |
| `src/twilio.ts` | Adapter Twilio (ทดสอบเร็ว) |
| `src/audiosocket.ts` | Adapter Asterisk AudioSocket (ใช้เบอร์ไทยจริง) |
| `src/audio.ts` | G.711 μ-law, resample 8k→16k, 24k→8k |

## บริบทธุรกิจ (Profile)
ตัว agent ไม่ผูกกับธุรกิจใดธุรกิจหนึ่งอีกต่อไป เลือกบริบทด้วย env `AGENT_PROFILE`:

| `AGENT_PROFILE` | ธุรกิจ | เครื่องมือเฉพาะ |
|---|---|---|
| `police` (ค่าเริ่มต้น) | ศูนย์บริการข้อมูลตำรวจ | `report_emergency` |
| `hospital` | โรงพยาบาล / คลินิก | `report_emergency`, `book_appointment` |
| `hotel` | โรงแรม / ร้านอาหาร | `book_reservation` |
| `retail` | ร้านค้า / อีคอมเมิร์ซ | `check_order` |
| `pawnshop` | โรงรับจำนำ (ควิกมันนี่) | `check_pawn_ticket` |

ทุกโปรไฟล์ได้เครื่องมือกลาง `transfer_to_agent`, `create_ticket`, `end_call` อัตโนมัติ

```bash
AGENT_PROFILE=hotel npm run dev          # สลับเป็นบริบทโรงแรม
AGENT_PROFILE=hospital BUSINESS_NAME="รพ.ตัวอย่าง" npm run dev
```

- `BUSINESS_NAME` แทนที่ `{{business}}` ใน prompt และฐานความรู้ (ไม่ใส่ = ชื่อเริ่มต้นของโปรไฟล์)
- `VOICE` เปลี่ยนเสียงของโมเดลได้เหมือนเดิม
- เพิ่มธุรกิจใหม่: สร้างไฟล์ใน `src/profiles/` ตาม `BusinessProfile` แล้วลงทะเบียนใน `src/profiles/index.ts` — ไม่ต้องแตะ `agent.ts`

## รัน
```bash
cp .env.example .env   # ใส่ GEMINI_API_KEY
npm install
npm run dev
```

## ทางเลือก A: Twilio (PoC)
1. ตั้ง Voice webhook ของเบอร์เป็น `POST https://PUBLIC_HOST/twilio/voice`
2. reverse proxy (Caddy/nginx) ให้ `wss://PUBLIC_HOST/twilio` → `:8080`
3. Production ต้องเพิ่ม validate `X-Twilio-Signature`

## ทางเลือก B: Asterisk + SIP trunk ไทย (แนะนำสำหรับของจริง)
ต้องใช้ Asterisk 18+ ที่มี `app_audiosocket` และ `func_curl`

`extensions.conf`
```
[police-ai]
exten => _X.,1,Answer()
 same => n,Set(CALLID=${SHELL(uuidgen | tr -d '\n')})
 same => n,AudioSocket(${CALLID},127.0.0.1:9093)
 same => n,Set(NEXT=${CURL(http://127.0.0.1:8080/next/${CALLID})})
 same => n,GotoIf($["${NEXT}" = "emergency"]?emergency)
 same => n,GotoIf($["${NEXT}" = "transfer"]?officer)
 same => n,Hangup()
 same => n(emergency),Queue(emergency-desk,t,,,30)
 same => n,Dial(${EMERGENCY_TRUNK})
 same => n(officer),Queue(officer-desk,t)
 same => n,Hangup()
```
ใช้ dialplan ฉบับแก้แล้วใน `docker/asterisk/etc/extensions.conf.tmpl` แทนตัวอย่างข้างบน:
Asterisk 20 `AudioSocket()` คืน -1 ทุกครั้งที่ bridge ส่ง hangup frame (และตอน connect ไม่ได้) → ถ้าไม่ครอบ `TryExec()` สายจะถูกวางทิ้งก่อนถึง `CURL` เสมอ
และถ้า bridge ล่ม/`NEXT` ว่าง จะโอนไป `officer` (fail-safe)

## ทดสอบด้วย Softphone (LAN, ไม่เสียค่าโทร)

### เตรียม
```bash
cp .env.example .env
# ใส่ GEMINI_API_KEY, ASTERISK_BIND_IP=<IP LAN ของเครื่อง>, SIP_PASSWORD_1001/2001/2002 (สุ่ม ≥ 20 ตัว)
# Mac/Windows (Docker Desktop): เปิดบรรทัด COMPOSE_FILE=... ใน .env
docker compose up -d --build
docker compose exec asterisk asterisk -rx "pjsip show endpoints"   # ต้องเห็น 1001 2001 2002
```
- Linux: asterisk + bridge ใช้ `network_mode: host`, SIP bind เฉพาะ `ASTERISK_BIND_IP` (ถ้า IP ไม่อยู่บนเครื่อง container จะไม่ยอม start)
- Docker Desktop: `docker-compose.desktop.yml` publish `5060/udp` + `10000-10100/udp` เฉพาะ IP LAN และตั้ง `external_*_address` ให้อัตโนมัติ
- config อยู่ที่ `docker/asterisk/etc/` (mount เป็น `/config` แล้ว render `*.tmpl` ลง `/etc/asterisk` ตอน start เพื่อไม่ให้รหัสผ่านถูกเขียนลง repo) → แก้ config แล้ว `docker compose restart asterisk` แต่ถ้าแก้ `.env` (รหัสผ่าน/IP) ต้อง `docker compose up -d asterisk` (restart ไม่โหลด env ใหม่)
- บันทึกเสียงทั้งสาย: `recordings/<CALLID>.wav` (`RECORD_CALLS=1`), debug เสียง bridge: `DEBUG_AUDIO=1` → `logs/<callId>.in.wav` / `.out.wav`
- ดูสายล่าสุด: `npm run calls:tail` (transcript, tool calls, latency ต่อ turn)

| Extension | บทบาท |
|---|---|
| 1001 | ผู้โทร (ประชาชนจำลอง) |
| 2001 | เจ้าหน้าที่ (`officer-desk`) |
| 2002 | โต๊ะเหตุด่วน (`emergency-desk`) |
| 1599 | เข้า AI (`police-ai`) |
| 600 / 601 | echo test / เล่นเสียงทดสอบ + tone |

### ตั้งค่า Zoiper (มือถือ, วง Wi-Fi เดียวกัน)
Settings → Accounts → Add → SIP
- Username: `1001` (หรือ 2001/2002 บนเครื่องที่เป็นเจ้าหน้าที่)
- Password: `SIP_PASSWORD_1001` จาก `.env`
- Domain / Host: `<ASTERISK_BIND_IP>` (port 5060)
- Transport: **UDP**, ปิด STUN / ICE

### ตั้งค่า MicroSIP (Windows)
Menu → Add Account
- SIP Server: `<ASTERISK_BIND_IP>`, Domain: `<ASTERISK_BIND_IP>`
- Username / Login: `2001`, Password: `SIP_PASSWORD_2001`
- Transport: **UDP**, Public Address: ว่าง, ICE: ปิด

### ลำดับทดสอบ
1. **600** → ได้ยินเสียงแนะนำแล้วเสียงตัวเองสะท้อนกลับ (เช็ค RTP สองทาง ไม่ผ่าน AI)
2. **1599** → AI ทักทาย คุยได้ (`npm run calls:tail` ดู transcript/latency)
3. พูด **"ขอคุยกับเจ้าหน้าที่"** → AI พูดจบแล้ว 2001 ต้องดัง
4. เล่าเหตุด่วน (เช่น "มีคนถูกทำร้ายอยู่ตรงหน้า") → 2002 ต้องดัง (ไม่รับใน 30 วิ → ไป 2001)
5. `docker compose stop bridge` แล้วโทร **1599** → ต้องถูกโอนไป 2001 ทันที (fail-safe) → `docker compose start bridge`

ทดสอบอัตโนมัติแบบ headless (baresip ใน container, 2001/2002 auto-answer, 1001 เล่นไฟล์ wav เข้าสาย):
```bash
sh docker/sip-test/test-1599.sh docker/sip-test/hello.wav 40
```
ผลเสียงแต่ละฝั่งอยู่ที่ `logs/sip-test/<ext>/*-dec.wav`

### Troubleshooting
| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| Register ไม่ผ่าน (401/408) | รหัสผ่านไม่ตรง `.env`, domain ผิด IP, firewall เครื่องบล็อก UDP 5060 (macOS: อนุญาต Docker ใน Firewall), มือถืออยู่คนละวง Wi-Fi / Guest network ที่มี client isolation |
| เสียงทางเดียว / ไม่มีเสียง | RTP 10000-10100/udp ถูกบล็อก, softphone เปิด STUN/ICE (ปิด), บน Docker Desktop ต้องใช้ override (มี `external_media_address`) — เช็คด้วย 600 ก่อน |
| 1599 เงียบแล้วไป 2001 ทันที | bridge ไม่รัน / `/health` ไม่ตอบ → `docker compose logs bridge` |
| 1599 เงียบค้าง ไม่โอน | `GEMINI_API_KEY` ว่าง/ผิด → Gemini ปิด session แต่ agent ไม่โอน (ดู `logs/*.jsonl`) |
| `AudioSocket` connect refused | bridge ไม่ได้อยู่ network เดียวกับ asterisk (ต้อง host network หรือ `service:net`) |

```bash
docker compose exec asterisk asterisk -rvvv       # console สด
pjsip show endpoints                                # ใครลงทะเบียนแล้ว
pjsip show contacts                                 # IP:port ที่ softphone ลงทะเบียนมา
pjsip set logger on                                 # ดู SIP packet (INVITE/SDP)
rtp set debug on                                    # ดู RTP ว่าไหลทั้งสองทางไหม
queue show                                          # สถานะ officer-desk / emergency-desk
module show like audiosocket
```

## Checklist ก่อนขึ้นจริง
- [ ] หน่วยงานอนุมัติ `kb.ts` ทุกบรรทัด (เบอร์, URL, ขั้นตอน)
- [ ] ทดสอบชุด red-team: เหตุด่วนพูดอ้อมๆ, สำเนียงอีสาน/เหนือ/ใต้, เสียงรบกวน, ผู้สูงอายุพูดช้า, คนพยายาม jailbreak
- [ ] วัด latency จริงบนสายโทรศัพท์ (เป้า < 1s ถึงเสียงแรก), โหลดเทสต์สายพร้อมกัน vs rate limit ของ API key
- [ ] PDPA: ประกาศบันทึกเสียงต้นสาย, retention policy ของ logs, สัญญาประมวลผลข้อมูล (DPA) กับ Google/หน่วยงาน, พิจารณา Vertex AI region
- [ ] Fail-safe: Gemini ต่อไม่ได้ → โอนคนทันที (มีแล้วใน `agent.start()`), bridge ล่ม → dialplan โอนคน
- [ ] Dashboard ให้เจ้าหน้าที่เห็น summary/transcript ก่อนรับสายโอน (ต่อจาก `logs/*.jsonl`)
- [ ] เปลี่ยน resampler เป็น speexdsp/soxr ถ้าเสียงยังมี artifact
