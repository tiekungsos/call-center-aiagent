'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiSend, CLIENT_API, fmtTime, TENANT } from '@/lib/api';

interface Doc {
  id: string;
  agent_id: string;
  title: string | null;
  preview: string;
  created_at: string;
}
interface Hit {
  title: string | null;
  content: string;
  score: number;
}
interface AgentOption {
  id: string;
  name: string;
  is_active: boolean;
}

export default function KnowledgePage() {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  /** คลังความรู้แยกกันแต่ละ agent — ต้องเลือก agent เสมอ (ค่าเริ่มต้น = ตัวที่ใช้งานอยู่) */
  const [scope, setScope] = useState('');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [chunks, setChunks] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);

  const agent = agents.find((a) => a.id === scope);
  const agentName = agent?.name ?? '—';

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`${CLIENT_API}/api/agents?tenant=${TENANT}`, { cache: 'no-store' });
        const d = (await r.json()) as { agents: AgentOption[] };
        const list = d.agents ?? [];
        setAgents(list);
        setScope((cur) => cur || (list.find((a) => a.is_active)?.id ?? list[0]?.id ?? ''));
      } catch {
        setNotice('โหลดรายชื่อ agent ไม่สำเร็จ');
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!scope) {
      setDocs([]);
      setChunks(0);
      return;
    }
    try {
      const qs = new URLSearchParams({ tenant: TENANT, agentId: scope });
      const r = await fetch(`${CLIENT_API}/api/knowledge?${qs}`, { cache: 'no-store' });
      const d = (await r.json()) as { documents: Doc[]; chunks: number };
      setDocs(d.documents ?? []);
      setChunks(d.chunks ?? 0);
    } catch {
      setNotice('โหลดคลังความรู้ไม่สำเร็จ');
    }
  }, [scope]);

  useEffect(() => {
    setHits(null);
    void load();
  }, [load]);

  const upload = async () => {
    if (!content.trim() || !scope) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await apiSend<{ chunks: number }>('/api/knowledge', 'POST', {
        tenant: TENANT,
        agentId: scope,
        title,
        content,
      });
      setNotice(`เพิ่มแล้ว ${r.chunks} chunk ให้ "${agentName}"`);
      setTitle('');
      setContent('');
      await load();
    } catch (err) {
      setNotice(`เพิ่มไม่สำเร็จ: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    if (!query.trim() || !scope) return;
    setHits([]);
    try {
      const r = await apiSend<{ results: Hit[] }>('/api/knowledge/search', 'POST', {
        tenant: TENANT,
        query,
        k: 4,
        agentId: scope,
      });
      setHits(r.results ?? []);
    } catch (err) {
      setNotice(`ค้นหาไม่สำเร็จ: ${(err as Error).message}`);
    }
  };

  const remove = async (id: string) => {
    await apiSend(`/api/knowledge/${id}`, 'DELETE');
    await load();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>คลังความรู้</h1>
          <p>เอกสารที่ AI ค้นได้ผ่านเครื่องมือ search_knowledge (RAG) — แยกคลังกันแต่ละ agent</p>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <label className="row" style={{ gap: 8, fontWeight: 600, fontSize: 12 }}>
            Agent
            <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ width: 'auto' }} disabled={!agents.length}>
              {agents.length === 0 ? <option value="">— ยังไม่มี agent —</option> : null}
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.is_active ? ' (ใช้งาน)' : ''}
                </option>
              ))}
            </select>
          </label>
          <span className="dim">{chunks} chunk</span>
        </div>
      </div>

      {notice ? <div className="banner">{notice}</div> : null}

      <p className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
        เอกสารผูกกับ agent โดยตรง — ตอนสายจริง AI ของแต่ละ agent จะเห็นเฉพาะเอกสารของตัวเอง ไม่เห็นข้ามกัน
        {agent ? (
          <>
            {' '}
            กำลังดูคลังของ <strong>{agentName}</strong>
            {agent.is_active ? ' (agent ที่ใช้งานอยู่)' : ' (ยังไม่ใช้งาน)'}
          </>
        ) : null}
      </p>

      {agents.length === 0 ? (
        <div className="card">
          <div className="empty">
            <strong>ยังไม่มี agent</strong>
            สร้าง agent ที่หน้า “Agent” ก่อน แล้วจึงเพิ่มเอกสารเข้าคลังความรู้ของ agent นั้น
          </div>
        </div>
      ) : (
        <>
          <div className="grid cols-2" style={{ marginTop: 14, alignItems: 'start' }}>
            <div className="card card-pad grid" style={{ gap: 12 }}>
              <h2>เพิ่มเอกสารให้ {agentName}</h2>
              <label>
                หัวข้อ
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น นโยบายการคืนสินค้า" />
              </label>
              <label>
                เนื้อหา (ตัดเป็น chunk อัตโนมัติ)
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={10}
                  placeholder="วางข้อความ FAQ / SOP ที่นี่"
                />
              </label>
              <div className="row between">
                <span className="dim">
                  {content.length} ตัวอักษร · จะผูกกับ: {agentName}
                </span>
                <button className="btn primary" onClick={upload} disabled={busy || !content.trim() || !scope}>
                  {busy ? 'กำลังประมวลผล…' : 'เพิ่มเข้าคลังความรู้'}
                </button>
              </div>
            </div>

            <div className="card card-pad grid" style={{ gap: 12 }}>
              <h2>ทดสอบค้นหาในคลังของ {agentName}</h2>
              <div className="row" style={{ gap: 8 }}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void search()}
                  placeholder="พิมพ์คำถามเหมือนที่ลูกค้าถาม"
                />
                <button className="btn" onClick={search} disabled={!query.trim() || !scope}>
                  ค้นหา
                </button>
              </div>
              {hits === null ? (
                <p className="muted">ผลที่ได้คือสิ่งที่ AI ของ agent นี้จะเห็นตอนสายจริง</p>
              ) : hits.length === 0 ? (
                <p className="muted">ไม่พบข้อมูลที่ใกล้เคียง</p>
              ) : (
                <div className="grid" style={{ gap: 10 }}>
                  {hits.map((h, i) => (
                    <div key={i} style={{ borderTop: i ? '1px solid var(--line)' : 'none', paddingTop: i ? 10 : 0 }}>
                      <div className="row between">
                        <span style={{ fontWeight: 600 }}>{h.title ?? 'ไม่มีหัวข้อ'}</span>
                        <span className="chip accent">{(h.score * 100).toFixed(0)}%</span>
                      </div>
                      <p className="muted" style={{ marginTop: 4, fontSize: 12.5 }}>
                        {h.content.slice(0, 220)}
                        {h.content.length > 220 ? '…' : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <section className="section">
            <div className="section-head">
              <h2>เอกสารในคลังของ {agentName}</h2>
              <span className="dim">{docs.length} chunk</span>
            </div>
            <div className="card">
              {docs.length === 0 ? (
                <div className="empty">
                  <strong>คลังของ {agentName} ยังว่าง</strong>
                  เพิ่มเอกสารแรกทางซ้าย — ระบบจะตัดเป็น chunk แล้วสร้าง embedding ให้อัตโนมัติ
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>หัวข้อ</th>
                      <th>เนื้อหา</th>
                      <th>เพิ่มเมื่อ</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d) => (
                      <tr key={d.id}>
                        <td>{d.title ?? <span className="dim">ไม่มีหัวข้อ</span>}</td>
                        <td className="muted" style={{ maxWidth: 560 }}>
                          {d.preview}…
                        </td>
                        <td className="dim">{fmtTime(d.created_at)}</td>
                        <td>
                          <button className="btn ghost" onClick={() => remove(d.id)}>
                            ลบ
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
