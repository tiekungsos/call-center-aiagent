import { GoogleGenAI, type Content, type Part } from '@google/genai';
import { getActiveAgent, type ResolvedAgent } from '../core/agentConfig.js';
import * as store from '../core/store.js';
import { CallLogger } from '../logger.js';
import { CallAction, runTool } from '../tools.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
// โมเดลข้อความ (ไม่ใช่ Live) — ตั้ง CHAT_MODEL เป็นรุ่นที่รองรับ generateContent
const CHAT_MODEL = process.env.CHAT_MODEL ?? 'gemini-2.5-flash';

export interface ChatReply {
  text: string;
  action?: CallAction;
}

/**
 * 1 ห้องแชท = 1 ChatSession — ใช้ persona / ฐานความรู้ / เครื่องมือ ชุดเดียวกับสายเสียง
 * ใช้ได้ทั้ง LINE OA และ web widget
 */
export class ChatSession {
  readonly log: CallLogger;
  private cfg?: ResolvedAgent;
  private history: Content[] = [];
  private ready = false;

  constructor(readonly callId: string, readonly from?: string, readonly channel = 'chat') {
    this.log = new CallLogger(callId);
  }

  /** เริ่ม session + ทักทาย (คืนข้อความทักทาย) */
  async start(): Promise<string> {
    const cfg = await getActiveAgent();
    this.cfg = cfg;
    void store.startCall({
      id: this.callId,
      tenantId: cfg.tenantId,
      agentId: cfg.agentId,
      channel: this.channel,
      direction: 'inbound',
      callerNumber: this.from,
    });
    this.ready = true;
    const greeting = await this.turn('[ระบบ] มีผู้ติดต่อเข้ามาในแชท กรุณากล่าวทักทายสั้น ๆ และถามว่าต้องการให้ช่วยเรื่องใด', true);
    return greeting.text;
  }

  async send(text: string): Promise<ChatReply> {
    if (!this.ready) throw new Error('session not started');
    return this.turn(text, false);
  }

  close() {
    this.log.write('call_end', {});
    void store.endCall(this.callId);
  }

  /** 1 รอบสนทนา: วนเรียกโมเดลจนกว่าจะได้คำตอบสุดท้าย (รองรับ tool calls หลายรอบ) */
  private async turn(text: string, isSystem: boolean): Promise<ChatReply> {
    const cfg = this.cfg!;
    this.history.push({ role: 'user', parts: [{ text }] });
    if (!isSystem) {
      this.log.write('transcript', { role: 'caller', text });
      void store.addTurn(this.callId, 'caller', text);
    }

    let action: CallAction | undefined;
    for (let i = 0; i < 4; i++) {
      const res = await ai.models.generateContent({
        model: CHAT_MODEL,
        contents: this.history,
        config: { systemInstruction: cfg.systemPrompt, tools: [{ functionDeclarations: cfg.tools }] },
      });

      const calls = res.functionCalls;
      if (calls?.length) {
        this.history.push({ role: 'model', parts: calls.map((fc): Part => ({ functionCall: fc })) });
        const responses: Part[] = [];
        for (const fc of calls) {
          const r = await runTool(fc.name ?? '', (fc.args ?? {}) as Record<string, unknown>, {
            callId: this.callId,
            callerNumber: this.from,
            tenantId: cfg.tenantId,
            agentId: cfg.agentId,
            log: this.log,
          });
          this.log.write('tool', { name: fc.name, args: fc.args, result: r.response });
          void store.addToolCall(this.callId, fc.name ?? '', fc.args, r.response);
          if (r.action) action = r.action;
          responses.push({ functionResponse: { id: fc.id, name: fc.name, response: r.response } });
        }
        this.history.push({ role: 'user', parts: responses });
        continue;
      }

      const out = res.text ?? '';
      this.history.push({ role: 'model', parts: [{ text: out }] });
      this.log.write('transcript', { role: 'agent', text: out });
      void store.addTurn(this.callId, 'agent', out);
      if (action) void store.setCallAction(this.callId, action);
      return { text: out, action };
    }
    return { text: '', action };
  }
}
