// Adapter: Asterisk AudioSocket (TCP, slin16 8kHz) — ใช้กับ SIP trunk ไทย (NT/AIS/True) หรือตู้ PBX ของหน่วยงาน
// Protocol: [kind:1][len:2 BE][payload]  kind: 0x00 hangup, 0x01 uuid, 0x10 audio, 0xff error
import { writeFileSync } from 'node:fs';
import net from 'node:net';
import { bufFromInt16, Downsampler24to8, int16FromBuf, wav8k } from './audio.js';
import { CallAgent } from './agent.js';
import { DIR as LOG_DIR } from './logger.js';
import type { CallAction } from './tools.js';

const KIND = { HANGUP: 0x00, UUID: 0x01, AUDIO: 0x10, ERROR: 0xff } as const;
const FRAME_BYTES = 320; // 20ms @ 8kHz 16-bit mono
// DEBUG_AUDIO=1 -> เก็บเสียงทั้งสายใน RAM (~16KB/s ต่อทิศ) แล้วเซฟ logs/<callId>.in.wav / .out.wav ตอนวางสาย
const DEBUG_AUDIO = process.env.DEBUG_AUDIO === '1';

// dialplan จะ CURL มาถามว่าหลังจบ AudioSocket ให้ทำอะไรต่อ (transfer/emergency/hangup)
const nextActions = new Map<string, CallAction>();
export function takeNextAction(uuid: string): CallAction {
  const a = nextActions.get(uuid) ?? 'hangup';
  nextActions.delete(uuid);
  return a;
}

function frame(kind: number, payload: Buffer) {
  const h = Buffer.alloc(3);
  h[0] = kind;
  h.writeUInt16BE(payload.length, 1);
  return Buffer.concat([h, payload]);
}

function formatUuid(b: Buffer) {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function startAudioSocketServer(port: number, host: string) {
  net
    .createServer((sock) => {
      let inBuf = Buffer.alloc(0);
      let outQ = Buffer.alloc(0);
      let uuid = '';
      let agent: CallAgent | undefined;
      let pending: CallAction | undefined;
      const down = new Downsampler24to8();
      const rec = { in: [] as Buffer[], out: [] as Buffer[] };

      // Asterisk ต้องการเสียงแบบ real-time -> ปล่อยทีละ 20ms
      const pacer = setInterval(() => {
        if (outQ.length >= FRAME_BYTES) {
          sock.write(frame(KIND.AUDIO, outQ.subarray(0, FRAME_BYTES)));
          outQ = outQ.subarray(FRAME_BYTES);
        } else if (pending) {
          nextActions.set(uuid, pending);
          setTimeout(() => nextActions.delete(uuid), 60_000);
          pending = undefined;
          sock.end(frame(KIND.HANGUP, Buffer.alloc(0))); // ออกจาก AudioSocket() ไปทำ dialplan ต่อ
        }
      }, 20);

      sock.on('data', (chunk) => {
        inBuf = Buffer.concat([inBuf, chunk]);
        while (inBuf.length >= 3) {
          const kind = inBuf[0];
          const len = inBuf.readUInt16BE(1);
          if (inBuf.length < 3 + len) break;
          const payload = inBuf.subarray(3, 3 + len);
          inBuf = inBuf.subarray(3 + len);

          if (kind === KIND.UUID && !agent) {
            uuid = formatUuid(payload);
            agent = new CallAgent(uuid);
            agent.on('audio', (pcm24: Int16Array) => {
              const pcm8 = bufFromInt16(down.process(pcm24));
              if (DEBUG_AUDIO) rec.out.push(Buffer.from(pcm8));
              outQ = Buffer.concat([outQ, pcm8]);
            });
            agent.on('interrupted', () => (outQ = Buffer.alloc(0)));
            agent.on('action', (a: CallAction) => (pending = a));
            void agent.start();
          } else if (kind === KIND.AUDIO) {
            if (DEBUG_AUDIO) rec.in.push(Buffer.from(payload));
            agent?.pushPcm8k(int16FromBuf(Buffer.from(payload)));
          } else if (kind === KIND.HANGUP) {
            sock.end();
          }
        }
      });

      const cleanup = () => {
        clearInterval(pacer);
        agent?.close();
        if (DEBUG_AUDIO && uuid && rec.in.length + rec.out.length) {
          writeFileSync(`${LOG_DIR}/${uuid}.in.wav`, wav8k(Buffer.concat(rec.in)));
          writeFileSync(`${LOG_DIR}/${uuid}.out.wav`, wav8k(Buffer.concat(rec.out)));
          rec.in = rec.out = [];
        }
      };
      sock.on('close', cleanup);
      sock.on('error', cleanup);
    })
    .listen(port, host, () => console.log(`AudioSocket listening ${host}:${port}`));
}
