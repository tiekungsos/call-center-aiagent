/**
 * Embedding ผ่าน DeepInfra (OpenAI-compatible /embeddings)
 * ใช้ DEEPINFRA_API_KEY ตัวเดียวกับ analytics — ไม่ต้องเพิ่ม dependency (ใช้ fetch)
 * มิติต้องตรงกับคอลัมน์ knowledge_documents.embedding (BAAI/bge-m3 = 1024)
 */
const API_KEY = process.env.DEEPINFRA_API_KEY;
const BASE_URL = (process.env.DEEPINFRA_BASE_URL ?? 'https://api.deepinfra.com/v1/openai').replace(/\/+$/, '');
const MODEL = process.env.EMBED_MODEL ?? 'BAAI/bge-m3';

/** สร้าง embedding — คืน undefined ถ้าล้มเหลว เพื่อไม่ให้กระทบสาย */
export async function embed(text: string): Promise<number[] | undefined> {
  if (!API_KEY) {
    console.error('[embed] ไม่ได้ตั้ง DEEPINFRA_API_KEY');
    return undefined;
  }
  try {
    const res = await fetch(`${BASE_URL}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: MODEL, input: text.slice(0, 8000), encoding_format: 'float' }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { data?: { embedding?: number[] }[] };
    return data.data?.[0]?.embedding;
  } catch (err) {
    console.error('[embed]', (err as Error).message);
    return undefined;
  }
}

/** แปลง number[] เป็น literal ของ pgvector */
export const toVector = (v: number[]) => `[${v.join(',')}]`;
