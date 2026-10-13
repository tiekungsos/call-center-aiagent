// npx tsx src/audio.check.ts -> เช็คว่า downsampler ผ่านเสียงพูด และตัดความถี่ที่จะ alias
import assert from 'node:assert';
import { Downsampler24to8 } from './audio.js';

function gainAt(hz: number) {
  const d = new Downsampler24to8();
  const x = Int16Array.from({ length: 24000 }, (_, i) => 10000 * Math.sin((2 * Math.PI * hz * i) / 24000));
  // ป้อนเป็นชิ้นขนาดไม่เท่ากัน เพื่อเช็ค state ข้าม chunk
  const out = [...d.process(x.subarray(0, 1234)), ...d.process(x.subarray(1234, 1235)), ...d.process(x.subarray(1235))];
  const tail = out.slice(1000);
  return Math.sqrt(tail.reduce((a, v) => a + v * v, 0) / tail.length) / (10000 / Math.SQRT2);
}
assert(Math.abs(gainAt(1000) - 1) < 0.05, `1kHz ${gainAt(1000)}`);
assert(gainAt(3000) > 0.7, `3kHz ${gainAt(3000)}`);
assert(gainAt(6000) < 0.02, `6kHz ${gainAt(6000)}`);
console.log('audio ok', { '1k': gainAt(1000).toFixed(3), '3k': gainAt(3000).toFixed(3), '6k': gainAt(6000).toFixed(4) });
