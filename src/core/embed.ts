import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.EMBED_MODEL ?? 'text-embedding-004';

/** สร้าง embedding (768 มิติ) — คืน undefined ถ้าล้มเหลว เพื่อไม่ให้กระทบสาย */
export async function embed(text: string): Promise<number[] | undefined> {
  try {
    const r = await ai.models.embedContent({ model: MODEL, contents: text.slice(0, 8000) });
    return r.embeddings?.[0]?.values;
  } catch (err) {
    console.error('[embed]', (err as Error).message);
    return undefined;
  }
}

/** แปลง number[] เป็น literal ของ pgvector */
export const toVector = (v: number[]) => `[${v.join(',')}]`;
