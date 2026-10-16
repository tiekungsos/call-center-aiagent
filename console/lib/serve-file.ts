import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';

/**
 * สตรีมไฟล์จากดิสก์ (รองรับ Range) — ใช้ร่วมกันระหว่างไฟล์บันทึกเสียงและไฟล์ในคลังความรู้
 * ผู้เรียกต้องตรวจ path ให้ปลอดภัยก่อน (เช่น basename + เทียบกับ root)
 */
export function streamFile(file: string, req: Request, contentType: string): Response {
  let size: number;
  try {
    const st = statSync(/* turbopackIgnore: true */ file);
    if (!st.isFile()) return new Response('not found', { status: 404 });
    size = st.size;
  } catch {
    return new Response('file not found', { status: 404 });
  }
  if (size === 0) return new Response('empty file', { status: 404 });

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
    'content-type': contentType,
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
