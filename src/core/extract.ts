/**
 * ถอดข้อความจากไฟล์ที่อัปโหลด
 * - text/md/txt อ่านตรง ๆ (ไม่เสียค่า API)
 * - pdf/รูป ส่งให้ DeepInfra (OpenAI-compatible) ใช้ DEEPINFRA_API_KEY ตัวเดียวกับ embeddings/analytics
 *
 * ทดสอบกับ deepseek-ai/DeepSeek-V4.1-Flash แล้วว่าอ่านภาษาไทยได้ถูกต้อง
 * โดย PDF ต้องส่งเป็น content type "file" (ส่งเป็น "image_url" จะถูกปฏิเสธ)
 * ส่วนรูปส่งเป็น "image_url" แบบ data URL
 */
const API_KEY = process.env.DEEPINFRA_API_KEY;
const BASE_URL = (process.env.DEEPINFRA_BASE_URL ?? 'https://api.deepinfra.com/v1/openai').replace(/\/+$/, '');
const MODEL = process.env.VISION_MODEL ?? 'deepseek-ai/DeepSeek-V4.1-Flash';
const TIMEOUT_MS = Number(process.env.VISION_TIMEOUT_MS ?? 120_000) || 120_000;

export type DocKind = 'text' | 'pdf' | 'image';

/** ขนาดสูงสุดที่ส่งให้โมเดลแบบ inline ได้ */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;
const TEXT_EXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|html?)$/i;

export function kindOf(mime: string, filename: string): DocKind {
  const m = (mime || '').toLowerCase();
  if (m === 'application/pdf' || /\.pdf$/i.test(filename)) return 'pdf';
  if (m.startsWith('image/') || IMAGE_EXT.test(filename)) return 'image';
  if (m.startsWith('text/') || TEXT_EXT.test(filename)) return 'text';
  return 'text';
}

/** นามสกุลที่ยอมรับให้อัปโหลด */
export const ACCEPTED = /\.(pdf|md|markdown|txt|csv|tsv|json|ya?ml|html?|png|jpe?g|webp|gif|bmp|tiff?)$/i;

const PROMPTS: Record<Exclude<DocKind, 'text'>, string> = {
  pdf: `ถอดข้อความทั้งหมดในไฟล์นี้ตามลำดับที่อ่านได้ เป็นภาษาไทยตามต้นฉบับ
ตอบเป็นข้อความธรรมดา ไม่ต้องจัดรูปแบบ ไม่ต้องสรุป ไม่ต้องใส่ความคิดเห็น`,
  image: `ถอดข้อความทั้งหมดในภาพนี้ออกมาให้ครบ (ไทยและอังกฤษ) โดยรักษาตัวเลขและตัวสะกดให้ถูกต้อง
จากนั้นขึ้นบรรทัดใหม่แล้วเขียนว่า "สรุปภาพ:" แล้วอธิบายสั้น ๆ 1-2 ประโยคว่าภาพนี้คืออะไร
ตอบเป็นข้อความธรรมดา ไม่ต้องจัดรูปแบบ`,
};

/** error ที่ "ลองใหม่ได้" (rate limit / เซิร์ฟเวอร์สะดุด) */
const retryable = (msg: string) => /"code":(429|500|502|503)|rate ?limit|overloaded|timed? ?out|aborted|high demand/i.test(msg);

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } } | { type: 'file'; file: { filename: string; file_data: string } };

/** ประกอบ content ตามชนิดไฟล์ — PDF ต้องใช้ type "file" เท่านั้น */
function parts(kind: Exclude<DocKind, 'text'>, mime: string, filename: string, buf: Buffer): Part[] {
  const b64 = buf.toString('base64');
  const prompt: Part = { type: 'text', text: PROMPTS[kind] };
  if (kind === 'pdf') {
    return [prompt, { type: 'file', file: { filename: filename || 'document.pdf', file_data: `data:application/pdf;base64,${b64}` } }];
  }
  return [prompt, { type: 'image_url', image_url: { url: `data:${mime || 'image/jpeg'};base64,${b64}` } }];
}

/** ถอดข้อความ — คืน undefined ถ้าล้มเหลว (ให้ผู้เรียกแจ้ง error เอง) */
export async function extractText(buf: Buffer, mime: string, kind: DocKind, filename = ''): Promise<string | undefined> {
  if (kind === 'text') {
    const text = buf.toString('utf8');
    // ไฟล์ไบนารีที่หลุดเข้ามาเป็น text จะมีอักขระควบคุมเยอะ — กันไม่ให้เข้า KB
    return /\u0000/.test(text) ? undefined : text;
  }

  if (!API_KEY) {
    console.error('[extract] ไม่ได้ตั้ง DEEPINFRA_API_KEY');
    return undefined;
  }

  const body = JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: parts(kind, mime, filename, buf) }] });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = (data.choices?.[0]?.message?.content ?? '').replace(/\u0000/g, '').trim();
      if (text) return text;
      return undefined; // ตอบมาแต่ไม่มีข้อความ — ลองใหม่ไม่ช่วย
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[extract] ${MODEL} (ครั้งที่ ${attempt + 1}):`, msg);
      if (!retryable(msg)) return undefined;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return undefined;
}
