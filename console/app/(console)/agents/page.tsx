'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiSend, CLIENT_API, TENANT } from '@/lib/api';

interface Agent {
  id: string;
  profile_id: string;
  name: string;
  persona: string | null;
  tool_guide: string | null;
  knowledge_base: string | null;
  style_extra: string | null;
  voice: string | null;
  model: string | null;
  enabled_tools: string[];
  status: string;
  version: number;
  updated_at: string;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Agent | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${CLIENT_API}/api/agents?tenant=${TENANT}`, { cache: 'no-store' });
      const data = (await r.json()) as { agents: Agent[] };
      setAgents(data.agents ?? []);
      setState('ready');
      if (!selected && data.agents?.length) {
        setSelected(data.agents[0].id);
        setDraft(data.agents[0]);
      }
    } catch {
      setState('error');
    }
  }, [selected]);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = (a: Agent) => {
    setSelected(a.id);
    setDraft(a);
    setNotice(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setNotice(null);
    try {
      const { agent } = await apiSend<{ agent: Agent }>(`/api/agents/${draft.id}`, 'PATCH', {
        name: draft.name,
        voice: draft.voice || null,
        status: draft.status,
        persona: draft.persona,
        knowledge_base: draft.knowledge_base,
        style_extra: draft.style_extra,
        enabled_tools: draft.enabled_tools,
      });
      setAgents((prev) => prev.map((a) => (a.id === agent.id ? agent : a)));
      setDraft(agent);
      setNotice(`บันทึกแล้ว (v${agent.version}) — มีผลกับสายใหม่ภายใน ~1 นาที`);
    } catch (err) {
      setNotice(`บันทึกไม่สำเร็จ: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof Agent>(k: K, v: Agent[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Agent</h1>
          <p>บทบาท ฐานความรู้ และเครื่องมือของแต่ละบริบทธุรกิจ</p>
        </div>
      </div>

      {state === 'error' ? <div className="banner err">ต่อ API ไม่ได้ — ตรวจว่า bridge รันอยู่</div> : null}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(200px, 260px) 1fr', alignItems: 'start' }}>
        <div className="card">
          {state === 'loading' ? (
            <div className="card-pad grid" style={{ gap: 10 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" />
              ))}
            </div>
          ) : agents.length === 0 ? (
            <div className="empty">
              <strong>ยังไม่มี agent</strong>
              ระบบจะ seed จากโปรไฟล์ในโค้ดเมื่อ bridge ต่อ DB ได้ครั้งแรก
            </div>
          ) : (
            <table>
              <tbody>
                {agents.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => pick(a)}
                    style={{ cursor: 'pointer', background: a.id === selected ? 'var(--accent-soft)' : undefined }}
                  >
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      <div className="dim mono" style={{ fontSize: 11 }}>
                        {a.profile_id} · v{a.version}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {draft ? (
          <div className="card card-pad grid" style={{ gap: 14 }}>
            <div className="row between wrap">
              <h2>{draft.name}</h2>
              <span className={`chip ${draft.status === 'published' ? 'ok' : ''}`}>
                {draft.status === 'published' ? 'ใช้งาน' : 'ฉบับร่าง'}
              </span>
            </div>

            <div className="grid cols-3">
              <label>
                ชื่อที่แสดง
                <input value={draft.name} onChange={(e) => set('name', e.target.value)} />
              </label>
              <label>
                เสียง
                <input value={draft.voice ?? ''} onChange={(e) => set('voice', e.target.value)} placeholder="Zephyr" />
              </label>
              <label>
                สถานะ
                <select value={draft.status} onChange={(e) => set('status', e.target.value)}>
                  <option value="published">published</option>
                  <option value="draft">draft</option>
                </select>
              </label>
            </div>

            <label>
              เครื่องมือที่เปิดใช้ (คั่นด้วย ,)
              <input
                value={draft.enabled_tools.join(', ')}
                onChange={(e) => set('enabled_tools', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                placeholder="check_pawn_ticket, report_emergency"
              />
            </label>

            <label>
              Persona (บทบาท + กฎเฉพาะธุรกิจ)
              <textarea value={draft.persona ?? ''} onChange={(e) => set('persona', e.target.value)} rows={8} />
            </label>

            <label>
              ฐานความรู้
              <textarea value={draft.knowledge_base ?? ''} onChange={(e) => set('knowledge_base', e.target.value)} rows={10} />
            </label>

            <label>
              หมายเหตุสไตล์การพูด (ต่อท้ายสไตล์กลาง)
              <textarea value={draft.style_extra ?? ''} onChange={(e) => set('style_extra', e.target.value)} rows={3} />
            </label>

            <div className="row between wrap">
              <span className="dim">{notice ?? 'แก้แล้วมีผลกับสายใหม่ภายใน ~1 นาที'}</span>
              <button className="btn primary" onClick={save} disabled={saving}>
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
