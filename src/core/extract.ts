import { GoogleGenAI } from '@google/genai';

/**
 * ถอดข้อความจากไฟล์ที่อัปโหลด
 * - text/md/txt อ่านตรง ๆ (ไม่เสียค่า API)
 * - pdf/รูป ใช้ Gemini ซึ่งอ่านภาษาไทยได้แม่นและรองรับ PDF สแกน (ทดสอบแล้วเทียบกับตัวอ่าน PDF ทั่วไป
 *   ที่ได้ข้อความไทยเพี้ยน)
 */
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/** ลำดับโมเดลที่ลอง — ตัวแรกคือค่าที่ตั้งไว้ แล้วไล่ fallback เมื่อโมเดลปลายทางไม่ว่าง (503/429) */
const DEFAULT_MODELS = ['gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash'];
const MODELS = (process.env.VISION_MODEL?.trim() ? process.env.VISION_MODEL.split(',') : DEFAULT_MODELS)
  .map((s) => s.trim())
  .filter(Boolean);

/** error ที่ "ลองใหม่ได้" (โมเดลไม่ว่าง/rate limit/เซิร์ฟเวอร์สะดุด) */
const retryable = (msg: string) => /UNAVAILABLE|RESOURCE_EXHAUSTED|"code":(429|500|503)|high demand|overloaded/i.test(msg);

export type DocKind = 'text' | 'pdf' | 'image';

/** ขนาดสูงสุดที่ส่งให้ Gemini แบบ inline ได้ (limit ของ API อยู่ที่ ~20MB) */
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

/** ถอดข้อความ — คืน undefined ถ้าล้มเหลว (ให้ผู้เรียกแจ้ง error เอง) */
export async function extractText(buf: Buffer, mime: string, kind: DocKind): Promise<string | undefined> {
  if (kind === 'text') {
    const text = buf.toString('utf8');
    // ไฟล์ไบนารีที่หลุดเข้ามาเป็น text จะมีอักขระควบคุมเยอะ — กันไม่ให้เข้า KB
    return /\u0000/.test(text) ? undefined : text;
  }

  const mimeType = kind === 'pdf' ? 'application/pdf' : mime || 'image/jpeg';
  const parts = [{ text: PROMPTS[kind] }, { inlineData: { mimeType, data: buf.toString('base64') } }];

  // ลองทีละโมเดล (แต่ละตัวลองซ้ำ 1 ครั้ง) — โมเดล vision มักเจอ 503 ช่วงคนใช้เยอะ
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await ai.models.generateContent({ model, contents: [{ role: 'user', parts }] });
        const text = (res.text ?? '').replace(/\u0000/g, '').trim();
        if (text) return text;
        break; // โมเดลตอบแต่ไม่มีข้อความ -> ลองโมเดลถัดไป
      } catch (err) {
        const msg = (err as Error).message;
        console.error(`[extract] ${model} (ครั้งที่ ${attempt + 1}):`, msg);
        if (!retryable(msg)) return undefined; // error ถาวร (เช่น 400/404) ไม่ต้องลองต่อ
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }
  return undefined;
}
