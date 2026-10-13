import Link from 'next/link';
import { actionChip, apiGet, fmtDuration, fmtTime, sentimentChip, short, TENANT } from '@/lib/api';

interface Overview {
  calls: string;
  calls_24h: string;
  open_tickets: string;
  turns: string;
  avg_latency_ms: string;
}
interface Bucket {
  label: string;
  n: number;
}
interface Cell {
  dow: number;
  hour: number;
  calls: number;
}
interface CallRow {
  id: string;
  channel: string;
  caller_number: string | null;
  started_at: string;
  ended_at: string | null;
  action: string | null;
  intent: string | null;
  sentiment: string | null;
  agent_name: string | null;
  turns: number;
}

const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export default async function Dashboard() {
  const [ov, bd, hm, cl] = await Promise.all([
    apiGet<{ overview: Overview | null }>(`/api/stats/overview?tenant=${TENANT}`),
    apiGet<{ breakdown: { intents: Bucket[]; sentiments: Bucket[]; channels: Bucket[] } }>(`/api/stats/breakdown?tenant=${TENANT}`),
    apiGet<{ heatmap: Cell[] }>(`/api/stats/heatmap?tenant=${TENANT}`),
    apiGet<{ calls: CallRow[] }>(`/api/calls?tenant=${TENANT}&limit=8`),
  ]);

  const overview = ov?.overview ?? null;
  const breakdown = bd?.breakdown ?? { intents: [], sentiments: [], channels: [] };
  const heat = hm?.heatmap ?? [];
  const calls = cl?.calls ?? [];
  const maxHeat = Math.max(1, ...heat.map((c) => c.calls));
  const maxIntent = Math.max(1, ...breakdown.intents.map((i) => i.n));
  const totalSentiment = breakdown.sentiments.reduce((s, x) => s + x.n, 0) || 1;

  if (!overview && calls.length === 0) {
    return (
      <>
        <Head />
        <div className="banner err">
          ต่อ API ไม่ได้ หรือยังไม่มีข้อมูล — ตรวจว่า bridge รันอยู่และตั้ง <code className="mono">DATABASE_URL</code> แล้ว
        </div>
      </>
    );
  }

  return (
    <>
      <Head />

      <div className="stat-row">
        <Stat label="สาย/แชททั้งหมด" value={overview?.calls ?? '0'} note={`${overview?.turns ?? 0} turns`} />
        <Stat label="24 ชั่วโมงล่าสุด" value={overview?.calls_24h ?? '0'} />
        <Stat label="เรื่องร้องเรียนค้าง" value={overview?.open_tickets ?? '0'} />
        <Stat label="latency เฉลี่ย" value={`${overview?.avg_latency_ms ?? 0} ms`} note="ถึงเสียงแรก" />
      </div>

      <section className="section">
        <div className="section-head">
          <h2>ช่วงเวลาที่มีสายเข้า</h2>
          <span className="dim">เข้ม = สายเยอะ (ชั่วโมง × วัน)</span>
        </div>
        <div className="card card-pad">
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '28px repeat(24, 1fr)', gap: 3, minWidth: 620 }}>
              <span />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="dim" style={{ fontSize: 10, textAlign: 'center' }}>
                  {h % 3 === 0 ? h : ''}
                </span>
              ))}
              {DOW.map((d, dow) => (
                <Fragment key={d} dow={dow} label={d} heat={heat} max={maxHeat} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section grid cols-2">
        <div>
          <div className="section-head">
            <h2>ความต้องการที่พบบ่อย</h2>
            <span className="dim">{breakdown.intents.length} หมวด</span>
          </div>
          <div className="card card-pad">
            {breakdown.intents.length === 0 ? (
              <p className="muted">ยังไม่มีข้อมูล — จะแสดงหลังจบสายแรกที่วิเคราะห์แล้ว</p>
            ) : (
              <div className="grid" style={{ gap: 12 }}>
                {breakdown.intents.map((i) => (
                  <div key={i.label}>
                    <div className="row between" style={{ fontSize: 12.5 }}>
                      <span>{i.label}</span>
                      <span className="dim num">{i.n}</span>
                    </div>
                    <div className="bar track" style={{ marginTop: 5 }}>
                      <div className="bar" style={{ width: `${(i.n / maxIntent) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="section-head">
            <h2>อารมณ์ผู้ติดต่อ</h2>
          </div>
          <div className="card card-pad">
            {breakdown.sentiments.length === 0 ? (
              <p className="muted">ยังไม่มีข้อมูล</p>
            ) : (
              <div className="grid" style={{ gap: 12 }}>
                {breakdown.sentiments.map((s) => {
                  const chip = sentimentChip(s.label === 'ไม่ระบุ' ? null : s.label);
                  return (
                    <div key={s.label}>
                      <div className="row between" style={{ fontSize: 12.5 }}>
                        <span className={`chip ${chip.cls}`}>{s.label === 'ไม่ระบุ' ? 'ไม่ระบุ' : chip.label}</span>
                        <span className="dim num">{Math.round((s.n / totalSentiment) * 100)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>สายล่าสุด</h2>
          <Link href="/calls" className="muted" style={{ fontSize: 12.5 }}>
            ดูทั้งหมด →
          </Link>
        </div>
        <div className="card">
          {calls.length === 0 ? (
            <Empty title="ยังไม่มีสายเข้า" body="เมื่อมีสายหรือแชทเข้ามา รายการจะปรากฏที่นี่พร้อม transcript และผลการวิเคราะห์" />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>ช่องทาง</th>
                  <th>ผู้ติดต่อ</th>
                  <th>ความต้องการ</th>
                  <th>ผล</th>
                  <th className="num">ระยะเวลา</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => {
                  const a = actionChip(c.action);
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/calls/${c.id}`} className="mono">
                          {fmtTime(c.started_at)}
                        </Link>
                      </td>
                      <td>
                        <span className="chip">{c.channel === 'chat' ? 'แชท' : 'โทร'}</span>
                      </td>
                      <td className="mono">{c.caller_number ?? short(c.id)}</td>
                      <td>{c.intent ?? <span className="dim">—</span>}</td>
                      <td>
                        <span className={`chip ${a.cls}`}>{a.label}</span>
                      </td>
                      <td className="num dim">{fmtDuration(c.started_at, c.ended_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}

function Head() {
  return (
    <div className="page-head">
      <div>
        <h1>ภาพรวมปฏิบัติการ</h1>
        <p>ปริมาณสาย ความต้องการที่พบบ่อย และช่วงเวลาที่มีสายเข้า</p>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {body}
    </div>
  );
}

function Fragment({ dow, label, heat, max }: { dow: number; label: string; heat: Cell[]; max: number }) {
  return (
    <>
      <span className="dim" style={{ fontSize: 11, lineHeight: '18px' }}>
        {label}
      </span>
      {Array.from({ length: 24 }, (_, h) => {
        const cell = heat.find((c) => c.dow === dow && c.hour === h);
        const n = cell?.calls ?? 0;
        return (
          <span
            key={h}
            title={`${label} ${String(h).padStart(2, '0')}:00 — ${n} สาย`}
            style={{
              height: 18,
              borderRadius: 4,
              background: n ? `rgba(31,111,74,${0.16 + (n / max) * 0.84})` : 'var(--panel)',
              border: '1px solid var(--line)',
            }}
          />
        );
      })}
    </>
  );
}
