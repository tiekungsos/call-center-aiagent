import { Behavior, FunctionDeclaration, FunctionResponseScheduling, Type } from '@google/genai';
import * as knowledge from './core/knowledge.js';
import type { CallLogger } from './logger.js';
import type { BusinessProfile } from './profiles/types.js';

export type CallAction = 'transfer' | 'emergency' | 'hangup';

export interface ToolContext {
  callId: string;
  callerNumber?: string;
  tenantId?: string;
  agentId?: string;
  log: CallLogger;
}

export interface ToolResult {
  response: Record<string, unknown>;
  action?: CallAction;
  scheduling?: FunctionResponseScheduling;
}

// gemini-3.8-live: default = NON_BLOCKING (async)
// ตัวที่ต้องให้โมเดล "รอผล" ก่อนพูดต่อ ตั้งเป็น BLOCKING
const transfer_to_agent: FunctionDeclaration = {
  name: 'transfer_to_agent',
  description: 'โอนสายไปยังเจ้าหน้าที่/พนักงาน (ไม่ใช่เหตุด่วน)',
  behavior: Behavior.BLOCKING,
  parameters: {
    type: Type.OBJECT,
    properties: {
      category: { type: Type.STRING, description: 'หมวดเรื่อง เช่น online_fraud, report_case, appointment, complaint, other' },
      summary: { type: Type.STRING, description: 'สรุปเรื่องของผู้โทรสำหรับเจ้าหน้าที่' },
    },
    required: ['category', 'summary'],
  },
};

const create_ticket: FunctionDeclaration = {
  name: 'create_ticket',
  description: 'เปิดเรื่องร้องเรียนหรือขอให้เจ้าหน้าที่ติดต่อกลับ คืนค่าเลขเรื่อง',
  behavior: Behavior.NON_BLOCKING,
  parameters: {
    type: Type.OBJECT,
    properties: {
      category: { type: Type.STRING },
      summary: { type: Type.STRING },
      contact_name: { type: Type.STRING, description: 'ชื่อที่ผู้โทรให้เรียก' },
      callback_number: { type: Type.STRING, description: 'เบอร์ติดต่อกลับ ถ้าผู้โทรต้องการ' },
    },
    required: ['category', 'summary'],
  },
};

const end_call: FunctionDeclaration = {
  name: 'end_call',
  description: 'วางสายหลังจากกล่าวลาผู้โทรแล้ว',
  behavior: Behavior.BLOCKING,
  parameters: { type: Type.OBJECT, properties: {} },
};

/** ค้นคลังความรู้เพิ่มเติม (RAG) — ใช้เมื่อคำตอบไม่อยู่ในข้อมูลที่ให้มา */
const search_knowledge: FunctionDeclaration = {
  name: 'search_knowledge',
  description: 'ค้นฐานความรู้/เอกสารที่อัปโหลดไว้ ใช้เมื่อไม่แน่ใจว่ามีข้อมูลหรือไม่ หรือต้องการรายละเอียดเพิ่ม',
  behavior: Behavior.BLOCKING,
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'คำค้นหรือคำถามของผู้โทร' },
    },
    required: ['query'],
  },
};

/** เครื่องมือที่ทุกธุรกิจมีเหมือนกัน */
export const CORE_TOOLS: FunctionDeclaration[] = [transfer_to_agent, create_ticket, end_call, search_knowledge];

/** เหตุด่วน — ใช้กับธุรกิจที่มีเส้นตายเรื่องความปลอดภัย (ตำรวจ, โรงพยาบาล) */
export const report_emergency: FunctionDeclaration = {
  name: 'report_emergency',
  description: 'เรียกทันทีเมื่อมีเหตุด่วนเหตุร้ายหรืออันตรายต่อชีวิต ระบบจะโอนสายไปยังเจ้าหน้าที่รับเหตุด่วน',
  behavior: Behavior.BLOCKING,
  parameters: {
    type: Type.OBJECT,
    properties: {
      situation: { type: Type.STRING, description: 'สรุปเหตุการณ์สั้นๆ' },
      location: { type: Type.STRING, description: 'สถานที่เกิดเหตุเท่าที่ทราบ' },
    },
    required: ['situation'],
  },
};

export const book_appointment: FunctionDeclaration = {
  name: 'book_appointment',
  description: 'บันทึกความต้องการนัดหมาย เจ้าหน้าที่จะยืนยันเวลาอีกครั้ง',
  behavior: Behavior.NON_BLOCKING,
  parameters: {
    type: Type.OBJECT,
    properties: {
      department: { type: Type.STRING, description: 'แผนก/คลินิกที่ต้องการนัด' },
      preferred_time: { type: Type.STRING, description: 'วันและเวลาที่ผู้โทรสะดวก' },
      contact_name: { type: Type.STRING, description: 'ชื่อผู้ป่วย' },
      callback_number: { type: Type.STRING, description: 'เบอร์ติดต่อกลับ' },
    },
    required: ['department'],
  },
};

export const book_reservation: FunctionDeclaration = {
  name: 'book_reservation',
  description: 'บันทึกความต้องการจองห้องพักหรือโต๊ะอาหาร ยังไม่ใช่การยืนยัน',
  behavior: Behavior.NON_BLOCKING,
  parameters: {
    type: Type.OBJECT,
    properties: {
      type: { type: Type.STRING, enum: ['room', 'table'] },
      date_time: { type: Type.STRING, description: 'วันและเวลา' },
      party_size: { type: Type.STRING, description: 'จำนวนคน/จำนวนห้อง' },
      contact_name: { type: Type.STRING },
      callback_number: { type: Type.STRING },
    },
    required: ['type'],
  },
};

export const check_order: FunctionDeclaration = {
  name: 'check_order',
  description: 'ตรวจสอบสถานะคำสั่งซื้อด้วยเลขคำสั่งซื้อหรือเบอร์โทร',
  behavior: Behavior.BLOCKING,
  parameters: {
    type: Type.OBJECT,
    properties: {
      order_id: { type: Type.STRING, description: 'เลขคำสั่งซื้อ ถ้ามี' },
      phone: { type: Type.STRING, description: 'เบอร์โทรที่ใช้สั่งซื้อ ถ้าไม่มีเลขคำสั่งซื้อ' },
    },
  },
};

export const check_pawn_ticket: FunctionDeclaration = {
  name: 'check_pawn_ticket',
  description: 'ตรวจสอบวันครบกำหนดหรือยอดดอกเบี้ยของตั๋วจำนำ (ต้องมีเลขที่ตั๋วจำนำ)',
  behavior: Behavior.BLOCKING,
  parameters: {
    type: Type.OBJECT,
    properties: {
      ticket_number: { type: Type.STRING, description: 'เลขที่ตั๋วจำนำด้านบนตั๋ว' },
      request: { type: Type.STRING, description: 'สิ่งที่ต้องการตรวจสอบ เช่น วันครบกำหนด, ยอดดอกเบี้ย' },
    },
    required: ['ticket_number'],
  },
};

/** รวมเครื่องมือกลาง + เครื่องมือเฉพาะของโปรไฟล์ */
export const toolsFor = (profile: BusinessProfile): FunctionDeclaration[] => [...CORE_TOOLS, ...profile.tools];

/** เครื่องมือทั้งหมดที่ระบบรู้จัก — ให้ console เลือกเปิด/ปิดต่อ agent ได้ */
export const ALL_TOOLS: FunctionDeclaration[] = [
  ...CORE_TOOLS,
  report_emergency,
  book_appointment,
  book_reservation,
  check_order,
  check_pawn_ticket,
];

/**
 * เครื่องมือที่ยังไม่ต่อระบบจริง (TODO) — เปิดได้ แต่จะตอบผู้โทรว่าให้เจ้าหน้าที่ตรวจสอบ
 * ใช้แสดงคำเตือนใน console ไม่ให้เข้าใจว่าเชื่อมข้อมูลจริงแล้ว
 */
export const STUB_TOOLS = new Set(['check_order', 'check_pawn_ticket']);

const TOOL_BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name as string, t]));

/** ประกอบเครื่องมือจากชื่อ (ที่เก็บใน agents.enabled_tools) — ข้ามชื่อที่ไม่รู้จักและชื่อซ้ำ */
export const toolsFromNames = (names: string[]): FunctionDeclaration[] => {
  const seen = new Set<string>();
  const out: FunctionDeclaration[] = [];
  for (const n of names) {
    const t = TOOL_BY_NAME.get(n);
    if (t && !seen.has(n)) {
      seen.add(n);
      out.push(t);
    }
  }
  return out;
};

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  switch (name) {
    case 'report_emergency':
      // TODO: ส่ง alert เข้า dashboard ศูนย์สั่งการ (webhook / LINE Notify / websocket)
      ctx.log.write('emergency', { ...args, callerNumber: ctx.callerNumber });
      return {
        response: { status: 'transferring', instruction: 'แจ้งผู้โทรว่ากำลังโอนสายด่วน' },
        action: 'emergency',
      };

    case 'transfer_to_agent':
      // TODO: ส่ง summary ขึ้นจอเจ้าหน้าที่ก่อนรับสาย (screen pop)
      return {
        response: { status: 'transferring', instruction: 'แจ้งผู้โทรว่ากำลังโอนสาย กรุณารอสักครู่' },
        action: 'transfer',
      };

    case 'create_ticket': {
      // TODO: เปลี่ยนเป็น API ระบบเรื่องร้องเรียนจริง
      const ticketId = 'T' + Date.now().toString(36).toUpperCase().slice(-6);
      ctx.log.write('ticket', { ticketId, ...args, callerNumber: ctx.callerNumber });
      return {
        response: { ticket_id: ticketId, status: 'created' },
        scheduling: FunctionResponseScheduling.WHEN_IDLE,
      };
    }

    case 'book_appointment': {
      // TODO: ต่อ API ระบบนัดหมายจริง
      const appointmentId = 'A' + Date.now().toString(36).toUpperCase().slice(-6);
      ctx.log.write('appointment', { appointmentId, ...args, callerNumber: ctx.callerNumber });
      return {
        response: { appointment_id: appointmentId, status: 'pending_confirmation' },
        scheduling: FunctionResponseScheduling.WHEN_IDLE,
      };
    }

    case 'book_reservation': {
      // TODO: ต่อ API ระบบจองจริง
      const ref = 'R' + Date.now().toString(36).toUpperCase().slice(-6);
      ctx.log.write('reservation', { ref, ...args, callerNumber: ctx.callerNumber });
      return {
        response: { reservation_ref: ref, status: 'pending_confirmation' },
        scheduling: FunctionResponseScheduling.WHEN_IDLE,
      };
    }

    case 'check_order':
      // TODO: ต่อ API ระบบคำสั่งซื้อจริง — ตอนนี้ยังไม่มีข้อมูลจริง ให้เปิดเรื่องให้เจ้าหน้าที่ตรวจสอบ
      ctx.log.write('order_lookup', { ...args, callerNumber: ctx.callerNumber });
      return {
        response: {
          status: 'unavailable',
          instruction: 'ยังเชื่อมต่อระบบคำสั่งซื้อจริงไม่ได้ ให้บอกผู้โทรว่าขอเปิดเรื่องให้เจ้าหน้าที่ตรวจสอบและติดต่อกลับ',
        },
        scheduling: FunctionResponseScheduling.WHEN_IDLE,
      };

    case 'check_pawn_ticket':
      // TODO: ต่อ API ระบบตั๋วจำนำจริง — ตอนนี้ยังไม่มีข้อมูลจริง ให้เปิดเรื่องให้เจ้าหน้าที่ตรวจสอบ
      ctx.log.write('pawn_lookup', { ...args, callerNumber: ctx.callerNumber });
      return {
        response: {
          status: 'unavailable',
          instruction: 'ยังเชื่อมต่อระบบตั๋วจำนำจริงไม่ได้ ให้บอกผู้โทรว่าจะให้เจ้าหน้าที่ตรวจสอบวันครบกำหนด/ยอดดอกเบี้ยให้ และเปิดเรื่องให้ติดต่อกลับ',
        },
        scheduling: FunctionResponseScheduling.WHEN_IDLE,
      };

    case 'search_knowledge': {
      const query = String(args.query ?? '');
      // กรองตาม agent ที่ใช้งาน (เอกสารที่ไม่ผูก agent = ใช้ร่วมทุก agent)
      const hits = ctx.tenantId ? await knowledge.search(ctx.tenantId, query, 4, ctx.agentId) : [];
      return {
        response: hits.length
          ? {
              results: hits.map((h) => ({ title: h.title, text: h.content, score: Number(h.score.toFixed(3)) })),
              instruction: 'ตอบจากผลค้นหานี้เท่านั้น ถ้าไม่ตรงกับคำถามให้บอกว่าไม่มีข้อมูล',
            }
          : {
              results: [],
              instruction: 'ไม่พบข้อมูลในฐานความรู้ ให้บอกผู้โทรว่าไม่มีข้อมูล และเสนอโอนสายหรือเปิดเรื่องให้เจ้าหน้าที่ติดต่อกลับ',
            },
      };
    }

    case 'end_call':
      return { response: { status: 'ok' }, action: 'hangup' };

    default:
      return { response: { error: `unknown tool ${name}` } };
  }
}
