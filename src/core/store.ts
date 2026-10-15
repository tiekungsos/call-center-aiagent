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

export const updateCallAnalysis = (id: string, a: { summary?: string; intent?: string; sentiment?: string }) =>
  q(
    `update calls set summary=coalesce($2, summary), intent=coalesce($3, intent), sentiment=coalesce($4, sentiment) where id=$1`,
    [id, a.summary ?? null, a.intent ?? null, a.sentiment ?? null],
  );

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
    // started_at เป็น timestamptz -> แปลงเป็นเวลาไทยก่อน extract ไม่งั้นชั่วโมงจะเพี้ยน 7 ชม. (DB รัน UTC)
    `select extract(dow from started_at at time zone 'Asia/Bangkok')::int as dow,
            extract(hour from started_at at time zone 'Asia/Bangkok')::int as hour,
            count(*)::int as calls
     from calls where tenant_id=$1 group by 1, 2 order by 1, 2`,
    [tenantId],
  );

/** P4: แยกตาม intent / sentiment + ค่าเฉลี่ยความยาวสาย */
export async function breakdown(tenantId: string) {
  const [intents, sentiments, channels] = await Promise.all([
    q(
      `select coalesce(intent, 'ไม่ระบุ') as label, count(*)::int as n from calls
       where tenant_id=$1 group by 1 order by n desc limit 10`,
      [tenantId],
    ),
    q(`select coalesce(sentiment, 'ไม่ระบุ') as label, count(*)::int as n from calls where tenant_id=$1 group by 1 order by n desc`, [tenantId]),
    q(`select channel as label, count(*)::int as n from calls where tenant_id=$1 group by 1 order by n desc`, [tenantId]),
  ]);
  return { intents: intents ?? [], sentiments: sentiments ?? [], channels: channels ?? [] };
}

export const setCallSummary = (id: string, summary: string) => q(`update calls set summary=$2 where id=$1`, [id, summary]);

// --- P5: campaigns (โทรออก) ---
export interface CampaignRow {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  name: string;
  status: string;
  goal: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export const createCampaign = async (c: { tenantId: string; agentId?: string; name: string; goal?: string }) =>
  (
    await q<CampaignRow>(
      `insert into campaigns (tenant_id, agent_id, name, goal) values ($1, $2, $3, $4) returning *`,
      [c.tenantId, c.agentId ?? null, c.name, c.goal ?? null],
    )
  )?.[0];

export const listCampaigns = (tenantId: string) =>
  q<CampaignRow>(`select * from campaigns where tenant_id=$1 order by created_at desc limit 100`, [tenantId]);

export const getCampaign = async (id: string) => (await q<CampaignRow>(`select * from campaigns where id=$1`, [id]))?.[0];

/** target + ข้อมูลแคมเปญ (ใช้ตอนสายออกเชื่อมเข้ามา เพื่อรู้ว่าสายนี้เป็นสายออกของแคมเปญไหน) */
export interface CampaignTargetRow {
  id: string;
  campaign_id: string;
  phone: string;
  name: string | null;
  variables: Record<string, unknown>;
  campaign_name: string;
  goal: string | null;
}

export const getCampaignTarget = async (id: string) =>
  (
    await q<CampaignTargetRow>(
      `select t.id, t.campaign_id, t.phone, t.name, t.variables, c.name as campaign_name, c.goal
       from campaign_targets t join campaigns c on c.id = t.campaign_id
       where t.id=$1`,
      [id],
    )
  )?.[0];

export const setCampaignStatus = (id: string, status: string) =>
  q(
    `update campaigns set status=$2,
       started_at = case when $2='running' and started_at is null then now() else started_at end,
       finished_at = case when $2='done' then now() else finished_at end
     where id=$1`,
    [id, status],
  );

export async function addCampaignTargets(
  campaignId: string,
  targets: { phone: string; name?: string; variables?: Record<string, unknown> }[],
): Promise<number> {
  let n = 0;
  for (const t of targets) {
    const r = await q(`insert into campaign_targets (campaign_id, phone, name, variables) values ($1, $2, $3, $4) returning id`, [
      campaignId,
      t.phone,
      t.name ?? null,
      JSON.stringify(t.variables ?? {}),
    ]);
    if (r) n++;
  }
  return n;
}

export const pendingTargets = (campaignId: string, limit: number) =>
  q<{ id: string; phone: string; name: string | null; variables: Record<string, unknown>; attempts: number }>(
    `select id, phone, name, variables, attempts from campaign_targets
     where campaign_id=$1 and status='pending' order by id limit $2`,
    [campaignId, limit],
  );

export const markTargetDialing = (id: string) =>
  q(`update campaign_targets set status='dialing', attempts=attempts+1, updated_at=now() where id=$1`, [id]);
export const markTargetDone = (id: string, outcome: string) =>
  q(`update campaign_targets set status='done', outcome=$2, updated_at=now() where id=$1`, [id, outcome]);
export const markTargetFailed = (id: string, outcome: string) =>
  q(`update campaign_targets set status='failed', outcome=$2, updated_at=now() where id=$1`, [id, outcome]);
/** ผูก call_id ของสายออกเข้ากับ target (ตอน bridge เริ่มสนทนาจริง) */
export const linkTargetCall = (id: string, callId: string) =>
  q(`update campaign_targets set call_id=$2, updated_at=now() where id=$1`, [id, callId]);
/** ปิด target ที่ dial แล้วแต่ไม่มีใครรับ (call_id ยังว่าง) นานเกิน timeout */
export const failStaleDialing = (campaignId: string, olderThanSec: number) =>
  q(
    `update campaign_targets set status='failed', outcome='ไม่รับสาย (timeout)', updated_at=now()
     where campaign_id=$1 and status='dialing' and call_id is null
       and updated_at < now() - make_interval(secs => $2::double precision)`,
    [campaignId, olderThanSec],
  );
/** ปิด target ที่สายเชื่อมแล้วแต่ agent ไม่ได้ปิดผล (process ตายกลางสาย) — ไม่งั้นค้าง dialing ตลอด */
export const failOrphanedDialing = (campaignId: string, stuckSec: number) =>
  q(
    `update campaign_targets t set status='failed', outcome='ไม่ทราบผล (ปิดผลไม่สำเร็จ)', updated_at=now()
     from calls c
     where t.call_id = c.id and t.campaign_id=$1 and t.status='dialing'
       and (c.ended_at is not null or t.updated_at < now() - make_interval(secs => $2::double precision))`,
    [campaignId, stuckSec],
  );

export const campaignStats = async (campaignId: string) =>
  (
    await q(
      `select count(*)::int as total,
              count(*) filter (where status='pending')::int as pending,
              count(*) filter (where status='dialing')::int as dialing,
              count(*) filter (where status='done')::int as done,
              count(*) filter (where status='failed')::int as failed
       from campaign_targets where campaign_id=$1`,
      [campaignId],
    )
  )?.[0];

export const listCampaignTargets = (campaignId: string, limit = 200) =>
  q(
    `select id, phone, name, status, outcome, attempts, updated_at from campaign_targets
     where campaign_id=$1 order by id limit $2`,
    [campaignId, limit],
  );

/** ปิดแคมเปญเป็น done เมื่อไม่มี target ค้าง pending/dialing แล้ว */
export async function maybeFinishCampaign(campaignId: string): Promise<void> {
  const stats = (await campaignStats(campaignId)) as { pending?: number; dialing?: number } | undefined;
  if (stats && Number(stats.pending ?? 0) === 0 && Number(stats.dialing ?? 0) === 0) {
    await setCampaignStatus(campaignId, 'done');
  }
}

// --- P6: webhooks ---
export const listWebhooks = (tenantId: string) =>
  q<{ id: string; url: string; events: string[]; enabled: boolean }>(
    `select id, url, events, enabled from webhooks where tenant_id=$1 order by created_at`,
    [tenantId],
  );

export const addWebhook = async (w: { tenantId: string; url: string; events?: string[]; secret?: string }) =>
  (
    await q(`insert into webhooks (tenant_id, url, events, secret) values ($1, $2, $3, $4) returning id, url, events, enabled`, [
      w.tenantId,
      w.url,
      w.events ?? ['call.end'],
      w.secret ?? null,
    ])
  )?.[0];

export const removeWebhook = (id: string) => q(`delete from webhooks where id=$1`, [id]);

/** webhook ที่ต้องยิงจริง (คืน secret ด้วย — ใช้ภายในเท่านั้น อย่าส่งออก API) */
export const activeWebhooks = (tenantId: string, event: string) =>
  q<{ id: string; url: string; secret: string | null }>(
    `select id, url, secret from webhooks where tenant_id=$1 and enabled and $2 = any(events)`,
    [tenantId, event],
  );
