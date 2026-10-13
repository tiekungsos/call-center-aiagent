import { GoogleGenAI } from '@google/genai';
import * as store from './store.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.CHAT_MODEL ?? 'gemini-2.5-flash';

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

/**
 * P4: วิเคราะห์สายหลังจบ — สรุป + intent + sentiment แล้วเก็บลงตาราง calls
 * ทำงานแบบ background ไม่บล็อกการวางสาย
 */
export async function analyzeCall(callId: string): Promise<CallAnalysis | undefined> {
  const detail = await store.getCallDetail(callId);
  const turns = (detail?.turns ?? []) as { role: string; text: string }[];
  if (!turns.length) return undefined;

  const transcript = turns.map((t) => `${t.role}: ${t.text}`).join('\n').slice(0, 8000);
  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: `บทสนทนา:\n${transcript}`,
      config: { systemInstruction: SYSTEM, responseMimeType: 'application/json' },
    });
    const parsed = JSON.parse(res.text ?? '{}') as Partial<CallAnalysis>;
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
