'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiSend, CLIENT_API, fmtTime, TENANT } from '@/lib/api';

interface Doc {
  id: string;
  agent_id: string;
  title: string | null;
  preview: string;
  created_at: string;
  kind: string;
  source_name: string | null;
  mime_type: string | null;
  has_file: boolean;
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

const MAX_MB = 15;
const ACCEPT = '.pdf,.md,.markdown,.txt,.csv,.json,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff';
const KIND_LABEL: Record<string, string> = { pdf: 'PDF', image: 'รูป', text: 'ข้อความ' };

/** อ่านไฟล์เป็น base64 ทีละก้อน กันสแตกเมื่อไฟล์ใหญ่ */
async function toBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) bin += String.fromCharCode(...buf.subarray(i, i + step));
  return btoa(bin);
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
  const [dragOver, setDragOver] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  /** อัปโหลดทีละไฟล์ — PDF/รูปใช้ Gemini อ่าน, ไฟล์ข้อความอ่านตรง ๆ */
  const uploadFiles = async (files: File[]) => {
    if (!scope || !files.length) return;
    setBusy(true);
    setNotice(null);
    const done: string[] = [];
    const failed: string[] = [];
    for (const file of files) {
      if (file.size > MAX_MB * 1024 * 1024) {
        failed.push(`${file.name} (ใหญ่เกิน ${MAX_MB}MB)`);
        continue;
      }
      try {
        const r = await apiSend<{ chunks: number; kind: string }>('/api/knowledge/upload', 'POST', {
          tenant: TENANT,
          agentId: scope,
          title,
          filename: file.name,
          mime: file.type,
          dataBase64: await toBase64(file),
        });
        done.push(`${file.name} → ${KIND_LABEL[r.kind] ?? r.kind} ${r.chunks} chunk`);
      } catch (err) {
        failed.push(`${file.name} (${(err as Error).message})`);
      }
    }
    if (done.length) setTitle('');
    setNotice(
      [done.length ? `เพิ่มสำเร็จ: ${done.join(', ')}` : null, failed.length ? `ไม่สำเร็จ: ${failed.join(', ')}` : null]
        .filter(Boolean)
        .join(' · ') || 'ไม่มีไฟล์ที่ประมวลผล',
    );
    setBusy(false);
    await load();
  };

  const uploadText = async () => {
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
      setNotice(`เพิ่มข้อความแล้ว ${r.chunks} chunk ให้ "${agentName}"`);
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
          <p>อัปโหลดไฟล์ PDF / รูป / ข้อความ หรือวางข้อความ — แยกคลังกันแต่ละ agent</p>
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
        เอกสารผูกกับ agent โดยตรง — ตอนสายจริง AI ของแต่ละ agent จะเห็นเฉพาะเอกสารของตัวเอง
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
            <div className="card card-pad grid" style={{ gap: 14 }}>
              <h2>เพิ่มเอกสารให้ {agentName}</h2>

              <div
                className="drop"
                data-over={dragOver}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  void uploadFiles([...e.dataTransfer.files]);
                }}
              >
                <span style={{ fontWeight: 700 }}>ลากไฟล์มาวางที่นี่</span>
                <button className="btn" type="button" onClick={() => fileRef.current?.click()} disabled={busy || !scope}>
                  เลือกไฟล์
                </button>
                <span className="dim" style={{ fontSize: 11.5 }}>
                  PDF · รูป (png/jpg/webp) · ข้อความ (md/txt/csv/json) — ไม่เกิน {MAX_MB}MB ต่อไฟล์ · เลือกหลายไฟล์ได้
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPT}
                  multiple
                  hidden
                  onChange={(e) => {
                    void uploadFiles([...(e.target.files ?? [])]);
                    e.target.value = '';
                  }}
                />
              </div>

              <label>
                หัวข้อ (ไม่บังคับ — ใช้กับไฟล์/ข้อความที่จะเพิ่ม)
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เว้นว่าง = ใช้ชื่อไฟล์" />
              </label>

              <label>
                หรือวางข้อความ
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={8}
                  placeholder="วางข้อความ FAQ / SOP ที่นี่ (ตัดเป็น chunk อัตโนมัติ)"
                />
              </label>

              <div className="row between">
                <span className="dim">
                  {busy ? 'กำลังประมวลผล…' : `${content.length} ตัวอักษร · จะผูกกับ: ${agentName}`}
                </span>
                <button className="btn primary" onClick={uploadText} disabled={busy || !content.trim() || !scope}>
                  เพิ่มข้อความ
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
                  ลากไฟล์มาวาง หรือวางข้อความทางซ้าย — ระบบจะตัดเป็น chunk แล้วสร้าง embedding ให้อัตโนมัติ
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>หัวข้อ</th>
                      <th>ชนิด</th>
                      <th>เนื้อหา</th>
                      <th>เพิ่มเมื่อ</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d) => (
                      <tr key={d.id}>
                        <td>
                          {d.title ?? <span className="dim">ไม่มีหัวข้อ</span>}
                          {d.source_name && d.source_name !== d.title ? (
                            <span className="dim" style={{ display: 'block', fontSize: 11 }}>
                              {d.source_name}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <span className={`chip ${d.kind === 'image' ? 'warn' : ''}`}>{KIND_LABEL[d.kind] ?? d.kind}</span>
                        </td>
                        <td className="muted" style={{ maxWidth: 460 }}>
                          {d.preview}…
                        </td>
                        <td className="dim">{fmtTime(d.created_at)}</td>
                        <td>
                          <div className="row-actions">
                            {d.has_file ? (
                              <a className="btn ghost sm" href={`/api/knowledge-file/${d.id}`} target="_blank" rel="noreferrer">
                                ไฟล์
                              </a>
                            ) : null}
                            <button className="btn ghost sm" onClick={() => remove(d.id)}>
                              ลบ
                            </button>
                          </div>
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
