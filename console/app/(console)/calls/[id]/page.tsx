import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AnalyzeButton } from '@/components/AnalyzeButton';
import { actionChip, apiGet, fmtDuration, fmtTime, sentimentChip } from '@/lib/api';

interface Detail {
  call: {
    id: string;
    channel: string;
    direction: string;
    caller_number: string | null;
    started_at: string;
    ended_at: string | null;
    action: string | null;
    recording_path: string | null;
    summary: string | null;
    intent: string | null;
    sentiment: string | null;
    agent_id: string | null;
  };
  turns: { ts: string; role: string; text: string }[];
  tools: { ts: string; name: string; args: unknown; result: unknown }[];
  metrics: { ts: string; from_transcript_ms: number | null; from_speech_end_ms: number | null }[];
}

export default async function CallDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await apiGet<Detail>(`/api/calls/${encodeURIComponent(id)}`);
  if (!detail?.call) notFound();

  const { call, turns, tools, metrics } = detail;
  const a = actionChip(call.action);
  const s = sentimentChip(call.sentiment);
  const avg = metrics.length
    ? Math.round(metrics.reduce((t, m) => t + (m.from_transcript_ms ?? 0), 0) / metrics.length)
    : null;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="dim" style={{ marginBottom: 6 }}>
            <Link href="/calls">← สายและแชท</Link>
          </p>
          <h1 className="mono" style={{ fontSize: 17 }}>
            {call.id}
          </h1>
          <p>
            {call.channel === 'chat' ? 'แชท' : 'โทรศัพท์'} · {call.direction === 'outbound' ? 'ขาออก' : 'ขาเข้า'} ·{' '}
            {fmtTime(call.started_at)} · {fmtDuration(call.started_at, call.ended_at)}
          </p>
        </div>
        <div className="row wrap" style={{ alignItems: 'center' }}>
          <span className={`chip ${a.cls}`}>{a.label}</span>
          <span className={`chip ${s.cls}`}>{s.label}</span>
          <AnalyzeButton callId={call.id} />
        </div>
      </div>

      {call.summary ? (
        <div className="card card-pad" style={{ marginBottom: 14 }}>
          <div className="row between wrap">
            <h3>สรุปการสนทนา</h3>
            <span className="dim" style={{ fontSize: 11.5 }}>
              วิเคราะห์โดย AI จากบทสนทนา
            </span>
          </div>
          <p style={{ marginTop: 6 }}>{call.summary}</p>
          {call.intent ? (
            <p className="muted" style={{ marginTop: 6 }}>
              ความต้องการ: {call.intent}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="card card-pad" style={{ marginBottom: 14 }}>
          <div className="row between wrap">
            <div>
              <h3>ยังไม่ได้วิเคราะห์สายนี้</h3>
              <p className="muted" style={{ marginTop: 6 }}>
                กด “วิเคราะห์” เพื่อให้ AI สรุปบทสนทนา ระบุความต้องการ และประเมินอารมณ์ของผู้ติดต่อ
              </p>
            </div>
            <AnalyzeButton callId={call.id} />
          </div>
        </div>
      )}

      <div className="grid cols-2">
        <div className="card card-pad">
          <h3>ข้อมูลสาย</h3>
          <dl className="kv" style={{ marginTop: 10 }}>
            <dt>ผู้ติดต่อ</dt>
            <dd className="mono">{call.caller_number ?? '—'}</dd>
            <dt>เริ่ม</dt>
            <dd>{fmtTime(call.started_at)}</dd>
            <dt>สิ้นสุด</dt>
            <dd>{fmtTime(call.ended_at)}</dd>
            <dt>บันทึกเสียง</dt>
            <dd className="mono">{call.recording_path ?? '—'}</dd>
            <dt>latency เฉลี่ย</dt>
            <dd>{avg !== null ? `${avg} ms` : '—'}</dd>
          </dl>
        </div>

        <div className="card card-pad">
          <h3>เครื่องมือที่ถูกเรียก</h3>
          {tools.length === 0 ? (
            <p className="muted" style={{ marginTop: 10 }}>
              สายนี้ไม่ได้เรียกเครื่องมือ
            </p>
          ) : (
            <div className="grid" style={{ gap: 10, marginTop: 10 }}>
              {tools.map((t, i) => (
                <div key={i}>
                  <div className="row between">
                    <span className="mono">{t.name}</span>
                    <span className="dim" style={{ fontSize: 11 }}>
                      {fmtTime(t.ts)}
                    </span>
                  </div>
                  <p className="mono dim" style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>
                    {JSON.stringify(t.args)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>บทสนทนา</h2>
          <span className="dim">{turns.length} turns</span>
        </div>
        <div className="card">
          {turns.length === 0 ? (
            <div className="empty">
              <strong>ไม่มี transcript</strong>
              สายนี้อาจจบก่อนที่โมเดลจะถอดเสียงได้
            </div>
          ) : (
            <div className="turns">
              {turns.map((t, i) => (
                <div key={i} className={`turn ${t.role === 'caller' ? 'caller' : 'agent'}`}>
                  <span className="turn-role">{t.role === 'caller' ? 'ผู้ติดต่อ' : t.role === 'agent' ? 'AI' : 'ระบบ'}</span>
                  <span className="turn-text">{t.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
