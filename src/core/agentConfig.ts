import type { FunctionDeclaration } from '@google/genai';
import { getActiveProfile } from '../profiles/index.js';
import type { BusinessProfile } from '../profiles/types.js';
import { buildSystemPrompt } from '../prompt.js';
import { toolsFor } from '../tools.js';
import * as store from './store.js';
import type { AgentRow } from './store.js';

/** บริบทที่พร้อมใช้ของ agent 1 ตัว (resolve จาก DB ก่อน ถ้าไม่มีค่อยใช้โปรไฟล์ในโค้ด) */
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

/**
 * คืน agent ที่ใช้งานอยู่ (cache สั้น ๆ ให้ console แก้แล้วมีผลภายใน ~1 นาที)
 * ลำดับความสำคัญ: แถวใน DB (แก้จาก console) -> โปรไฟล์ในโค้ด (src/profiles)
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

/** ล้าง cache — เรียกหลัง console แก้ agent เพื่อให้มีผลทันที */
export function invalidateActiveAgent() {
  cached = undefined;
}

async function resolve(): Promise<ResolvedAgent> {
  const slug = process.env.TENANT_SLUG?.trim() || 'aileo';
  const base = getActiveProfile();

  const tenant = await store.ensureTenant(slug, process.env.TENANT_NAME?.trim() || 'AILEO');
  let profile = base;
  let agentId: string | undefined;
  let voice: string | undefined;
  let model: string | undefined;

  if (tenant) {
    const row = await store.upsertAgentFromProfile(tenant.id, base);
    if (row) {
      agentId = row.id;
      profile = profileFromRow(row, base);
      voice = row.voice ?? undefined;
      model = row.model ?? undefined;
    }
  }

  return {
    tenantId: tenant?.id,
    agentId,
    profileId: base.id,
    name: profile.label,
    profile,
    systemPrompt: buildSystemPrompt(profile),
    tools: toolsFor(profile),
    voice: process.env.VOICE?.trim() || voice || 'Zephyr',
    model: process.env.GEMINI_MODEL?.trim() || model || 'gemini-3.8-live',
  };
}

/** ประกอบ BusinessProfile จากแถวใน DB โดย field ที่ว่างให้ใช้ค่าจากโปรไฟล์ในโค้ด */
function profileFromRow(row: AgentRow, fallback: BusinessProfile): BusinessProfile {
  const enabled = row.enabled_tools ?? [];
  const tools = enabled.length ? fallback.tools.filter((t) => t.name && enabled.includes(t.name)) : fallback.tools;
  return {
    ...fallback,
    label: row.name || fallback.label,
    persona: row.persona ?? fallback.persona,
    toolGuide: row.tool_guide ?? fallback.toolGuide,
    knowledgeBase: row.knowledge_base ?? fallback.knowledgeBase,
    styleExtra: row.style_extra ?? fallback.styleExtra,
    tools,
  };
}
