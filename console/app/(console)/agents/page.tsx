'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiSend, CLIENT_API, TENANT } from '@/lib/api';
import { VOICES } from '@/lib/voices';

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
  is_active: boolean;
  version: number;
  updated_at: string;
}

interface ToolInfo {
  name: string;
  description?: string;
  /** ยังไม่ต่อระบบจริง (TODO) — เปิดได้ แต่จะตอบผู้โทรว่าให้เจ้าหน้าที่ตรวจสอบ */
  stub?: boolean;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [coreTools, setCoreTools] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Agent | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [cloneFrom, setCloneFrom] = useState('');

  const load = useCallback(async () => {
    try {
      const [agentRes, toolRes] = await Promise.all([
        fetch(`${CLIENT_API}/api/agents?tenant=${TENANT}`, { cache: 'no-store' }),
        fetch(`${CLIENT_API}/api/tools`, { cache: 'no-store' }),
      ]);
      const data = (await agentRes.json()) as { agents: Agent[] };
      const toolData = (await toolRes.json()) as { tools: ToolInfo[]; core: string[] };
      setAgents(data.agents ?? []);
      setTools(toolData.tools ?? []);
      setCoreTools(toolData.core ?? []);
      setState('ready');
      setSelected((cur) => {
        const next = cur && data.agents?.some((a) => a.id === cur) ? cur : (data.agents?.[0]?.id ?? null);
        setDraft(data.agents?.find((a) => a.id === next) ?? null);
        return next;
      });
    } catch {
      setState('error');
    }
  }, []);

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
        tool_guide: draft.tool_guide,
        knowledge_base: draft.knowledge_base,
        style_extra: draft.style_extra,
        enabled_tools: draft.enabled_tools,
      });
      setAgents((prev) => prev.map((a) => (a.id === agent.id ? agent : a)));
      setDraft(agent);
      setNotice(`บันทึกแล้ว (v${agent.version}) — มีผลกับสายใหม่ทันที`);
    } catch (err) {
      setNotice(`บันทึกไม่สำเร็จ: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  /** ตั้ง agent นี้เป็นตัวที่รับสาย/แชท (bridge ล้าง cache ให้ทันที) */
  const activate = async (a: Agent) => {
    setNotice(null);
    try {
      await apiSend(`/api/agents/${a.id}`, 'PATCH', { is_active: true });
      setNotice(`ตั้ง "${a.name}" เป็น agent ที่ใช้งานแล้ว`);
      await load();
    } catch (err) {
      setNotice(`ตั้งไม่สำเร็จ: ${(err as Error).message}`);
    }
  };

  const create = async () => {
    if (!newName.trim()) return;
    const base = agents.find((a) => a.id === cloneFrom);
    setNotice(null);
    try {
      const { agent } = await apiSend<{ agent: Agent }>('/api/agents', 'POST', {
        tenant: TENANT,
        name: newName,
        persona: base?.persona ?? undefined,
        tool_guide: base?.tool_guide ?? undefined,
        knowledge_base: base?.knowledge_base ?? undefined,
        style_extra: base?.style_extra ?? undefined,
        voice: base?.voice ?? undefined,
        enabled_tools: base?.enabled_tools ?? coreTools,
      });
      setCreating(false);
      setNewName('');
      setCloneFrom('');
      setNotice(`สร้าง agent "${agent.name}" แล้ว — ยังไม่ใช้งาน กด "ตั้งเป็นใช้งาน" เมื่อพร้อม`);
      await load();
      pick(agent);
    } catch (err) {
      setNotice(`สร้างไม่สำเร็จ: ${(err as Error).message}`);
    }
  };

  const remove = async (a: Agent) => {
    if (!window.confirm(`ลบ agent "${a.name}" ?`)) return;
    setNotice(null);
    try {
      await apiSend(`/api/agents/${a.id}`, 'DELETE');
      setNotice('ลบ agent แล้ว');
      setSelected(null);
      await load();
    } catch (err) {
      setNotice(`ลบไม่สำเร็จ: ${(err as Error).message}`);
    }
  };

  const set = <K extends keyof Agent>(k: K, v: Agent[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const toggleTool = (name: string) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            enabled_tools: d.enabled_tools.includes(name)
              ? d.enabled_tools.filter((x) => x !== name)
              : [...d.enabled_tools, name],
          }
        : d,
    );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Agent</h1>
          <p>เลือกบริบทธุรกิจที่รับสาย/แชทจริง แล้วแก้บทบาท ฐานความรู้ และเครื่องมือได้จากที่นี่</p>
        </div>
        <button className="btn" onClick={() => setCreating((v) => !v)}>
          {creating ? 'ยกเลิก' : 'เพิ่ม agent'}
        </button>
      </div>

      {state === 'error' ? <div className="banner err">ต่อ API ไม่ได้ — ตรวจว่า bridge รันอยู่</div> : null}
      {notice ? <div className="banner">{notice}</div> : null}

      {creating ? (
        <div className="card card-pad grid" style={{ gap: 10, marginTop: 14 }}>
          <h2>เพิ่ม agent ใหม่</h2>
          <div className="grid cols-2">
            <label>
              ชื่อ agent
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="เช่น ศูนย์บริการสาขา 2" />
            </label>
            <label>
              คัดลอกเนื้อหาจาก (ไม่บังคับ)
              <select value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)}>
                <option value="">— เริ่มจากว่าง —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row between">
            <span className="dim">agent ใหม่จะยังไม่ถูกใช้งานจนกว่าจะกด “ตั้งเป็นใช้งาน”</span>
            <button className="btn primary" onClick={create} disabled={!newName.trim()}>
              สร้าง
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(220px, 300px) 1fr', alignItems: 'start', marginTop: 14 }}>
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
              ระบบจะ seed จากโปรไฟล์ในโค้ดเมื่อ bridge ต่อ DB ได้ครั้งแรก หรือกด “เพิ่ม agent”
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
                      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <span style={{ fontWeight: 600 }}>{a.name}</span>
                        {a.is_active ? <span className="chip ok">ใช้งาน</span> : null}
                      </div>
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
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                {draft.is_active ? (
                  <span className="chip ok">กำลังใช้งาน</span>
                ) : (
                  <button className="btn primary" onClick={() => void activate(draft)}>
                    ตั้งเป็นใช้งาน
                  </button>
                )}
                <button className="btn ghost" onClick={() => void remove(draft)} disabled={draft.is_active}>
                  ลบ
                </button>
              </div>
            </div>

            <div className="grid cols-3">
              <label>
                ชื่อที่แสดง
                <input value={draft.name} onChange={(e) => set('name', e.target.value)} />
              </label>
              <label>
                เสียง
                <select value={draft.voice ?? ''} onChange={(e) => set('voice', e.target.value)}>
                  <option value="">ค่าเริ่มต้น (Zephyr)</option>
                  {VOICES.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} — {v.tone}, {v.pitch}
                    </option>
                  ))}
                  {draft.voice && !VOICES.some((v) => v.name === draft.voice) ? (
                    <option value={draft.voice}>{draft.voice} (กำหนดเอง)</option>
                  ) : null}
                </select>
              </label>
              <label>
                สถานะ
                <select value={draft.status} onChange={(e) => set('status', e.target.value)}>
                  <option value="published">published</option>
                  <option value="draft">draft</option>
                </select>
              </label>
            </div>

            <div>
              <span className="dim" style={{ fontSize: 12, fontWeight: 600 }}>
                เครื่องมือที่เปิดใช้ (มีผลกับสายใหม่ทันที)
              </span>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 11.5 }}>
                เครื่องมือ = สิ่งที่ AI เรียกใช้ได้ระหว่างคุย เช่น โอนสาย เปิดเรื่อง หรือค้นคลังความรู้ — ติ๊กถูกเพื่อเปิด
              </p>
              <div className="grid cols-2" style={{ gap: 10, marginTop: 8 }}>
                {tools.map((t) => {
                  const on = draft.enabled_tools.includes(t.name);
                  return (
                    <label key={t.name} className="tool-option" data-on={on}>
                      <input type="checkbox" style={{ marginTop: 3 }} checked={on} onChange={() => toggleTool(t.name)} />
                      <span>
                        <span className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
                          <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
                            {t.name}
                          </span>
                          {coreTools.includes(t.name) ? <span className="chip">ใช้ทุก agent</span> : null}
                          {t.stub ? <span className="chip warn">ยังไม่ต่อระบบจริง</span> : null}
                        </span>
                        <span className="dim" style={{ display: 'block', fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>
                          {t.description ?? '—'}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {draft.enabled_tools.length === 0 ? (
                <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                  ไม่เลือกอะไรเลย = ใช้เครื่องมือทั้งหมดของโปรไฟล์นี้ (ค่าเริ่มต้นเดิม)
                </p>
              ) : null}
            </div>

            <label>
              Persona (บทบาท + กฎเฉพาะธุรกิจ)
              <textarea value={draft.persona ?? ''} onChange={(e) => set('persona', e.target.value)} rows={8} />
            </label>

            <label>
              คำอธิบายเครื่องมือสำหรับโมเดล (tool guide)
              <textarea value={draft.tool_guide ?? ''} onChange={(e) => set('tool_guide', e.target.value)} rows={4} />
            </label>

            <label>
              ฐานความรู้ (ฝังใน prompt ของสาย — ส่วนนี้คือข้อมูลที่ AI ใช้ตอบโดยตรง)
              <textarea value={draft.knowledge_base ?? ''} onChange={(e) => set('knowledge_base', e.target.value)} rows={14} />
            </label>

            <label>
              หมายเหตุสไตล์การพูด (ต่อท้ายสไตล์กลาง)
              <textarea value={draft.style_extra ?? ''} onChange={(e) => set('style_extra', e.target.value)} rows={3} />
            </label>

            <div className="row between wrap">
              <span className="dim">{notice ?? 'แก้แล้วมีผลกับสายใหม่ทันที (ไม่ต้องรอ cache)'}</span>
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
