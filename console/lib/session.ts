import { cookies } from 'next/headers';
import { SERVER_API, SERVER_AUTH } from './api';

export const SESSION_COOKIE = 'watee_session';

export interface SessionUser {
  id: string;
  username: string;
  name: string | null;
  role: string;
}

/**
 * ตรวจ session กับ bridge (/api/auth/me) — จุดเดียวที่ตัดสินว่าใครล็อกอินอยู่
 * ใช้ได้ทั้ง middleware และ server component จึงไม่ต้องแชร์ secret ฝั่ง console
 */
export async function fetchSession(cookieHeader?: string): Promise<SessionUser | null> {
  if (!cookieHeader) return null;
  try {
    const r = await fetch(`${SERVER_API}/api/auth/me`, {
      headers: { cookie: cookieHeader, ...SERVER_AUTH },
      cache: 'no-store',
    });
    if (!r.ok) return null;
    return ((await r.json()) as { user?: SessionUser }).user ?? null;
  } catch {
    return null;
  }
}

/** ผู้ใช้ปัจจุบันของ request นี้ (server component) */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? fetchSession(`${SESSION_COOKIE}=${token}`) : null;
}
