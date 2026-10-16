/**
 * ราคาทองคำ/เงินล่าสุดจาก thaigold.info
 *
 * ใช้ /RealTimeDataV2/data_.txt ซึ่งเป็น feed สดที่ตัวเว็บเองเรียก (ดู scripts/tg2026.js)
 * ห้ามใช้ gtdata_.json — ไฟล์นั้นค้างอยู่ที่ข้อมูลปี 2011 (ราคาผิดจากความจริงมาก)
 *
 * หน่วยราคาในประเทศ = บาท ต่อ 1 บาทน้ำหนักทองคำแท่ง
 */

const URL = process.env.GOLD_PRICE_URL ?? 'https://www.thaigold.info/RealTimeDataV2/data_.txt';
const TTL_MS = Number(process.env.GOLD_PRICE_TTL_MS ?? 60_000) || 60_000;

export interface GoldPriceRow {
  label: string;
  buy: number | null;
  sell: number | null;
}

export interface GoldQuote {
  /** เวลาที่แหล่งข้อมูลอัปเดต (เวลาไทย) */
  updated: string;
  prices: GoldPriceRow[];
  market: {
    goldSpotUSDPerOz: number | null;
    usdThb: number | null;
    silverUSDPerOz: number | null;
  };
}

/** ชื่อใน feed -> ป้ายที่อ่านให้ลูกค้าเข้าใจ */
const LABELS: Record<string, string> = {
  'สมาคมฯ': 'ทองคำแท่ง 96.5% (ราคาสมาคมค้าทองคำ)',
  '96.5%': 'ทองคำแท่ง 96.5% (คำนวณสดจากราคาตลาดโลก)',
  '99.99%': 'ทองคำแท่ง 99.99% (คำนวณสดจากราคาตลาดโลก)',
};

type Raw = { name?: string; bid?: unknown; ask?: unknown };

/** ค่าจาก feed มาได้ทั้ง number และ string (บางช่องเป็น "") — คืน null ถ้าใช้ไม่ได้ */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').trim();
  if (!s) return null; // ช่องว่างต้องเป็น null ไม่ใช่ 0
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function thaiTime(unixSeconds: unknown): string {
  const ts = num(unixSeconds);
  if (ts === null) return 'ไม่ทราบเวลา';
  const d = new Date(ts * 1000);
  const s = d.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' });
  return `${s} (เวลาไทย)`;
}

async function fetchQuote(): Promise<GoldQuote | undefined> {
  try {
    // ใส่ cache-buster กัน proxy/CDN คืนค่าเก่า
    const res = await fetch(`${URL}?ran=${Date.now()}`, {
      headers: { accept: 'application/json, text/plain, */*' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const rows = (await res.json()) as Raw[];
    const byName = new Map(rows.map((r) => [String(r.name ?? ''), r]));

    const prices: GoldPriceRow[] = Object.entries(LABELS).flatMap(([key, label]) => {
      const row = byName.get(key);
      if (!row) return [];
      const buy = num(row.bid);
      const sell = num(row.ask);
      return buy === null && sell === null ? [] : [{ label, buy, sell }];
    });
    if (!prices.length) throw new Error('ไม่พบราคาทองคำในข้อมูลที่ได้');

    const spot = byName.get('GoldSpot');
    const thb = byName.get('THB');
    const silver = byName.get('Silver');
    return {
      updated: thaiTime(byName.get('Update')?.bid),
      prices,
      market: {
        goldSpotUSDPerOz: num(spot?.bid) ?? num(spot?.ask),
        usdThb: num(thb?.bid) ?? num(thb?.ask),
        silverUSDPerOz: num(silver?.bid) ?? num(silver?.ask),
      },
    };
  } catch (err) {
    console.error('[gold]', (err as Error).message);
    return undefined;
  }
}

let cached: { at: number; value: GoldQuote | undefined } | undefined;

/** ราคาทองล่าสุด (cache สั้น ๆ กันยิงแหล่งข้อมูลถี่เกิน) */
export async function goldPrice(): Promise<GoldQuote | undefined> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = await fetchQuote();
  cached = { at: Date.now(), value };
  return value;
}
