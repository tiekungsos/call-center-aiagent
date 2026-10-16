'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiSend, CLIENT_API, TENANT } from '@/lib/api';

interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
}

const EVENTS = ['call.end', 'call.transfer'];

export default function SettingsPage() {
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<string[]>(['call.end']);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${CLIENT_API}/api/webhooks?tenant=${TENANT}`, { cache: 'no-store' });
      setHooks(((await r.json()) as { webhooks: Webhook[] }).webhooks ?? []);
    } catch {
      setNotice('โหลด webhook ไม่สำเร็จ');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!url.trim()) return;
    try {
      await apiSend('/api/webhooks', 'POST', { tenant: TENANT, url, events, secret: secret || undefined });
      setUrl('');
      setSecret('');
      setNotice('เพิ่ม webhook แล้ว');
      await load();
    } catch (err) {
      setNotice(`เพิ่มไม่สำเร็จ: ${(err as Error).message}`);
    }
  };

  const remove = async (id: string) => {
    await apiSend(`/api/webhooks/${id}`, 'DELETE');
    await load();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>เชื่อมต่อ</h1>
          <p>ส่ง event ไป CRM/ERP ของคุณเมื่อสายจบหรือโอนสาย</p>
        </div>
      </div>

      {notice ? <div className="banner">{notice}</div> : null}

      <div className="grid cols-2" style={{ marginTop: 14, alignItems: 'start' }}>
        <div className="card card-pad grid" style={{ gap: 12 }}>
          <h2>เพิ่ม webhook</h2>
          <label>
            URL ปลายทาง
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://crm.example.com/aileo/hook" />
          </label>
          <label>
            Secret (ใช้เซ็น HMAC-SHA256 ใน header x-aileo-signature)
            <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="ไม่บังคับ" />
          </label>
          <div>
            <span className="dim" style={{ fontSize: 12, fontWeight: 600 }}>
              event ที่ส่ง
            </span>
            <div className="row wrap" style={{ gap: 14, marginTop: 6 }}>
              {EVENTS.map((e) => (
                <label key={e} className="row" style={{ gap: 6, fontWeight: 400, fontSize: 12.5 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={events.includes(e)}
                    onChange={(ev) => setEvents((prev) => (ev.target.checked ? [...prev, e] : prev.filter((x) => x !== e)))}
                  />
                  <span className="mono">{e}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="row between">
            <span className="dim">payload: event, ts, callId, callerNumber, action, summary, intent, sentiment, turns</span>
            <button className="btn primary" onClick={add} disabled={!url.trim()}>
              เพิ่ม
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-pad">
            <h2>webhook ที่ตั้งไว้</h2>
          </div>
          {hooks.length === 0 ? (
            <div className="empty">
              <strong>ยังไม่มี webhook</strong>
              เพิ่ม URL ปลายทางเพื่อให้ระบบแจ้งเตือนเมื่อมีสายจบ — ใช้เชื่อม CRM, ERP หรือระบบตั๋วงาน
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>URL</th>
                  <th>event</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {hooks.map((h) => (
                  <tr key={h.id}>
                    <td className="mono" style={{ overflowWrap: 'anywhere' }}>
                      {h.url}
                    </td>
                    <td>
                      <div className="row wrap" style={{ gap: 4 }}>
                        {h.events.map((e) => (
                          <span key={e} className="chip">
                            {e}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button className="btn ghost" onClick={() => remove(h.id)}>
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <section className="section">
        <div className="card card-pad">
          <h3>screen pop</h3>
          <p className="muted" style={{ marginTop: 6 }}>
            ตั้ง <code className="mono">SCREENPOP_URL</code> ที่ฝั่ง bridge เพื่อให้ตอนโอนสาย ระบบส่งสรุป บทสนทนา และอารมณ์ของลูกค้าไปยังหน้าจอเจ้าหน้าที่ก่อนรับสาย
          </p>
        </div>
      </section>
    </>
  );
}
