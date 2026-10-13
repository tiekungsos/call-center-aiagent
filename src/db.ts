import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

// DB ไม่บังคับ: ถ้าไม่ตั้ง DATABASE_URL ระบบจะ fallback ไปใช้โปรไฟล์ในโค้ด + log JSONL
export const DATABASE_URL = process.env.DATABASE_URL?.trim() || undefined;

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool | undefined {
  if (!DATABASE_URL) return undefined;
  pool ??= new Pool({ connectionString: DATABASE_URL, max: 5 });
  return pool;
}

export const dbEnabled = () => Boolean(DATABASE_URL);

/** query helper: คืน undefined ถ้าไม่มี DB หรือ query ล้มเหลว (ไม่ทำให้สายหลุด) */
export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[] | undefined> {
  const p = getPool();
  if (!p) return undefined;
  try {
    const r = await p.query(text, params as never[]);
    return r.rows as T[];
  } catch (err) {
    console.error('[db]', (err as Error).message);
    return undefined;
  }
}

/** สร้าง/อัปเดต schema — idempotent รันได้ทุก boot */
export async function migrate(): Promise<boolean> {
  const p = getPool();
  if (!p) {
    console.log('[db] ไม่ได้ตั้ง DATABASE_URL -> ข้าม DB (ใช้โปรไฟล์ในโค้ด)');
    return false;
  }
  try {
    const sql = readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf8');
    await p.query(sql);
    console.log('[db] migrate ok');
    return true;
  } catch (err) {
    console.error('[db] migrate failed:', (err as Error).message);
    return false;
  }
}
