import type { NextRequest } from 'next/server';
import { SERVER_API, SERVER_AUTH } from '@/lib/api';

/**
 * Proxy ไป API ของ bridge — ทำให้ browser เรียกผ่าน origin เดียวกับ console
 * (ไม่ต้องเปิด CORS และไม่ต้องให้ browser เข้าถึง 127.0.0.1:8090 ของ server ตรง ๆ)
 * แนบ API_TOKEN ให้ฝั่ง server ถ้าตั้งไว้ — browser ไม่เคยเห็น token
 */
async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  // ไฟล์นี้อยู่ที่ app/api/[...path] จึงได้ path เฉพาะส่วนที่อยู่หลัง /api/
  // แต่ bridge mount ทุก route ใต้ /api (เช่น /api/campaigns) -> ต้องเติม /api กลับก่อนยิงต่อ
  const { path } = await ctx.params;
  const { search } = new URL(req.url);
  const target = `${SERVER_API}/api/${path.join('/')}${search}`;
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { 'content-type': req.headers.get('content-type') ?? 'application/json', ...SERVER_AUTH },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
      cache: 'no-store',
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    return Response.json({ error: `ต่อ API ไม่ได้: ${(err as Error).message}` }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
