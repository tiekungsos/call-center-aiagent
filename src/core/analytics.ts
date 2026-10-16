import * as store from './store.js';

const API_KEY = process.env.DEEPINFRA_API_KEY;
const BASE_URL = (process.env.DEEPINFRA_BASE_URL ?? 'https://api.deepinfra.com/v1/openai').replace(/\/+$/, '');
const MODEL = process.env.ANALYTICS_MODEL ?? 'deepseek-ai/DeepSeek-V4.1-Flash';

export interface CallAnalysis {
  summary: string;
  intent: string;
  sentiment: string;
}

const SYSTEM = `คุณเป็นระบบวิเคราะห์บทสนทนาบริการลูกค้าทางโทรศัพท์/แชท
ตอบเป็น JSON เท่านั้น ตาม schema: {"summary": string, "intent": string, "sentiment": string}
- summary: สรุปสั้น 1-2 ประโยค เป็นภาษาไทย ว่าลูกค้าต้องการอะไรและจบอย่างไร
- intent: หมวดความต้องการสั้น ๆ ภาษาไทย เช่น "สอบถามวันครบกำหนดตั๋ว", "ขอคุยกับเจ้าหน้าที่", "แจ้งเหตุด่วน"
- sentiment: หนึ่งใน positive | neutral | negative (อารมณ์โดยรวมของลูกค้า)`;

/** ดึง JSON จากคำตอบโมเดล — ตัด code fence ```json ออกก่อน แล้วค่อยหา {...} */
function parseJson(text: string): Partial<CallAnalysis> {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const candidate = cleaned.startsWith('{') ? cleaned : (cleaned.match(/\{[\s\S]*\}/)?.[0] ?? '');
  try {
    return candidate ? (JSON.parse(candidate) as Partial<CallAnalysis>) : {};
  } catch {
    return {};
  }
}

/**
 * P4: วิเคราะห์สายหลังจบ — สรุป + intent + sentiment แล้วเก็บลงตาราง calls
 * ทำงานแบบ background ไม่บล็อกการวางสาย
 * ใช้ DeepInfra (OpenAI-compatible) — ตั้ง DEEPINFRA_API_KEY และ ANALYTICS_MODEL ได้ใน .env
 */
export async function analyzeCall(callId: string): Promise<CallAnalysis | undefined> {
  const detail = await store.getCallDetail(callId);
  const turns = (detail?.turns ?? []) as { role: string; text: string }[];
  if (!turns.length) return undefined;
  if (!API_KEY) {
    console.error('[analytics] ไม่ได้ตั้ง DEEPINFRA_API_KEY — ข้ามการวิเคราะห์สาย');
    return undefined;
  }

  const transcript = turns.map((t) => `${t.role}: ${t.text}`).join('\n').slice(0, 8000);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `บทสนทนา:\n${transcript}` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = parseJson(data.choices?.[0]?.message?.content ?? '');
    const out: CallAnalysis = {
      summary: String(parsed.summary ?? '').slice(0, 500),
      intent: String(parsed.intent ?? '').slice(0, 120),
      sentiment: ['positive', 'neutral', 'negative'].includes(String(parsed.sentiment)) ? String(parsed.sentiment) : 'neutral',
    };
    await store.updateCallAnalysis(callId, out);
    return out;
  } catch (err) {
    console.error('[analytics]', (err as Error).message);
    return undefined;
  }
}
