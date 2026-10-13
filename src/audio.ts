// ---------- Audio utilities: G.711 μ-law + resampling ----------
// โทรศัพท์ = 8kHz, Gemini Live input = 16kHz PCM16, output = 24kHz PCM16

const BIAS = 0x84;
const CLIP = 32635;

export function mulawDecode(u8: Uint8Array): Int16Array {
  const out = new Int16Array(u8.length);
  for (let i = 0; i < u8.length; i++) {
    const u = ~u8[i] & 0xff;
    const exponent = (u >> 4) & 0x07;
    const mantissa = u & 0x0f;
    const sample = (((mantissa << 3) + BIAS) << exponent) - BIAS;
    out[i] = u & 0x80 ? -sample : sample;
  }
  return out;
}

export function mulawEncode(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let s = pcm[i];
    const sign = s < 0 ? 0x80 : 0;
    if (sign) s = -s;
    if (s > CLIP) s = CLIP;
    s += BIAS;
    let exponent = 7;
    for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
    const mantissa = (s >> (exponent + 3)) & 0x0f;
    out[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return out;
}

/** Buffer (LE bytes) -> Int16Array (copy เพื่อกัน byteOffset ไม่ align) */
export function int16FromBuf(b: Buffer): Int16Array {
  const out = new Int16Array(b.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(i * 2);
  return out;
}

export function bufFromInt16(pcm: Int16Array): Buffer {
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}

/** 8kHz -> 16kHz (linear interpolation, เก็บ state ข้าม chunk) */
export class Upsampler8to16 {
  private prev = 0;
  process(x: Int16Array): Int16Array {
    const out = new Int16Array(x.length * 2);
    for (let i = 0; i < x.length; i++) {
      out[2 * i] = (this.prev + x[i]) >> 1;
      out[2 * i + 1] = x[i];
      this.prev = x[i];
    }
    return out;
  }
}

// low-pass FIR (windowed-sinc, Hamming) ตัดที่ 3.4kHz ก่อนลด 24k -> 8k กันเสียงแหลมพับกลับ (aliasing) จนเสียงแตก/เหมือนหุ่นยนต์
const FIR = (() => {
  const n = 47;
  const fc = 3400 / 24000;
  const h = Array.from({ length: n }, (_, i) => {
    const m = i - (n - 1) / 2;
    const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    return sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  });
  const sum = h.reduce((a, b) => a + b, 0);
  return h.map((v) => v / sum);
})();

/** 24kHz -> 8kHz (FIR low-pass + decimate 3, เก็บ state ข้าม chunk) */
export class Downsampler24to8 {
  private rest = new Int16Array(FIR.length - 1);
  process(x: Int16Array): Int16Array {
    const all = new Int16Array(this.rest.length + x.length);
    all.set(this.rest);
    all.set(x, this.rest.length);
    const n = all.length < FIR.length ? 0 : Math.floor((all.length - FIR.length) / 3) + 1;
    const out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = 0; k < FIR.length; k++) acc += FIR[k] * all[3 * i + k];
      out[i] = Math.max(-32768, Math.min(32767, Math.round(acc)));
    }
    this.rest = all.slice(n * 3);
    return out;
  }
}

/** PCM16 mono -> ไฟล์ WAV (ใช้ debug เสียง) */
export function wav8k(pcm: Buffer, rate = 8000): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
