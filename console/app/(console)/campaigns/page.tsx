'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiSend, CLIENT_API, fmtTime, TENANT } from '@/lib/api';

interface Campaign {
  id: string;
  name: string;
  status: string;
  goal: string | null;
  created_at: string;
}
interface Stats {
  total: number;
  pending: number;
  dialing: number;
  done: number;
  failed: number;
}
interface Target {
  id: string;
  phone: string;
  name: string | null;
  status: string;
  outcome: string | null;
  attempts: number;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [open, setOpen] = useState<{ stats: Stats; targets: Target[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [phones, setPhones] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${CLIENT_API}/api/campaigns?tenant=${TENANT}`, { cache: 'no-store' });
      setCampaigns(((await r.json()) as { campaigns: Campaign[] }).campaigns ?? []);
    } catch {
      setNotice('โหลดแคมเปญไม่สำเร็จ');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const inspect = useCallback(async (id: string) => {
    setSelected(id);
    try {
      const r = await fetch(`${CLIENT_API}/api/campaigns/${id}`, { cache: 'no-store' });
      const d = (await r.json()) as { stats: Stats; targets: Target[] };
      setOpen({ stats: d.stats, targets: d.targets ?? [] });
    } catch {
      setNotice('โหลดผลแคมเปญไม่สำเร็จ');
    }
  }, []);

  // แคมเปญที่กำลังเดินอยู่เบื้องหลัง -> ดึงสถานะใหม่เป็นระยะ
  const selectedRunning = campaigns.find((c) => c.id === selected)?.status === 'running';
  useEffect(() => {
    if (!selected || !selectedRunning) return;
    const t = setInterval(() => {
      void load();
      void inspect(selected);
    }, 3000);
    return () => clearInterval(t);
  }, [selected, selectedRunning, load, inspect]);

  const create = async () => {
    const targets = phones
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [phone, label] = l.split(',').map((s) => s.trim());
        return { phone, name: label };
      });
    if (!name.trim() || targets.length === 0) {
      setNotice('ต้องมีชื่อแคมเปญและเบอร์อย่างน้อย 1 เบอร์');
      return;
    }
    setBusy(true);
    try {
      await apiSend('/api/campaigns', 'POST', { tenant: TENANT, name, goal, targets });
      setNotice(`สร้างแคมเปญแล้ว ${targets.length} เบอร์`);
      setName('');
      setGoal('');
      setPhones('');
      await load();
    } catch (err) {
      setNotice(`สร้างไม่สำเร็จ: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const start = async (id: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await apiSend<{ started: boolean }>(`/api/campaigns/${id}/start`, 'POST');
      setNotice('เริ่มแคมเปญแล้ว — ระบบโทรออกเป็นชุดอยู่เบื้องหลัง ตารางผลรายเบอร์จะอัปเดตอัตโนมัติ');
      await load();
      await inspect(id);
    } catch (err) {
      setNotice(`เริ่มไม่สำเร็จ: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>โทรออก</h1>
          <p>แคมเปญโทรออกพร้อมผลรายเบอร์ — ต้องตั้ง AMI และ OUTBOUND_TRUNK ก่อน</p>
        </div>
        <span className="dim">{campaigns.length} แคมเปญ</span>
      </div>

      {notice ? <div className="banner">{notice}</div> : null}

      <div className="grid cols-2" style={{ marginTop: 14, alignItems: 'start' }}>
        <div className="card card-pad grid" style={{ gap: 12 }}>
          <h2>สร้างแคมเปญ</h2>
          <label>
            ชื่อแคมเปญ
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ติดตามลูกค้าตั๋วครบกำหนด" />
          </label>
          <label>
            เป้าหมาย (ไม่บังคับ)
            <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="เช่น แจ้งเตือนก่อนหมดอายุ 7 วัน" />
          </label>
          <label>
            เบอร์ปลายทาง — บรรทัดละเบอร์ (ใส่ชื่อต่อท้ายด้วย , ได้)
            <textarea value={phones} onChange={(e) => setPhones(e.target.value)} rows={8} placeholder={'+66812345678, คุณสมชาย\n+66876543210'} />
          </label>
          <div className="row between">
            <span className="dim">{phones.split('\n').filter((l) => l.trim()).length} เบอร์</span>
            <button className="btn primary" onClick={create} disabled={busy}>
              สร้างแคมเปญ
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-pad">
            <h2>แคมเปญทั้งหมด</h2>
          </div>
          {campaigns.length === 0 ? (
            <div className="empty">
              <strong>ยังไม่มีแคมเปญ</strong>
              สร้างแคมเปญแรกทางซ้าย แล้วกดเริ่มเพื่อให้ระบบโทรออกทีละ batch
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ชื่อ</th>
                  <th>สถานะ</th>
                  <th>สร้างเมื่อ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} style={{ background: c.id === selected ? 'var(--accent-soft)' : undefined }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      <div className="dim" style={{ fontSize: 11 }}>
                        {c.goal ?? '—'}
                      </div>
                    </td>
                    <td>
                      <span className={`chip ${c.status === 'running' ? 'warn' : c.status === 'done' ? 'ok' : ''}`}>{c.status}</span>
                    </td>
                    <td className="dim">{fmtTime(c.created_at)}</td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn ghost" onClick={() => inspect(c.id)}>
                          ดู
                        </button>
                        <button className="btn" onClick={() => start(c.id)} disabled={busy}>
                          เริ่ม
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {open ? (
        <section className="section">
          <div className="section-head">
            <h2>ผลรายเบอร์</h2>
            <div className="row" style={{ gap: 8 }}>
              <span className="chip">ทั้งหมด {open.stats.total}</span>
              <span className="chip warn">ค้าง {open.stats.pending}</span>
              <span className="chip ok">สำเร็จ {open.stats.done}</span>
              {open.stats.failed ? <span className="chip err">ล้มเหลว {open.stats.failed}</span> : null}
            </div>
          </div>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>เบอร์</th>
                  <th>ชื่อ</th>
                  <th>สถานะ</th>
                  <th>ผล</th>
                  <th className="num">ครั้งที่โทร</th>
                </tr>
              </thead>
              <tbody>
                {open.targets.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.phone}</td>
                    <td>{t.name ?? '—'}</td>
                    <td>
                      <span className={`chip ${t.status === 'done' ? 'ok' : t.status === 'failed' ? 'err' : ''}`}>{t.status}</span>
                    </td>
                    <td className="muted">{t.outcome ?? '—'}</td>
                    <td className="num dim">{t.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
