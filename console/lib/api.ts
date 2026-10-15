/** ชั้นเชื่อมต่อ API ของ bridge — server component ใช้ SERVER_API, client เรียกผ่าน proxy /api */

export const SERVER_API = process.env.API_URL ?? 'http://127.0.0.1:8090';
/** client component เรียก path เดียวกันกับ console แล้วให้ app/api/[...path] proxy ต่อไป */
export const CLIENT_API = '';
export const TENANT = process.env.NEXT_PUBLIC_TENANT ?? 'aileo';

/** header ยืนยันตัวตนกับ bridge (ถ้าตั้ง API_TOKEN) — ใช้ฝั่ง server เท่านั้น ไม่รั่วไป browser */
export const SERVER_AUTH: Record<string, string> = process.env.API_TOKEN?.trim()
  ? { 'x-api-key': process.env.API_TOKEN.trim() }
  : {};

export async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${SERVER_API}${path}`, { cache: 'no-store', headers: SERVER_AUTH });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** เรียกจาก client component (browser) */
export async function apiSend<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const r = await fetch(`${CLIENT_API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error: text };
  }
  if (!r.ok) throw new Error((parsed as { error?: string })?.error ?? `HTTP ${r.status}`);
  return parsed as T;
}

export const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }) : '—';

export const fmtDuration = (start?: string | null, end?: string | null) => {
  if (!start) return '—';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.max(0, Math.round((e - s) / 1000));
  return sec < 60 ? `${sec} วิ` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} น.`;
};

export const short = (id?: string | null, n = 8) => (id ? id.slice(0, n) : '—');

export const actionChip = (a?: string | null): { cls: string; label: string } => {
  if (a === 'transfer') return { cls: 'warn', label: 'โอนสาย' };
  if (a === 'emergency') return { cls: 'err', label: 'เหตุด่วน' };
  if (a === 'hangup') return { cls: '', label: 'วางสาย' };
  return { cls: '', label: '—' };
};

export const sentimentChip = (s?: string | null): { cls: string; label: string } => {
  if (s === 'positive') return { cls: 'ok', label: 'พึงพอใจ' };
  if (s === 'negative') return { cls: 'err', label: 'ไม่พอใจ' };
  if (s === 'neutral') return { cls: '', label: 'กลาง' };
  return { cls: '', label: 'ยังไม่วิเคราะห์' };
};
