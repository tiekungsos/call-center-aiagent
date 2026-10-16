import crypto from 'node:crypto';
import * as store from './store.js';

/** P6: ยิง webhook ขาออกไป CRM/ERP เมื่อมี event — ลงนามด้วย HMAC-SHA256 (header X-Aileo-Signature) */
export async function emitEvent(
  tenantId: string | undefined,
  event: string,
  payload: Record<string, unknown>,
): Promise<number> {
  if (!tenantId) return 0;
  const hooks = (await store.activeWebhooks(tenantId, event)) ?? [];
  const body = JSON.stringify({ event, ts: new Date().toISOString(), ...payload });
  let sent = 0;
  for (const h of hooks) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (h.secret) headers['x-watee-signature'] = crypto.createHmac('sha256', h.secret).update(body).digest('hex');
    try {
      const r = await fetch(h.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) });
      if (r.ok) sent++;
      else console.error('[webhook]', h.url, r.status);
    } catch (err) {
      console.error('[webhook]', h.url, (err as Error).message);
    }
  }
  return sent;
}

/**
 * P6: warm transfer — ส่ง context ให้เจ้าหน้าที่ก่อนรับสาย (screen pop)
 * ยิงไป SCREENPOP_URL ถ้าตั้งไว้ หรือใช้ webhook event 'call.transfer'
 */
export async function screenPop(callId: string, tenantId?: string): Promise<void> {
  const detail = await store.getCallDetail(callId);
  if (!detail) return;
  const payload = {
    callId,
    callerNumber: detail.call.caller_number,
    action: detail.call.action,
    summary: detail.call.summary,
    intent: detail.call.intent,
    sentiment: detail.call.sentiment,
    turns: (detail.turns as { role: string; text: string }[]).slice(-10),
  };

  const url = process.env.SCREENPOP_URL;
  if (url) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) console.error('[screenpop]', r.status);
    } catch (err) {
      console.error('[screenpop]', (err as Error).message);
    }
  }
  await emitEvent(tenantId, 'call.transfer', payload);
}
