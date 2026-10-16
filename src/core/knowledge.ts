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

/** อัปโหลดเอกสารเข้าคลังความรู้ของ agent (chunk + embed) — คืนจำนวน chunk ที่สำเร็จ */
export async function ingest(opts: {
  tenantId: string;
  agentId: string;
  title?: string;
  content: string;
}): Promise<number> {
  let n = 0;
  for (const c of chunk(opts.content)) {
    const vec = await embed(c, 'document');
    if (!vec) continue;
    const rows = await q(
      `insert into knowledge_documents (tenant_id, agent_id, title, content, embedding)
       values ($1, $2, $3, $4, $5::vector) returning id`,
      [opts.tenantId, opts.agentId, opts.title ?? null, c, toVector(vec)],
    );
    if (rows) n++;
  }
  return n;
}

/**
 * ค้นคลังความรู้ด้วย cosine similarity — ผูกกับ agent เท่านั้น
 * ไม่มี agentId = ค้นไม่ได้ (คลังแยกกันแต่ละ agent ไม่มีข้อมูลใช้ร่วม)
 */
export async function search(tenantId: string, query: string, k = 4, agentId?: string): Promise<KnowledgeHit[]> {
  if (!agentId) return [];
  const vec = await embed(query, 'search_query');
  if (!vec) return [];
  const literal = toVector(vec);
  return (
    (await q<KnowledgeHit>(
      `select title, content, 1 - (embedding <=> $2::vector) as score
       from knowledge_documents
       where tenant_id = $1 and agent_id = $4 and embedding is not null
       order by embedding <=> $2::vector
       limit $3`,
      [tenantId, literal, k, agentId],
    )) ?? []
  );
}

/** เอกสารในคลังของ agent */
export const listDocs = (tenantId: string, agentId: string) =>
  q(
    `select id, agent_id, title, left(content, 240) as preview, created_at
     from knowledge_documents where tenant_id=$1 and agent_id=$2
     order by created_at desc limit 200`,
    [tenantId, agentId],
  );

export const removeDoc = (id: string) => q(`delete from knowledge_documents where id=$1`, [id]);

export const countDocs = async (tenantId: string, agentId: string) =>
  (await q<{ n: string }>(`select count(*) as n from knowledge_documents where tenant_id=$1 and agent_id=$2`, [
    tenantId,
    agentId,
  ]))?.[0]?.n ?? '0';
