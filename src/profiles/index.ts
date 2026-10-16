import { hospital } from './hospital.js';
import { hotel } from './hotel.js';
import { pawnshop } from './pawnshop.js';
import { police } from './police.js';
import { retail } from './retail.js';
import type { BusinessProfile } from './types.js';

export type { BusinessProfile };

/** โปรไฟล์ที่รองรับ — เพิ่มธุรกิจใหม่ได้โดยสร้างไฟล์ใน profiles/ แล้วลงทะเบียนที่นี่ */
export const PROFILES: Record<string, BusinessProfile> = { police, hospital, hotel, retail, pawnshop };

export const DEFAULT_PROFILE = 'police';

/**
 * เลือกโปรไฟล์จาก env AGENT_PROFILE (ไม่ใส่ = police)
 * BUSINESS_NAME ใช้เปลี่ยนชื่อธุรกิจที่แสดง โดยแทนที่ {{business}} ใน persona/ฐานความรู้
 */
export function getActiveProfile(env: NodeJS.ProcessEnv = process.env): BusinessProfile {
  const id = (env.AGENT_PROFILE ?? DEFAULT_PROFILE).trim().toLowerCase();
  const base = PROFILES[id];
  if (!base) {
    console.warn(
      `[profile] ไม่รู้จัก AGENT_PROFILE="${id}" -> ใช้ "${DEFAULT_PROFILE}" (ที่มี: ${Object.keys(PROFILES).join(', ')})`,
    );
  }
  const p = base ?? PROFILES[DEFAULT_PROFILE];
  const name = env.BUSINESS_NAME?.trim() || p.label;
  const sub = (s: string) => s.replaceAll('{{business}}', name);
  return { ...p, label: name, persona: sub(p.persona), knowledgeBase: sub(p.knowledgeBase) };
}

/** โปรไฟล์ทุกตัวในโค้ด (แทน {{business}} แล้ว) — ใช้ seed เข้า DB ให้ console เลือกได้ */
export function allProfiles(env: NodeJS.ProcessEnv = process.env): BusinessProfile[] {
  const name = env.BUSINESS_NAME?.trim();
  return Object.values(PROFILES).map((p) =>
    name ? { ...p, persona: p.persona.replaceAll('{{business}}', name), knowledgeBase: p.knowledgeBase.replaceAll('{{business}}', name) } : p,
  );
}
