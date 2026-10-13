import type { WebSocket } from 'ws';
import { ChatSession } from './session.js';

/** Web widget: 1 การเชื่อมต่อ = 1 ห้องแชท — ส่ง {text} เข้าไป รับ {type:'message', text} กลับ */
export function handleChatWs(ws: WebSocket) {
  const callId = 'web-' + Math.random().toString(36).slice(2, 10);
  const session = new ChatSession(callId, undefined, 'chat');
  const send = (o: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o));

  void session
    .start()
    .then((text) => send({ type: 'message', text }))
    .catch((err) => send({ type: 'error', text: String(err) }));

  ws.on('message', async (raw) => {
    let text = '';
    try {
      text = String((JSON.parse(raw.toString()) as { text?: string }).text ?? '').trim();
    } catch {
      text = raw.toString().trim();
    }
    if (!text) return;
    try {
      const out = await session.send(text);
      send({ type: 'message', text: out.text, action: out.action });
      if (out.action === 'hangup') ws.close();
    } catch (err) {
      send({ type: 'error', text: String(err) });
    }
  });

  ws.on('close', () => session.close());
}
