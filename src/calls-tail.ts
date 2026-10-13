// npm run calls:tail [callId] -> แสดง transcript / tool calls / latency ของสายล่าสุด (หรือ callId ที่ระบุ) แบบ follow
import 'dotenv/config';
import { readdirSync, readFileSync, statSync, watchFile } from 'node:fs';

const DIR = process.env.LOG_DIR ?? './logs';
const c = (n: number, s: string) => `\x1b[${n}m${s}\x1b[0m`;

const id = process.argv[2];
const latest = readdirSync(DIR)
  .filter((f) => f.endsWith('.jsonl') && (!id || f.startsWith(id)))
  .map((f) => ({ f, t: statSync(`${DIR}/${f}`).mtimeMs }))
  .sort((a, b) => b.t - a.t)[0];
if (!latest) {
  console.log(`ไม่พบ log ใน ${DIR}`);
  process.exit(1);
}
const file = `${DIR}/${latest.f}`;
console.log(c(1, `▶ ${latest.f}`) + c(2, '  (Ctrl-C เพื่อออก)'));

function show(e: Record<string, any>) {
  const t = c(2, new Date(e.ts).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }));
  switch (e.type) {
    case 'transcript':
      return console.log(t, e.role === 'caller' ? c(36, `ผู้โทร: ${e.text}`) : c(32, `AI    : ${e.text}`));
    case 'tool':
      return console.log(t, c(33, `🔧 ${e.name}(${JSON.stringify(e.args)}) → ${JSON.stringify(e.result)}`));
    case 'latency':
      return console.log(t, c(35, `⏱  ${e.fromTranscriptMs}ms หลัง transcript, ${e.fromSpeechEndMs ?? '-'}ms หลังเสียงผู้โทรจบ`));
    case 'action':
      return console.log(t, c(1, `➡  ${e.action}`));
    case 'error':
      return console.log(t, c(31, `❌ ${e.stage}: ${e.message}`));
    case 'call_start':
    case 'call_end':
      return console.log(t, c(2, `── ${e.type === 'call_start' ? 'เริ่มสาย' : 'จบสาย'} ──`));
    default: {
      const { ts, type, ...rest } = e;
      return console.log(t, c(2, `${type} ${JSON.stringify(rest)}`));
    }
  }
}

let pos = 0;
let partial = '';
function read() {
  const buf = readFileSync(file);
  if (buf.length < pos) pos = 0;
  const lines = (partial + buf.subarray(pos).toString()).split('\n');
  pos = buf.length;
  partial = lines.pop() ?? '';
  for (const l of lines) if (l.trim()) show(JSON.parse(l));
}
read();
watchFile(file, { interval: 300 }, read);
