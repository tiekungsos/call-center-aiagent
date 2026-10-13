import { q } from '../db.js';
import { embed, toVector } from './embed.js';

export interface KnowledgeHit {
  title: string | null;
  content: string;
  score: number;
}

/** แบ่งข้อความเป็น chunk ตามย่อหน้า โดยพยายามให้แต่ละ chunk ไม่เกิน ~size ตัวอักษร */
export function chunk(text: string, size = 1200, overlap = 150): string[] {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  let buf = '';
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > size) {
      out.push(buf);
      buf = buf.slice(-overlap) + '\n\n' + p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf.trim()) out.push(buf);
  return out.length ? out : [text];
}

/** อัปโหลดเอกสารเข้าคลังความรู้ (chunk + embed) — คืนจำนวน chunk ที่สำเร็จ */
export async function ingest(opts: {
  tenantId: string;
  agentId?: string;
  title?: string;
  content: string;
}): Promise<number> {
  let n = 0;
  for (const c of chunk(opts.content)) {
    const vec = await embed(c);
    if (!vec) continue;
    const rows = await q(
      `insert into knowledge_documents (tenant_id, agent_id, title, content, embedding)
       values ($1, $2, $3, $4, $5::vector) returning id`,
      [opts.tenantId, opts.agentId ?? null, opts.title ?? null, c, toVector(vec)],
    );
    if (rows) n++;
  }
  return n;
}

/** ค้นคลังความรู้ด้วย cosine similarity */
export async function search(tenantId: string, query: string, k = 4): Promise<KnowledgeHit[]> {
  const vec = await embed(query);
  if (!vec) return [];
  const literal = toVector(vec);
  return (
    (await q<KnowledgeHit>(
      `select title, content, 1 - (embedding <=> $2::vector) as score
       from knowledge_documents
       where tenant_id = $1 and embedding is not null
       order by embedding <=> $2::vector
       limit $3`,
      [tenantId, literal, k],
    )) ?? []
  );
}

export const listDocs = (tenantId: string) =>
  q(
    `select id, agent_id, title, left(content, 240) as preview, created_at
     from knowledge_documents where tenant_id=$1 order by created_at desc limit 200`,
    [tenantId],
  );

export const removeDoc = (id: string) => q(`delete from knowledge_documents where id=$1`, [id]);

export const countDocs = async (tenantId: string) =>
  (await q<{ n: string }>(`select count(*) as n from knowledge_documents where tenant_id=$1`, [tenantId]))?.[0]?.n ?? '0';
