import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { q } from '../db.js';
import { embed, embedImage, toVector } from './embed.js';
import { extractText, kindOf, MAX_FILE_BYTES, type DocKind } from './extract.js';

export interface KnowledgeHit {
  title: string | null;
  content: string;
  score: number;
}

/** โฟลเดอร์เก็บไฟล์ต้นฉบับ (อยู่บน volume ที่ mount เข้า bridge) */
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? 'uploads';

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

/** อัปโหลดไฟล์ (PDF / รูป / ข้อความ) เข้าคลังความรู้ของ agent — คืนผลลัพธ์หรือ error ที่อ่านรู้เรื่อง */
export async function ingestFile(opts: {
  tenantId: string;
  agentId: string;
  title?: string;
  filename: string;
  mime: string;
  buf: Buffer;
}): Promise<{ kind: DocKind; sourceName: string; chunks: number } | { error: string }> {
  const kind = kindOf(opts.mime, opts.filename);
  const mb = (n: number) => Math.round(n / 1024 / 1024);
  if (opts.buf.length > MAX_FILE_BYTES) return { error: `ไฟล์ใหญ่เกิน ${mb(MAX_FILE_BYTES)}MB` };

  const text = await extractText(opts.buf, opts.mime, kind);
  if (!text) {
    return { error: kind === 'text' ? 'อ่านไฟล์ข้อความไม่ได้ (อาจเป็นไฟล์ไบนารี)' : 'ถอดข้อความจากไฟล์ไม่สำเร็จ' };
  }

  // เก็บไฟล์ต้นฉบับไว้ให้ดาวน์โหลดย้อนหลัง (ถ้าเขียนไม่ได้ ก็ยัง ingest ต่อได้)
  let storagePath: string | null = null;
  try {
    const ext = (opts.filename.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
    mkdirSync(UPLOAD_DIR, { recursive: true });
    storagePath = join(UPLOAD_DIR, `${randomUUID()}${ext}`);
    writeFileSync(storagePath, opts.buf);
  } catch (err) {
    console.error('[upload] เก็บไฟล์ต้นฉบับไม่ได้:', (err as Error).message);
    storagePath = null;
  }

  const title = opts.title?.trim() || opts.filename;
  const mime = opts.mime || null;

  // รูป: ฝังตัวรูปเอง (multimodal) และเก็บข้อความที่ถอดได้ไว้ให้ AI พูดตอบด้วย
  if (kind === 'image') {
    const vec = await embedImage(opts.buf.toString('base64'), opts.mime || 'image/jpeg');
    if (!vec) return { error: 'สร้าง embedding ของรูปไม่สำเร็จ' };
    const rows = await q(
      `insert into knowledge_documents (tenant_id, agent_id, title, content, embedding, kind, source_name, mime_type, storage_path)
       values ($1, $2, $3, $4, $5::vector, $6, $7, $8, $9) returning id`,
      [opts.tenantId, opts.agentId, title, text, toVector(vec), kind, opts.filename, mime, storagePath],
    );
    return rows ? { kind, sourceName: opts.filename, chunks: 1 } : { error: 'บันทึกไม่สำเร็จ' };
  }

  let n = 0;
  for (const c of chunk(text)) {
    const vec = await embed(c, 'document');
    if (!vec) continue;
    const rows = await q(
      `insert into knowledge_documents (tenant_id, agent_id, title, content, embedding, kind, source_name, mime_type, storage_path)
       values ($1, $2, $3, $4, $5::vector, $6, $7, $8, $9) returning id`,
      [opts.tenantId, opts.agentId, title, c, toVector(vec), kind, opts.filename, mime, storagePath],
    );
    if (rows) n++;
  }
  return n ? { kind, sourceName: opts.filename, chunks: n } : { error: 'สร้าง embedding ไม่สำเร็จ' };
}

/** เอกสารเดี่ยว (ใช้ตอนดาวน์โหลดไฟล์ต้นฉบับ) */
export const getDoc = async (id: string) =>
  (
    await q<{
      id: string;
      title: string | null;
      kind: string;
      source_name: string | null;
      mime_type: string | null;
      storage_path: string | null;
    }>(`select id, title, kind, source_name, mime_type, storage_path from knowledge_documents where id=$1`, [id])
  )?.[0];

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
    `select id, agent_id, title, left(content, 240) as preview, created_at,
            kind, source_name, mime_type, (storage_path is not null) as has_file
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
