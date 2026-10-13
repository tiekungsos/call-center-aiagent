'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiSend, CLIENT_API, fmtTime, TENANT } from '@/lib/api';

interface Doc {
  id: string;
  agent_id: string | null;
  title: string | null;
  preview: string;
  created_at: string;
}
interface Hit {
  title: string | null;
  content: string;
  score: number;
}

export default function KnowledgePage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [chunks, setChunks] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${CLIENT_API}/api/knowledge?tenant=${TENANT}`, { cache: 'no-store' });
      const d = (await r.json()) as { documents: Doc[]; chunks: number };
      setDocs(d.documents ?? []);
      setChunks(d.chunks ?? 0);
    } catch {
      setNotice('โหลดคลังความรู้ไม่สำเร็จ');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async () => {
    if (!content.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await apiSend<{ chunks: number }>('/api/knowledge', 'POST', { tenant: TENANT, title, content });
      setNotice(`เพิ่มแล้ว ${r.chunks} chunk`);
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
    if (!query.trim()) return;
    setHits([]);
    try {
      const r = await apiSend<{ results: Hit[] }>('/api/knowledge/search', 'POST', { tenant: TENANT, query, k: 4 });
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
          <p>เอกสารที่ AI ค้นได้ผ่านเครื่องมือ search_knowledge (RAG)</p>
        </div>
        <span className="dim">{chunks} chunk</span>
      </div>

      {notice ? <div className="banner">{notice}</div> : null}

      <div className="grid cols-2" style={{ marginTop: 14, alignItems: 'start' }}>
        <div className="card card-pad grid" style={{ gap: 12 }}>
          <h2>เพิ่มเอกสาร</h2>
          <label>
            หัวข้อ
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น นโยบายการคืนสินค้า" />
          </label>
          <label>
            เนื้อหา (ตัดเป็น chunk อัตโนมัติ)
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={10} placeholder="วางข้อความ FAQ / SOP ที่นี่" />
          </label>
          <div className="row between">
            <span className="dim">{content.length} ตัวอักษร</span>
            <button className="btn primary" onClick={upload} disabled={busy || !content.trim()}>
              {busy ? 'กำลังประมวลผล…' : 'เพิ่มเข้าคลังความรู้'}
            </button>
          </div>
        </div>

        <div className="card card-pad grid" style={{ gap: 12 }}>
          <h2>ทดสอบค้นหา</h2>
          <div className="row" style={{ gap: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
              placeholder="พิมพ์คำถามเหมือนที่ลูกค้าถาม"
            />
            <button className="btn" onClick={search} disabled={!query.trim()}>
              ค้นหา
            </button>
          </div>
          {hits === null ? (
            <p className="muted">ลองค้นดูก่อนใช้งานจริง — ผลที่ได้คือสิ่งที่ AI จะเห็น</p>
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
          <h2>เอกสารในคลัง</h2>
          <span className="dim">{docs.length} chunk</span>
        </div>
        <div className="card">
          {docs.length === 0 ? (
            <div className="empty">
              <strong>คลังว่าง</strong>
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
                    <td className="muted" style={{ maxWidth: 520 }}>
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
  );
}
