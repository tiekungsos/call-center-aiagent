import crypto from 'node:crypto';
import { ChatSession } from './session.js';

const sessions = new Map<string, ChatSession>();

/** ตรวจ signature ของ LINE (X-Line-Signature = HMAC-SHA256 ของ raw body ด้วย channel secret) */
export function verifyLineSignature(rawBody: Buffer, signature?: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function getSession(userId: string): Promise<ChatSession> {
  const existing = sessions.get(userId);
  if (existing) return existing;
  const s = new ChatSession(`line-${userId.slice(-12)}`, userId, 'chat');
  sessions.set(userId, s);
  await s.start();
  return s;
}

async function reply(replyToken: string, text: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return;
  const r = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: text.slice(0, 4900) || 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว' }] }),
  });
  if (!r.ok) console.error('[line] reply failed', r.status, await r.text());
}

/** จัดการ webhook ของ LINE OA */
export async function handleLineWebhook(body: { events?: LineEvent[] }) {
  for (const ev of body?.events ?? []) {
    if (ev.type !== 'message' || ev.message?.type !== 'text' || !ev.message.text) continue;
    const userId = ev.source?.userId;
    if (!userId || !ev.replyToken) continue;
    try {
      const session = await getSession(userId);
      const out = await session.send(ev.message.text);
      await reply(ev.replyToken, out.text);
      if (out.action === 'hangup') {
        session.close();
        sessions.delete(userId);
      }
    } catch (err) {
      console.error('[line]', (err as Error).message);
      await reply(ev.replyToken, 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง');
    }
  }
}

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type?: string; text?: string };
}
