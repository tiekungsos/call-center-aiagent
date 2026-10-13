import { q } from '../db.js';
import type { BusinessProfile } from '../profiles/types.js';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
}

export interface AgentRow {
  id: string;
  tenant_id: string;
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
  created_at: string;
  updated_at: string;
}

export interface CallRow {
  id: string;
  tenant_id: string;
  agent_id: string | null;
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
  metadata: Record<string, unknown>;
}

/** ทุกฟังก์ชันเป็น no-op ถ้าไม่มี DB — เรียกด้วย void ได้เลยจากสายโทรศัพท์ */

// --- tenants ---
export async function ensureTenant(slug: string, name: string): Promise<Tenant | undefined> {
  await q(`insert into tenants (slug, name) values ($1, $2) on conflict (slug) do nothing`, [slug, name]);
  const rows = await q<Tenant>(`select id, slug, name from tenants where slug = $1`, [slug]);
  return rows?.[0];
}

export const getTenantBySlug = async (slug: string) => (await q<Tenant>(`select id, slug, name from tenants where slug=$1`, [slug]))?.[0];

export const listTenants = () => q<Tenant>(`select id, slug, name from tenants order by created_at`);

// --- agents ---
export async function upsertAgentFromProfile(tenantId: string, p: BusinessProfile): Promise<AgentRow | undefined> {
  await q(
    `insert into agents (tenant_id, profile_id, name, persona, tool_guide, knowledge_base, style_extra, enabled_tools)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (tenant_id, profile_id) do nothing`,
    [tenantId, p.id, p.label, p.persona, p.toolGuide, p.knowledgeBase, p.styleExtra ?? null, p.tools.map((t) => t.name)],
  );
  return getAgent(tenantId, p.id);
}

export const getAgent = async (tenantId: string, profileId: string) =>
  (await q<AgentRow>(`select * from agents where tenant_id=$1 and profile_id=$2`, [tenantId, profileId]))?.[0];

export const getAgentById = async (id: string) => (await q<AgentRow>(`select * from agents where id=$1`, [id]))?.[0];

export const listAgents = (tenantId: string) =>
  q<AgentRow>(`select * from agents where tenant_id=$1 order by profile_id`, [tenantId]);

const AGENT_FIELDS = ['name', 'persona', 'tool_guide', 'knowledge_base', 'style_extra', 'voice', 'model', 'enabled_tools', 'status'] as const;

export async function updateAgent(id: string, patch: Record<string, unknown>): Promise<AgentRow | undefined> {
  const sets: string[] = [];
  const vals: unknown[] = [id];
  for (const f of AGENT_FIELDS) {
    if (f in patch) {
      vals.push(patch[f]);
      sets.push(`${f} = $${vals.length}`);
    }
  }
  if (!sets.length) return getAgentById(id);
  sets.push('updated_at = now()', 'version = version + 1');
  return (await q<AgentRow>(`update agents set ${sets.join(', ')} where id=$1 returning *`, vals))?.[0];
}

// --- calls ---
export async function startCall(c: {
  id: string;
  tenantId?: string;
  agentId?: string;
  channel: string;
  direction: string;
  callerNumber?: string;
}): Promise<void> {
  if (!c.tenantId) return;
  await q(
    `insert into calls (id, tenant_id, agent_id, channel, direction, caller_number)
     values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`,
    [c.id, c.tenantId, c.agentId ?? null, c.channel, c.direction, c.callerNumber ?? null],
  );
}

export const setCallAction = (id: string, action: string) => q(`update calls set action=$2 where id=$1`, [id, action]);

export const endCall = (id: string, recordingPath?: string) =>
  q(`update calls set ended_at=now(), recording_path=coalesce($2, recording_path) where id=$1`, [id, recordingPath ?? null]);

export const addTurn = (callId: string, role: string, text: string) =>
  q(`insert into turns (call_id, role, text) values ($1, $2, $3)`, [callId, role, text]);

export const addToolCall = (callId: string, name: string, args: unknown, result: unknown) =>
  q(`insert into tool_calls (call_id, name, args, result) values ($1, $2, $3, $4)`, [
    callId,
    name,
    args ? JSON.stringify(args) : null,
    result ? JSON.stringify(result) : null,
  ]);

export const addMetric = (callId: string, fromTranscriptMs: number | null, fromSpeechEndMs: number | null) =>
  q(`insert into turn_metrics (call_id, from_transcript_ms, from_speech_end_ms) values ($1, $2, $3)`, [
    callId,
    fromTranscriptMs,
    fromSpeechEndMs,
  ]);

export async function listCalls(tenantId: string, limit = 50, offset = 0) {
  return q(
    `select c.id, c.channel, c.direction, c.caller_number, c.started_at, c.ended_at, c.action, c.intent, c.sentiment,
            a.name as agent_name,
            (select count(*) from turns t where t.call_id = c.id)::int as turns
     from calls c left join agents a on a.id = c.agent_id
     where c.tenant_id = $1
     order by c.started_at desc limit $2 offset $3`,
    [tenantId, limit, offset],
  );
}

export async function getCallDetail(id: string) {
  const calls = await q<CallRow>(`select * from calls where id=$1`, [id]);
  if (!calls?.[0]) return undefined;
  const [turns, tools, metrics] = await Promise.all([
    q(`select ts, role, text from turns where call_id=$1 order by id`, [id]),
    q(`select ts, name, args, result from tool_calls where call_id=$1 order by id`, [id]),
    q(`select ts, from_transcript_ms, from_speech_end_ms from turn_metrics where call_id=$1 order by id`, [id]),
  ]);
  return { call: calls[0], turns: turns ?? [], tools: tools ?? [], metrics: metrics ?? [] };
}

// --- tickets ---
export const addTicket = (t: {
  id: string;
  tenantId?: string;
  callId?: string;
  category?: string;
  summary?: string;
  contactName?: string;
  callbackNumber?: string;
}) => {
  if (!t.tenantId) return Promise.resolve(undefined);
  return q(
    `insert into tickets (id, tenant_id, call_id, category, summary, contact_name, callback_number)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
    [t.id, t.tenantId, t.callId ?? null, t.category ?? null, t.summary ?? null, t.contactName ?? null, t.callbackNumber ?? null],
  );
};

export const listTickets = (tenantId: string, limit = 50) =>
  q(`select * from tickets where tenant_id=$1 order by created_at desc limit $2`, [tenantId, limit]);

// --- stats ---
export async function overview(tenantId: string) {
  return (
    await q<{
      calls: string;
      calls_24h: string;
      open_tickets: string;
      turns: string;
      avg_latency_ms: string;
    }>(
      `select
         (select count(*) from calls where tenant_id=$1) as calls,
         (select count(*) from calls where tenant_id=$1 and started_at > now() - interval '1 day') as calls_24h,
         (select count(*) from tickets where tenant_id=$1 and status='open') as open_tickets,
         (select count(*) from turns where call_id in (select id from calls where tenant_id=$1)) as turns,
         (select coalesce(round(avg(from_transcript_ms)),0) from turn_metrics where call_id in (select id from calls where tenant_id=$1)) as avg_latency_ms`,
      [tenantId],
    )
  )?.[0];
}

export const heatmap = (tenantId: string) =>
  q(
    `select extract(dow from started_at)::int as dow, extract(hour from started_at)::int as hour, count(*)::int as calls
     from calls where tenant_id=$1 group by 1, 2 order by 1, 2`,
    [tenantId],
  );
