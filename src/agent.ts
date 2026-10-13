import { EventEmitter } from 'node:events';
import {
  EndSensitivity,
  FunctionCall,
  FunctionResponse,
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  Session,
  StartSensitivity,
} from '@google/genai';
import { bufFromInt16, int16FromBuf, Upsampler8to16 } from './audio.js';
import { CallLogger } from './logger.js';
import { getActiveProfile } from './profiles/index.js';
import { buildSystemPrompt } from './prompt.js';
import { CallAction, runTool, toolsFor } from './tools.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-live';
// ponytail: VAD แบบ peak amplitude ใช้วัด latency อย่างเดียว, ปรับค่าถ้าสายมี noise สูง
const VOICE_PEAK = 1500;

// บริบทของ agent เลือกด้วย env AGENT_PROFILE (ดู src/profiles/)
const PROFILE = getActiveProfile();
const SYSTEM_PROMPT = buildSystemPrompt(PROFILE);
const TOOLS = toolsFor(PROFILE);

/**
 * 1 สาย = 1 CallAgent = 1 Gemini Live session
 * events:
 *   'audio'       (pcm24k: Int16Array)  เสียง AI ที่ต้องเล่นให้ผู้โทร
 *   'interrupted' ()                     ผู้โทรพูดแทรก -> ล้าง buffer เสียงฝั่งโทรศัพท์
 *   'action'      (a: CallAction)        พูดจบแล้ว ให้ adapter โอนสาย/วางสาย
 */
export class CallAgent extends EventEmitter {
  readonly log: CallLogger;
  private session?: Session;
  private ready = false;
  private closed = false;
  private reconnecting = false;
  private resumeHandle?: string;
  private pendingAction?: CallAction;
  private actionTimer?: NodeJS.Timeout;
  private up = new Upsampler8to16();
  private tx = { caller: '', agent: '' };
  // latency: เสียงผู้โทรจบ / inputTranscription ชิ้นสุดท้าย -> audio chunk แรกของ AI
  private lastVoiceAt = 0;
  private lastCallerTxAt = 0;
  private awaitingReply = false;
  private agentSpeaking = false;

  constructor(readonly callId: string, readonly callerNumber?: string) {
    super();
    this.log = new CallLogger(callId);
  }

  async start() {
    try {
      await this.connect();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      this.session!.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: `[ระบบ] มีสายเข้า เวลา ${now} กรุณากล่าวทักทายผู้โทร` }] }],
        turnComplete: true,
      });
    } catch (err) {
      // Gemini ล่ม/ต่อไม่ได้ -> อย่าปล่อยให้ผู้โทรค้าง: โอนหาเจ้าหน้าที่ทันที
      this.log.write('error', { stage: 'connect', message: String(err) });
      this.emit('action', 'transfer' satisfies CallAction);
    }
  }

  /** รับเสียงจากโทรศัพท์ PCM16 8kHz */
  pushPcm8k(pcm8: Int16Array) {
    if (pcm8.some((s) => s > VOICE_PEAK || s < -VOICE_PEAK)) this.lastVoiceAt = Date.now();
    if (!this.ready || this.closed) return;
    const pcm16 = this.up.process(pcm8);
    this.session!.sendRealtimeInput({
      audio: { data: bufFromInt16(pcm16).toString('base64'), mimeType: 'audio/pcm;rate=16000' },
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.actionTimer);
    this.flushTranscripts();
    this.log.write('call_end', {});
    this.session?.close();
  }

  private async connect() {
    this.ready = false;
    this.session = await ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ functionDeclarations: TOOLS }],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.VOICE ?? 'Zephyr' } } },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        // สายโทรศัพท์มี noise -> ลดความไวเริ่มพูด กัน barge-in หลอก
        realtimeInputConfig: {
          automaticActivityDetection: {
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
            silenceDurationMs: 600,
          },
        },
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {},
      },
      callbacks: {
        onmessage: (m) => this.onMessage(m),
        onerror: (e) => this.log.write('error', { stage: 'ws', message: e.message }),
        onclose: () => {
          this.ready = false;
          if (!this.closed) void this.reconnect();
        },
      },
    });
    this.ready = true;
  }

  /** WebSocket ของ Live API มีอายุจำกัด -> ต่อใหม่ด้วย resumption handle โดยบทสนทนาไม่หาย */
  private async reconnect() {
    if (this.reconnecting || this.closed || !this.resumeHandle) return;
    this.reconnecting = true;
    this.log.write('reconnect', {});
    const old = this.session;
    try {
      await this.connect();
      old?.close();
    } catch (err) {
      this.log.write('error', { stage: 'reconnect', message: String(err) });
      this.emit('action', 'transfer' satisfies CallAction);
    } finally {
      this.reconnecting = false;
    }
  }

  private onMessage(m: LiveServerMessage) {
    const sc = m.serverContent;

    if (sc?.interrupted) {
      this.agentSpeaking = false;
      this.emit('interrupted');
    }

    if (sc?.inputTranscription?.text) {
      this.tx.caller += sc.inputTranscription.text;
      this.lastCallerTxAt = Date.now();
      if (!this.agentSpeaking) this.awaitingReply = true;
    }

    for (const p of sc?.modelTurn?.parts ?? []) {
      if (!p.inlineData?.data) continue;
      this.agentSpeaking = true;
      if (this.awaitingReply) this.logLatency();
      this.emit('audio', int16FromBuf(Buffer.from(p.inlineData.data, 'base64')));
    }

    if (sc?.outputTranscription?.text) this.tx.agent += sc.outputTranscription.text;

    if (sc?.turnComplete) {
      this.agentSpeaking = false;
      this.flushTranscripts();
      if (this.pendingAction) this.fireAction();
    }

    if (m.toolCall?.functionCalls?.length) void this.handleToolCalls(m.toolCall.functionCalls);

    const r = m.sessionResumptionUpdate;
    if (r?.resumable && r.newHandle) this.resumeHandle = r.newHandle;

    if (m.goAway) void this.reconnect();
  }

  private async handleToolCalls(calls: FunctionCall[]) {
    const functionResponses: FunctionResponse[] = [];
    for (const fc of calls) {
      const res = await runTool(fc.name ?? '', (fc.args ?? {}) as Record<string, unknown>, {
        callId: this.callId,
        callerNumber: this.callerNumber,
        log: this.log,
      });
      this.log.write('tool', { name: fc.name, args: fc.args, result: res.response });
      functionResponses.push({ id: fc.id, name: fc.name, response: res.response, scheduling: res.scheduling });
      if (res.action) this.setPendingAction(res.action);
    }
    this.session?.sendToolResponse({ functionResponses });
  }

  /** รอให้ AI พูดประโยคสุดท้ายจบ (turnComplete) ก่อนโอน/วางสาย, มี timeout กันค้าง */
  private setPendingAction(a: CallAction) {
    // emergency มีสิทธิ์เหนือกว่าเสมอ
    if (this.pendingAction === 'emergency') return;
    this.pendingAction = a;
    clearTimeout(this.actionTimer);
    this.actionTimer = setTimeout(() => this.fireAction(), a === 'emergency' ? 4000 : 8000);
  }

  private fireAction() {
    const a = this.pendingAction;
    if (!a) return;
    this.pendingAction = undefined;
    clearTimeout(this.actionTimer);
    this.log.write('action', { action: a });
    this.emit('action', a);
  }

  private logLatency() {
    this.awaitingReply = false;
    const now = Date.now();
    this.log.write('latency', {
      fromTranscriptMs: now - this.lastCallerTxAt,
      fromSpeechEndMs: this.lastVoiceAt ? now - this.lastVoiceAt : null,
    });
  }

  private flushTranscripts() {
    if (this.tx.caller.trim()) this.log.write('transcript', { role: 'caller', text: this.tx.caller.trim() });
    if (this.tx.agent.trim()) this.log.write('transcript', { role: 'agent', text: this.tx.agent.trim() });
    this.tx = { caller: '', agent: '' };
  }
}
