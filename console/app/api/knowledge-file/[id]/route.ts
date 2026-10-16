import { basename, resolve, sep } from 'node:path';
import type { NextRequest } from 'next/server';
import { apiGet } from '@/lib/api';
import { streamFile } from '@/lib/serve-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** โฟลเดอร์ไฟล์ต้นฉบับที่ mount เข้ามา (อ่านอย่างเดียว) */
const ROOT = resolve(/* turbopackIgnore: true */ process.env.UPLOADS_DIR ?? '/uploads');

/**
 * ดาวน์โหลดไฟล์ต้นฉบับของเอกสารในคลังความรู้
 * ใช้ storage_path ที่เก็บใน DB (ไม่รับ path จากผู้ใช้) แล้ว basename + เทียบกับ ROOT กัน path traversal
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-zA-Z_-]{1,64}$/.test(id)) return new Response('invalid document id', { status: 400 });

  const data = await apiGet<{
    doc?: { storage_path?: string | null; source_name?: string | null; mime_type?: string | null };
  }>(`/api/knowledge/doc/${encodeURIComponent(id)}`);

  const rel = data?.doc?.storage_path;
  if (!rel) return new Response('no stored file for this document', { status: 404 });

  const file = resolve(ROOT, basename(rel));
  if (!file.startsWith(ROOT + sep)) return new Response('forbidden', { status: 403 });

  return streamFile(file, req, data?.doc?.mime_type || 'application/octet-stream');
}
