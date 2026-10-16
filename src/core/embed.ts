/**
 * Embedding ผ่าน DeepInfra (OpenAI-compatible /embeddings)
 * ใช้ DEEPINFRA_API_KEY ตัวเดียวกับ analytics — ไม่ต้องเพิ่ม dependency (ใช้ fetch)
 * โมเดล google/embeddinggemma-2 แยกโหมดเอกสาร/คำค้นด้วย `task` และกำหนดมิติได้
 * (EMBED_DIMS ต้องตรงกับคอลัมน์ knowledge_documents.embedding)
 */
const API_KEY = process.env.DEEPINFRA_API_KEY;
const BASE_URL = (process.env.DEEPINFRA_BASE_URL ?? 'https://api.deepinfra.com/v1/openai').replace(/\/+$/, '');
const MODEL = process.env.EMBED_MODEL ?? 'google/embeddinggemma-2';
const DIMS = Number(process.env.EMBED_DIMS ?? 768) || 768;

/** โหมดการฝัง — เอกสารที่จัดเก็บใช้ 'document', คำค้นของผู้ใช้ใช้ 'search_query' */
export type EmbedTask = 'document' | 'search_query';

/** สร้าง embedding — คืน undefined ถ้าล้มเหลว เพื่อไม่ให้กระทบสาย */
export async function embed(text: string, task: EmbedTask = 'document'): Promise<number[] | undefined> {
  if (!API_KEY) {
    console.error('[embed] ไม่ได้ตั้ง DEEPINFRA_API_KEY');
    return undefined;
  }
  try {
    const res = await fetch(`${BASE_URL}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        input: text.slice(0, 8000),
        task,
        dimensions: DIMS,
        encoding_format: 'float',
      }),
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
