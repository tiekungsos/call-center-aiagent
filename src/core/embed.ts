import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
// text-embedding-004 ถูกเลิกให้บริการแล้ว — ใช้ gemini-embedding-001 (กำหนดมิติให้ตรงกับคอลัมน์ vector(768))
const MODEL = process.env.EMBED_MODEL ?? 'gemini-embedding-001';
const DIMS = Number(process.env.EMBED_DIMS ?? 768);

/** สร้าง embedding (768 มิติ) — คืน undefined ถ้าล้มเหลว เพื่อไม่ให้กระทบสาย */
export async function embed(text: string): Promise<number[] | undefined> {
  try {
    const r = await ai.models.embedContent({
      model: MODEL,
      contents: text.slice(0, 8000),
      config: { outputDimensionality: DIMS },
    });
    return r.embeddings?.[0]?.values;
  } catch (err) {
    console.error('[embed]', (err as Error).message);
    return undefined;
  }
}

/** แปลง number[] เป็น literal ของ pgvector */
export const toVector = (v: number[]) => `[${v.join(',')}]`;
