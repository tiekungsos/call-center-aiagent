import type { NextRequest } from 'next/server';
import { SERVER_API } from '@/lib/api';

/**
 * Proxy ไป API ของ bridge — ทำให้ browser เรียกผ่าน origin เดียวกับ console
 * (ไม่ต้องเปิด CORS และไม่ต้องให้ browser เข้าถึง 127.0.0.1:8090 ของ server ตรง ๆ)
 */
async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const { search } = new URL(req.url);
  const target = `${SERVER_API}/${path.join('/')}${search}`;
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { 'content-type': req.headers.get('content-type') ?? 'application/json' },
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
