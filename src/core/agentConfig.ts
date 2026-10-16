import type { FunctionDeclaration } from '@google/genai';
import { allProfiles, getActiveProfile } from '../profiles/index.js';
import type { BusinessProfile } from '../profiles/types.js';
import { buildSystemPrompt } from '../prompt.js';
import { toolsFor, toolsFromNames } from '../tools.js';
import * as store from './store.js';
import type { AgentRow } from './store.js';

/** บริบทที่พร้อมใช้ของ agent 1 ตัว (resolve จาก DB ที่ตั้งค่าใน console ก่อน ถ้าไม่มีค่อยใช้โปรไฟล์ในโค้ด) */
export interface ResolvedAgent {
  tenantId?: string;
  agentId?: string;
  profileId: string;
  name: string;
  profile: BusinessProfile;
  systemPrompt: string;
  tools: FunctionDeclaration[];
  voice: string;
  model: string;
}

const CACHE_TTL_MS = Number(process.env.AGENT_CACHE_TTL_MS ?? 60_000);
let cached: { at: number; value: ResolvedAgent } | undefined;
let inflight: Promise<ResolvedAgent> | undefined;

/** ค่าเริ่มต้นของ agent ที่ยังไม่ได้ตั้ง voice/model เอง (มาจาก env) — ให้ console แสดงได้ตรงความจริง */
export const agentDefaults = () => ({
  voice: process.env.VOICE?.trim() || 'Zephyr',
  model: process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-live',
});

/**
 * คืน agent ที่ใช้งานอยู่ (cache สั้น ๆ ให้ console แก้แล้วมีผลภายใน ~1 นาที)
 * ลำดับความสำคัญ: agent ที่ตั้ง "ใช้งาน" ไว้ใน console (DB) -> โปรไฟล์ในโค้ด (AGENT_PROFILE)
 */
export function getActiveAgent(): Promise<ResolvedAgent> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return Promise.resolve(cached.value);
  inflight ??= resolve()
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

/** ล้าง cache — เรียกหลัง console แก้/สลับ agent เพื่อให้มีผลทันที */
export function invalidateActiveAgent() {
  cached = undefined;
}

async function resolve(): Promise<ResolvedAgent> {
  const slug = process.env.TENANT_SLUG?.trim() || 'watee';
  const envProfile = getActiveProfile();
  const byId = new Map(allProfiles().map((p) => [p.id, p]));

  const tenant = await store.ensureTenant(slug, process.env.TENANT_NAME?.trim() || 'WATEE');
  let row: AgentRow | undefined;

  if (tenant) {
    // seed โปรไฟล์ทุกตัวจากโค้ดครั้งแรก เพื่อให้ console เลือก/แก้ได้ (ไม่ทับของเดิม)
    await store.seedAgents(tenant.id, [...byId.values()]);
    row = await store.getActiveAgentRow(tenant.id);
    if (!row) {
      // ยังไม่มีตัวไหนถูกตั้งเป็น "ใช้งาน" -> ใช้โปรไฟล์จาก AGENT_PROFILE เป็นค่าเริ่มต้น
      const first = await store.getAgent(tenant.id, envProfile.id);
      if (first) row = await store.setActiveAgent(tenant.id, first.id);
    }
  }

  // โปรไฟล์ในโค้ดที่ตรงกับ agent นี้ ใช้เป็นค่าสำรองเฉพาะ field ที่ว่างใน DB
  const codeProfile = (row && byId.get(row.profile_id)) || envProfile;
  const profile = row ? profileFromRow(row, codeProfile) : envProfile;

  return {
    tenantId: tenant?.id,
    agentId: row?.id,
    profileId: row?.profile_id ?? envProfile.id,
    name: profile.label,
    profile,
    systemPrompt: buildSystemPrompt(profile),
    tools: row ? toolsForRow(row, codeProfile) : toolsFor(envProfile),
    // console (DB) เป็นเจ้าของค่า — env VOICE/GEMINI_MODEL เป็นแค่ค่าเริ่มต้นของ agent ที่ยังไม่ได้ตั้ง
    voice: row?.voice?.trim() || agentDefaults().voice,
    model: row?.model?.trim() || agentDefaults().model,
  };
}

/**
 * เครื่องมือของ agent — ใช้ enabled_tools ที่ตั้งใน console เป็นหลัก
 * ถ้าว่าง (agent รุ่นเก่า/ยังไม่ตั้ง) ใช้เครื่องมือทั้งหมดของโปรไฟล์นั้น
 */
function toolsForRow(row: AgentRow, codeProfile: BusinessProfile): FunctionDeclaration[] {
  const names = row.enabled_tools ?? [];
  return names.length ? toolsFromNames(names) : toolsFor(codeProfile);
}

/** ประกอบ BusinessProfile จากแถวใน DB โดย field ที่ว่างให้ใช้ค่าจากโปรไฟล์ในโค้ด */
function profileFromRow(row: AgentRow, fallback: BusinessProfile): BusinessProfile {
  return {
    ...fallback,
    label: row.name || fallback.label,
    persona: row.persona ?? fallback.persona,
    toolGuide: row.tool_guide ?? fallback.toolGuide,
    knowledgeBase: row.knowledge_base ?? fallback.knowledgeBase,
    styleExtra: row.style_extra ?? fallback.styleExtra,
  };
}
