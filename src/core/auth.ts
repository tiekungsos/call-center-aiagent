import crypto from 'node:crypto';
import { q } from '../db.js';

/**
 * Auth สำหรับ console (P3) — ผู้ใช้หลายคนเก็บใน Postgres
 * - รหัสผ่าน: scrypt (built-in ของ node) ไม่ต้องเพิ่ม dependency
 * - session: cookie ที่เซ็น HMAC-SHA256 (stateless) ตรวจที่ console middleware ผ่าน /api/auth/me
 */
export interface ConsoleUser {
  id: string;
  username: string;
  name: string | null;
  role: string;
  disabled: boolean;
  last_login_at: string | null;
  created_at: string;
}

export const SESSION_COOKIE = 'watee_session';
export const ROLES = ['admin', 'viewer'] as const;

const TTL_MS = Math.max(1, Number(process.env.CONSOLE_SESSION_TTL_HOURS ?? 12) || 12) * 3600_000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const sessionSecret = () => process.env.CONSOLE_SESSION_SECRET?.trim() ?? '';
/** ถ้าไม่ได้ตั้ง secret จะออก/ตรวจ session ไม่ได้ — บังคับตั้งใน production */
export const authReady = () => sessionSecret().length >= 16;

// --- password ---
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  try {
    const expected = Buffer.from(hash, 'base64url');
    const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// --- session (HMAC-signed cookie) ---
interface SessionPayload {
  uid: string;
  username: string;
  role: string;
  exp: number;
}

const sign = (body: string) => crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');

export function signSession(u: Pick<ConsoleUser, 'id' | 'username' | 'role'>): string {
  const payload: SessionPayload = { uid: u.id, username: u.username, role: u.role, exp: Date.now() + TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifySession(token?: string): SessionPayload | null {
  if (!token || !authReady()) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

/** อายุ cookie (วินาที) — ใช้ตั้ง Max-Age ให้ตรงกับอายุ session */
export const sessionMaxAge = () => Math.floor(TTL_MS / 1000);

export function sessionCookie(token: string): string {
  // Secure เปิดเป็นค่าเริ่มต้น (production อยู่หลัง HTTPS) — ปิดได้ด้วย CONSOLE_COOKIE_SECURE=0 ตอน dev
  const secure = process.env.CONSOLE_COOKIE_SECURE !== '0' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionMaxAge()}${secure}`;
}

export const clearSessionCookie = () =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.CONSOLE_COOKIE_SECURE !== '0' ? '; Secure' : ''}`;

export function readCookie(cookieHeader: string | undefined, name = SESSION_COOKIE): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

// --- users (DB) ---
const PUBLIC_COLS = 'id, username, name, role, disabled, last_login_at, created_at';

export const listUsers = () => q<ConsoleUser>(`select ${PUBLIC_COLS} from console_users order by created_at`);

export const getUserById = async (id: string) =>
  (await q<ConsoleUser & { password_hash: string }>(`select ${PUBLIC_COLS}, password_hash from console_users where id=$1`, [id]))?.[0];

export const getUserByUsername = async (username: string) =>
  (await q<ConsoleUser & { password_hash: string }>(
    `select ${PUBLIC_COLS}, password_hash from console_users where username=$1`,
    [username.trim().toLowerCase()],
  ))?.[0];

export const countUsers = async () => Number((await q<{ n: number }>(`select count(*)::int as n from console_users`))?.[0]?.n ?? 0);

export const touchLastLogin = (id: string) => q(`update console_users set last_login_at=now() where id=$1`, [id]);

export async function createUser(u: { username: string; name?: string; password: string; role?: string }): Promise<ConsoleUser | undefined> {
  const username = u.username.trim().toLowerCase();
  if (!username || !u.password) return undefined;
  return (
    await q<ConsoleUser>(
      `insert into console_users (username, name, password_hash, role)
       values ($1, $2, $3, $4)
       on conflict (username) do nothing
       returning ${PUBLIC_COLS}`,
      [username, u.name?.trim() || null, hashPassword(u.password), u.role === 'viewer' ? 'viewer' : 'admin'],
    )
  )?.[0];
}

export async function updateUser(
  id: string,
  patch: { name?: string; role?: string; disabled?: boolean; password?: string },
): Promise<ConsoleUser | undefined> {
  const sets: string[] = [];
  const vals: unknown[] = [id];
  if (patch.name !== undefined) (vals.push(patch.name.trim() || null), sets.push(`name = $${vals.length}`));
  if (patch.role !== undefined) (vals.push(patch.role === 'viewer' ? 'viewer' : 'admin'), sets.push(`role = $${vals.length}`));
  if (patch.disabled !== undefined) (vals.push(Boolean(patch.disabled)), sets.push(`disabled = $${vals.length}`));
  if (patch.password) (vals.push(hashPassword(patch.password)), sets.push(`password_hash = $${vals.length}`));
  if (!sets.length) return getUserById(id);
  return (await q<ConsoleUser>(`update console_users set ${sets.join(', ')} where id=$1 returning ${PUBLIC_COLS}`, vals))?.[0];
}

export const deleteUser = (id: string) => q(`delete from console_users where id=$1`, [id]);

/** กันล็อกเอาต์ตัวเอง: ห้ามลบ/ปิด user คนสุดท้ายที่เป็น admin ที่ยังใช้งานได้ */
export async function wouldLockOut(id: string): Promise<boolean> {
  const rows = await q<{ n: number }>(
    `select count(*)::int as n from console_users where role='admin' and not disabled and id <> $1`,
    [id],
  );
  return Number(rows?.[0]?.n ?? 0) === 0;
}

/** สร้างผู้ใช้ console คนแรกจาก env ตอน boot (ข้ามถ้ามีผู้ใช้อยู่แล้ว) */
export async function seedConsoleAdmin(): Promise<void> {
  const password = process.env.CONSOLE_ADMIN_PASSWORD?.trim();
  if (!password) return;
  if ((await countUsers()) > 0) return;
  const username = process.env.CONSOLE_ADMIN_USER?.trim() || 'admin';
  const u = await createUser({ username, name: 'ผู้ดูแลระบบ', password, role: 'admin' });
  if (u) console.log(`[auth] สร้างผู้ใช้ console คนแรกจาก env: ${u.username}`);
  else console.warn('[auth] สร้างผู้ใช้ console คนแรกไม่สำเร็จ (ตรวจ DATABASE_URL และ CONSOLE_ADMIN_PASSWORD)');
}
