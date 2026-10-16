import Link from 'next/link';
import { AnalyzeButton } from '@/components/AnalyzeButton';
import { CallRow } from '@/components/CallRow';
import { actionChip, apiGet, fmtDuration, fmtTime, sentimentChip, short, TENANT } from '@/lib/api';

interface CallRowData {
  id: string;
  channel: string;
  direction: string;
  caller_number: string | null;
  started_at: string;
  ended_at: string | null;
  action: string | null;
  intent: string | null;
  sentiment: string | null;
  agent_name: string | null;
  turns: number;
}

export default async function CallsPage() {
  const data = await apiGet<{ calls: CallRowData[] }>(`/api/calls?tenant=${TENANT}&limit=100`);
  const calls = data?.calls ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>สายและแชท</h1>
          <p>ทุกการสนทนาย้อนหลัง พร้อมความต้องการและผลลัพธ์ — คลิกที่แถวเพื่อดูบทสนทนาเต็ม</p>
        </div>
        <span className="dim">{calls.length} รายการ</span>
      </div>

      <div className="card">
        {calls.length === 0 ? (
          <div className="empty">
            <strong>ยังไม่มีการสนทนา</strong>
            เมื่อมีสายเข้าหรือข้อความแชท รายการจะปรากฏที่นี่ — คลิกที่แถวเพื่อดู transcript เต็ม
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>เริ่ม</th>
                <th>ช่องทาง</th>
                <th>ผู้ติดต่อ</th>
                <th>Agent</th>
                <th>ความต้องการ</th>
                <th>อารมณ์</th>
                <th>ผล</th>
                <th className="num">Turns</th>
                <th className="num">ระยะเวลา</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => {
                const a = actionChip(c.action);
                const s = sentimentChip(c.sentiment);
                const href = `/calls/${c.id}`;
                return (
                  <CallRow key={c.id} href={href}>
                    <td>
                      <Link href={href} className="mono">
                        {fmtTime(c.started_at)}
                      </Link>
                    </td>
                    <td>
                      <span className="chip">{c.channel === 'chat' ? 'แชท' : 'โทร'}</span>
                    </td>
                    <td className="mono">{c.caller_number ?? short(c.id)}</td>
                    <td className="muted">{c.agent_name ?? '—'}</td>
                    <td>{c.intent ?? <span className="dim">รอวิเคราะห์</span>}</td>
                    <td>
                      <span className={`chip ${s.cls}`}>{s.label}</span>
                    </td>
                    <td>
                      <span className={`chip ${a.cls}`}>{a.label}</span>
                    </td>
                    <td className="num dim">{c.turns}</td>
                    <td className="num dim">{fmtDuration(c.started_at, c.ended_at)}</td>
                    <td>
                      <div className="row-actions">
                        <Link href={href} className="btn ghost sm">
                          ดู
                        </Link>
                        <AnalyzeButton callId={c.id} compact />
                      </div>
                    </td>
                  </CallRow>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
