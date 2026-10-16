import { basename, resolve, sep } from 'node:path';
import type { NextRequest } from 'next/server';
import { apiGet } from '@/lib/api';
import { streamFile } from '@/lib/serve-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** โฟลเดอร์ไฟล์บันทึกเสียงที่ mount เข้ามา (อ่านอย่างเดียว) */
const ROOT = resolve(/* turbopackIgnore: true */ process.env.RECORDINGS_DIR ?? '/recordings');

/**
 * สตรีมไฟล์บันทึกเสียงของสาย — ใช้ path ที่เก็บใน DB (ไม่รับ path จากผู้ใช้)
 * รองรับ Range เพื่อให้เลื่อนฟัง/เล่นซ้ำได้
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-zA-Z_-]{1,64}$/.test(id)) return new Response('invalid call id', { status: 400 });

  const detail = await apiGet<{ call?: { recording_path?: string | null } }>(`/api/calls/${encodeURIComponent(id)}`);
  const rel = detail?.call?.recording_path;
  if (!rel) return new Response('no recording for this call', { status: 404 });

  // ใช้เฉพาะชื่อไฟล์ แล้วประกอบกับ ROOT เอง — กัน path traversal จากค่าใน DB
  const file = resolve(ROOT, basename(rel));
  if (!file.startsWith(ROOT + sep)) return new Response('forbidden', { status: 403 });

  return streamFile(file, req, 'audio/wav');
}
