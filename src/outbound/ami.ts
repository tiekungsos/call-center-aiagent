import net from 'node:net';

export interface AmiOptions {
  host: string;
  port: number;
  username: string;
  secret: string;
}

/**
 * AMI client แบบ request/response (ทิ้ง event) — พอสำหรับสั่ง Originate
 * protocol: บล็อกคั่นด้วย \r\n\r\n, จบด้วย Response: Success|Error
 */
export class AmiClient {
  private sock?: net.Socket;
  private buf = '';
  private seq = 0;
  private pending = new Map<string, { resolve: (r: Record<string, string>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private loggedIn = false;

  constructor(private readonly opts: AmiOptions) {}

  private connectRaw(): Promise<net.Socket> {
    if (this.sock && !this.sock.destroyed) return Promise.resolve(this.sock);
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.opts.host, port: this.opts.port });
      sock.setEncoding('utf8');
      const fail = (err: Error) => reject(err);
      sock.once('error', fail);
      sock.once('connect', () => {
        sock.off('error', fail);
        this.sock = sock;
        sock.on('data', (d: string) => this.onData(d));
        sock.on('error', (err) => this.failAll(err));
        sock.on('close', () => {
          this.sock = undefined;
          this.loggedIn = false;
        });
        resolve(sock);
      });
    });
  }

  /** ต่อ + login (เรียกซ้ำได้ ปลอดภัย) */
  async ensure(): Promise<void> {
    await this.connectRaw();
    if (this.loggedIn) return;
    const res = await this.send({ Action: 'Login', Username: this.opts.username, Secret: this.opts.secret });
    if (res.Response !== 'Success') throw new Error(`AMI login failed: ${res.Message ?? 'unknown'}`);
    this.loggedIn = true;
  }

  /** สั่ง Originate — คืน response ของ AMI */
  async originate(o: {
    channel: string;
    context: string;
    exten: string;
    priority?: number;
    callerId?: string;
    timeoutMs?: number;
    variables?: Record<string, string>;
  }): Promise<Record<string, string>> {
    await this.ensure();
    const entries: [string, string][] = [
      ['Action', 'Originate'],
      ['Channel', o.channel],
      ['Context', o.context],
      ['Exten', o.exten],
      ['Priority', String(o.priority ?? 1)],
      ['Timeout', String(o.timeoutMs ?? 30_000)],
      ['Async', 'true'],
    ];
    if (o.callerId) entries.push(['CallerID', o.callerId]);
    // AMI รับ Variable ซ้ำได้หลายบรรทัด
    for (const [k, v] of Object.entries(o.variables ?? {})) entries.push(['Variable', `${k}=${v}`]);
    return this.sendEntries(entries);
  }

  close() {
    this.sock?.end();
    this.sock = undefined;
    this.loggedIn = false;
  }

  private send(action: Record<string, string>): Promise<Record<string, string>> {
    return this.sendEntries(Object.entries(action));
  }

  private sendEntries(entries: [string, string][]): Promise<Record<string, string>> {
    const sock = this.sock;
    if (!sock) return Promise.reject(new Error('AMI not connected'));
    const id = `a${++this.seq}`;
    const action = entries.find(([k]) => k === 'Action')?.[1] ?? 'unknown';
    const lines = [...entries, ['ActionID', id] as [string, string]].map(([k, v]) => `${k}: ${v}`);
    sock.write(`${lines.join('\r\n')}\r\n\r\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`AMI timeout: ${action}`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  private onData(chunk: string) {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf('\r\n\r\n')) !== -1) {
      const block = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 4);
      this.handleBlock(block);
    }
  }

  private handleBlock(block: string) {
    const obj: Record<string, string> = {};
    for (const line of block.split('\r\n')) {
      const i = line.indexOf(': ');
      if (i > 0) obj[line.slice(0, i)] = line.slice(i + 2);
    }
    if (!obj.Response) return; // event หรือ banner — ทิ้ง
    const id = obj.ActionID;
    const key = id && this.pending.has(id) ? id : this.pending.keys().next().value;
    if (!key) return;
    const entry = this.pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    entry.resolve(obj);
  }

  private failAll(err: Error) {
    for (const [, e] of this.pending) {
      clearTimeout(e.timer);
      e.reject(err);
    }
    this.pending.clear();
    this.loggedIn = false;
  }
}
