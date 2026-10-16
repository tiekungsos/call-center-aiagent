import { createReadStream, statSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { apiGet } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** โฟลเดอร์ไฟล์บันทึกเสียงที่ mount เข้ามา (อ่านอย่างเดียว) — ไม่ให้ turbopack trace ทั้งโปรเจกต์ */
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

  let size: number;
  try {
    const st = statSync(/* turbopackIgnore: true */ file);
    if (!st.isFile()) return new Response('not found', { status: 404 });
    size = st.size;
  } catch {
    return new Response('recording file not found', { status: 404 });
  }
  if (size === 0) return new Response('empty recording', { status: 404 });

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.get('range');
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m) {
    if (m[1]) start = Number(m[1]);
    if (m[2]) end = Number(m[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    }
    end = Math.min(end, size - 1);
    status = 206;
  }

  const headers: Record<string, string> = {
    'content-type': 'audio/wav',
    'accept-ranges': 'bytes',
    'content-length': String(end - start + 1),
    'cache-control': 'private, max-age=0, must-revalidate',
  };
  if (status === 206) headers['content-range'] = `bytes ${start}-${end}/${size}`;

  const stream = Readable.toWeb(
    createReadStream(/* turbopackIgnore: true */ file, { start, end }),
  ) as unknown as ReadableStream<Uint8Array>;
  return new Response(stream, { status, headers });
}
