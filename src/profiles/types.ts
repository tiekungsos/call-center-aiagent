import type { FunctionDeclaration } from '@google/genai';

/** เพศของเจ้าหน้าที่ AI — คุมคำลงท้าย (ครับ/ค่ะ) และใช้จัดกลุ่มเสียง */
export type Gender = 'male' | 'female';

/**
 * 1 โปรไฟล์ = 1 บริบทธุรกิจของ agent เลือกใช้ด้วย env AGENT_PROFILE
 * โครงสร้าง prompt ที่ประกอบออกมา: persona -> PDPA -> เครื่องมือ -> สไตล์พูด -> ฐานความรู้
 */
export interface BusinessProfile {
  /** รหัสที่ใช้กับ AGENT_PROFILE เช่น "police" */
  id: string;
  /** ชื่อธุรกิจเริ่มต้น (ใช้แทน {{business}} ถ้าไม่ตั้ง BUSINESS_NAME) */
  label: string;
  /** บทบาท + กฎเฉพาะธุรกิจ (เปิดสาย/เหตุด่วน/ขอบเขตงาน) — ต้น system prompt */
  persona: string;
  /** คำอธิบายเครื่องมือในหัวข้อ "## เครื่องมือ" */
  toolGuide: string;
  /** ฐานความรู้ที่ AI ใช้ตอบ */
  knowledgeBase: string;
  /** หมายเหตุสไตล์พูดเฉพาะธุรกิจ ต่อท้ายสไตล์กลาง (ถ้ามี) */
  styleExtra?: string;
  /** เพศของเจ้าหน้าที่ AI (ไม่ใส่ = female) */
  gender?: Gender;
  /** ค่าเริ่มต้นเสียงของโมเดล (env VOICE ทับได้) */
  voice?: string;
  /** ค่าเริ่มต้นโมเดล (env GEMINI_MODEL ทับได้) */
  model?: string;
  /** เครื่องมือเฉพาะธุรกิจ — เครื่องมือกลาง (transfer/create_ticket/end_call) ถูกเพิ่มให้อัตโนมัติ */
  tools: FunctionDeclaration[];
}
