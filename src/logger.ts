import { appendFileSync, mkdirSync } from 'node:fs';

export const DIR = process.env.LOG_DIR ?? './logs';
mkdirSync(DIR, { recursive: true });

/** บันทึกทุกสายเป็น JSONL: transcript, tool calls, errors
 *  (ต่อยอดส่งเข้า dashboard / GlitchTip / DB ได้) */
export class CallLogger {
  private file: string;
  constructor(readonly callId: string) {
    this.file = `${DIR}/${callId.replace(/[^\w-]/g, '')}.jsonl`;
    this.write('call_start', {});
  }
  write(type: string, data: Record<string, unknown>) {
    appendFileSync(this.file, JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + '\n');
  }
}
