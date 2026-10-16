import { NextResponse, type NextRequest } from 'next/server';
import { fetchSession, SESSION_COOKIE } from '@/lib/session';

/** เส้นทางที่เข้าได้โดยไม่ต้องล็อกอิน */
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout', '/robots.txt']);

/**
 * กันทุกหน้าและ /api/* ของ console: ต้องมี session ที่ยังใช้ได้
 * ตรวจกับ bridge (/api/auth/me) เพื่อให้การปิด/ลบผู้ใช้มีผลทันที
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = await fetchSession(token ? `${SESSION_COOKIE}=${token}` : undefined);
  if (user) return NextResponse.next();

  // เรียก API ตรง ๆ ให้ตอบ 401 (ไม่ redirect) เพื่อไม่ให้ fetch ฝั่ง client งง
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?from=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // ทุกเส้นทาง ยกเว้นไฟล์ static ของ Next
  matcher: ['/((?!_next/static|_next/image).*)'],
};
