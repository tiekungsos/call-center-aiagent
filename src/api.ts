import crypto from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { WebSocketServer } from 'ws';
import { handleLineWebhook, verifyLineSignature } from './chat/line.js';
import { handleChatWs } from './chat/ws.js';
import { invalidateActiveAgent } from './core/agentConfig.js';
import { analyzeCall } from './core/analytics.js';
import * as auth from './core/auth.js';
import * as knowledge from './core/knowledge.js';
import * as store from './core/store.js';
import { dbEnabled } from './db.js';
import { outboundReady, startCampaign } from './outbound/campaign.js';

type Q = { tenant?: string; limit?: string; offset?: string };
type Body = {
  tenant?: string;
  agentId?: string;
  title?: string;
  content?: string;
  query?: string;
  k?: number;
  name?: string;
  goal?: string;
  targets?: { phone: string; name?: string; variables?: Record<string, unknown> }[];
  url?: string;
  events?: string[];
  secret?: string;
  username?: string;
  password?: string;
  role?: string;
  disabled?: boolean;
};

async function tenantOf(slug?: string) {
  const s = slug?.trim() || process.env.TENANT_SLUG?.trim() || 'aileo';
  return store.getTenantBySlug(s);
}

// --- auth console: session cookie + จำกัดจำนวนครั้ง login ผิด (ต่อ IP) ---
const LOGIN_MAX = Math.max(1, Number(process.env.CONSOLE_LOGIN_MAX_ATTEMPTS ?? 5) || 5);
const LOGIN_WINDOW_MS = Math.max(1, Number(process.env.CONSOLE_LOGIN_WINDOW_MINUTES ?? 15) || 15) * 60_000;
const loginAttempts = new Map<string, { n: number; reset: number }>();

/** IP จริงของผู้ใช้ — มาจาก X-Forwarded-For ที่ console proxy ส่งต่อ (หลัง nginx) */
function clientIp(req: FastifyRequest): string {
  const xff = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  return raw?.split(',')[0]?.trim() || (req.headers['x-real-ip'] as string | undefined) || req.ip || 'unknown';
}

function loginAllowed(ip: string): boolean {
  const rec = loginAttempts.get(ip);
  return !rec || rec.reset < Date.now() || rec.n < LOGIN_MAX;
}

function noteLoginFailure(ip: string): void {
  if (loginAttempts.size > 5000) loginAttempts.clear(); // กันหน่วยความจำโต
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || rec.reset < now) loginAttempts.set(ip, { n: 1, reset: now + LOGIN_WINDOW_MS });
  else rec.n += 1;
}

const sessionOf = (req: FastifyRequest) => auth.verifySession(auth.readCookie(req.headers.cookie));

/** ต้องเป็น admin ที่ยังใช้งานได้ — ตอบ error เองถ้าไม่ผ่าน (คืน false) */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const s = sessionOf(req);
  if (!s) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  const u = await auth.getUserById(s.uid);
  if (!u || u.disabled) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  if (u.role !== 'admin') {
    reply.code(403).send({ error: 'ต้องเป็นผู้ดูแลระบบ (admin)' });
    return false;
  }
  return true;
}

/** REST API สำหรับ console (P3) และ analytics (P4) — แยกพอร์ตจาก telephony bridge */
export function buildApi() {
  const app = Fastify({ logger: false });

  // เก็บ raw body ไว้ตรวจ signature ของ LINE (X-Line-Signature)
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as unknown as { rawBody?: Buffer }).rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // ไม่เปิด CORS: console เรียกผ่าน proxy ฝั่ง server ของตัวเอง (app/api/[...path])
  // การเปิด access-control-allow-origin: * บน API ที่ไม่มี auth ทำให้เว็บใดก็ได้
  // อ่านข้อมูลสาย (PII) จากเบราว์เซอร์ของผู้ดูแลผ่าน 127.0.0.1 ได้
  //
  // ถ้าตั้ง API_TOKEN จะบังคับส่ง header x-api-key ทุกเส้นทาง /api/* (console proxy แนบให้)
  const apiToken = process.env.API_TOKEN?.trim();
  const apiTokenBuf = apiToken ? Buffer.from(apiToken) : undefined;
  app.addHook('onRequest', async (req, reply) => {
    if (!apiTokenBuf || !req.url.startsWith('/api/')) return;
    const raw = req.headers['x-api-key'];
    const given = Array.isArray(raw) ? raw[0] : raw;
    // เทียบ byte length ก่อน (กัน timingSafeEqual throw) แล้วค่อยเทียบแบบ constant-time
    const givenBuf = typeof given === 'string' ? Buffer.from(given) : undefined;
    const ok = givenBuf !== undefined && givenBuf.length === apiTokenBuf.length && crypto.timingSafeEqual(givenBuf, apiTokenBuf);
    if (!ok) return reply.code(401).send({ error: 'unauthorized' });
  });

  app.get('/health', async () => ({ ok: true, db: dbEnabled() }));

  // --- login เข้า console ---
  app.post<{ Body: Body }>('/api/auth/login', async (req, reply) => {
    if (!auth.authReady()) {
      return reply.code(503).send({ error: 'ฝั่ง bridge ยังไม่ได้ตั้ง CONSOLE_SESSION_SECRET (อย่างน้อย 16 ตัวอักษร)' });
    }
    const ip = clientIp(req);
    if (!loginAllowed(ip)) {
      return reply.code(429).send({ error: 'พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่' });
    }
    const username = req.body?.username?.trim() ?? '';
    const password = req.body?.password ?? '';
    if (!username || !password) return reply.code(400).send({ error: 'กรอกชื่อผู้ใช้และรหัสผ่าน' });

    const user = await auth.getUserByUsername(username);
    if (!user || user.disabled || !auth.verifyPassword(password, user.password_hash)) {
      noteLoginFailure(ip);
      return reply.code(401).send({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
    loginAttempts.delete(ip);
    await auth.touchLastLogin(user.id);
    reply.header('set-cookie', auth.sessionCookie(auth.signSession(user)));
    const { password_hash: _hash, ...safe } = user;
    return { user: safe };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('set-cookie', auth.clearSessionCookie());
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.code(401).send({ error: 'unauthorized' });
    const user = await auth.getUserById(s.uid);
    if (!user || user.disabled) return reply.code(401).send({ error: 'unauthorized' });
    const { password_hash: _hash, ...safe } = user;
    return { user: safe };
  });

  // --- จัดการผู้ใช้ console (admin เท่านั้น) ---
  app.get('/api/users', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return { users: (await auth.listUsers()) ?? [] };
  });

  app.post<{ Body: Body }>('/api/users', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const username = req.body?.username?.trim();
    const password = req.body?.password ?? '';
    if (!username) return reply.code(400).send({ error: 'ต้องระบุชื่อผู้ใช้' });
    if (password.length < 8) return reply.code(400).send({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
    const user = await auth.createUser({ username, name: req.body?.name, password, role: req.body?.role });
    if (!user) return reply.code(409).send({ error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' });
    return { user };
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/users/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const patch = req.body ?? {};
    if (patch.password !== undefined && patch.password.length < 8) {
      return reply.code(400).send({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
    }
    const target = await auth.getUserById(req.params.id);
    if (!target) return reply.code(404).send({ error: 'not found' });
    // ถ้ากำลังปิด/ลดสิทธิ์ admin คนสุดท้าย จะทำให้ไม่มีใครเข้าได้อีก
    const demoting = target.role === 'admin' && (patch.disabled === true || patch.role === 'viewer');
    if (demoting && (await auth.wouldLockOut(target.id))) {
      return reply.code(400).send({ error: 'ต้องมีผู้ดูแล (admin) ที่ใช้งานได้อย่างน้อย 1 คน' });
    }
    return { user: await auth.updateUser(target.id, patch) };
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    if (sessionOf(req)?.uid === req.params.id) {
      return reply.code(400).send({ error: 'ลบบัญชีที่กำลังใช้งานอยู่ไม่ได้' });
    }
    const target = await auth.getUserById(req.params.id);
    if (!target) return reply.code(404).send({ error: 'not found' });
    if (target.role === 'admin' && (await auth.wouldLockOut(target.id))) {
      return reply.code(400).send({ error: 'ต้องมีผู้ดูแล (admin) ที่ใช้งานได้อย่างน้อย 1 คน' });
    }
    await auth.deleteUser(target.id);
    return { deleted: true };
  });

  app.get('/api/tenants', async () => ({ tenants: (await store.listTenants()) ?? [] }));

  app.get<{ Querystring: Q }>('/api/agents', async (req) => {
    const t = await tenantOf(req.query.tenant);
    return { agents: t ? ((await store.listAgents(t.id)) ?? []) : [] };
  });

  app.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const agent = await store.getAgentById(req.params.id);
    return agent ? { agent } : reply.code(404).send({ error: 'not found' });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/agents/:id', async (req, reply) => {
    const agent = await store.updateAgent(req.params.id, req.body ?? {});
    if (!agent) return reply.code(404).send({ error: 'not found' });
    invalidateActiveAgent(); // ให้ bridge ใช้ค่าใหม่ภายใน ~1 นาที
    return { agent };
  });

  app.get<{ Querystring: Q }>('/api/calls', async (req) => {
    const t = await tenantOf(req.query.tenant);
    if (!t) return { calls: [] };
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const offset = Number(req.query.offset ?? 0) || 0;
    return { calls: (await store.listCalls(t.id, limit, offset)) ?? [] };
  });

  app.get<{ Params: { id: string } }>('/api/calls/:id', async (req, reply) => {
    const detail = await store.getCallDetail(req.params.id);
    return detail ?? reply.code(404).send({ error: 'not found' });
  });

  app.get<{ Querystring: Q }>('/api/tickets', async (req) => {
    const t = await tenantOf(req.query.tenant);
    if (!t) return { tickets: [] };
    return { tickets: (await store.listTickets(t.id, Math.min(Number(req.query.limit ?? 50) || 50, 200))) ?? [] };
  });

  app.get<{ Querystring: Q }>('/api/stats/overview', async (req) => {
    const t = await tenantOf(req.query.tenant);
    return { overview: t ? ((await store.overview(t.id)) ?? null) : null };
  });

  app.get<{ Querystring: Q }>('/api/stats/heatmap', async (req) => {
    const t = await tenantOf(req.query.tenant);
    return { heatmap: t ? ((await store.heatmap(t.id)) ?? []) : [] };
  });

  // --- P4: analytics ---
  app.get<{ Querystring: Q }>('/api/stats/breakdown', async (req) => {
    const t = await tenantOf(req.query.tenant);
    return { breakdown: t ? await store.breakdown(t.id) : { intents: [], sentiments: [], channels: [] } };
  });

  app.post<{ Params: { id: string } }>('/api/calls/:id/analyze', async (req) => {
    return { analysis: (await analyzeCall(req.params.id)) ?? null };
  });

  // --- P5: แคมเปญโทรออก ---
  app.get<{ Querystring: Q }>('/api/campaigns', async (req) => {
    const t = await tenantOf(req.query.tenant);
    return { campaigns: t ? ((await store.listCampaigns(t.id)) ?? []) : [] };
  });

  app.post<{ Body: Body }>('/api/campaigns', async (req, reply) => {
    const t = await tenantOf(req.body?.tenant);
    if (!t) return reply.code(400).send({ error: 'unknown tenant' });
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: 'name required' });
    const campaign = await store.createCampaign({ tenantId: t.id, name, goal: req.body?.goal });
    if (!campaign) return reply.code(500).send({ error: 'create failed' });
    const targets = req.body?.targets ?? [];
    const added = targets.length ? await store.addCampaignTargets(campaign.id, targets) : 0;
    return { campaign, targets: added };
  });

  app.get<{ Params: { id: string } }>('/api/campaigns/:id', async (req, reply) => {
    const campaign = await store.getCampaign(req.params.id);
    if (!campaign) return reply.code(404).send({ error: 'not found' });
    const [stats, targets] = await Promise.all([store.campaignStats(campaign.id), store.listCampaignTargets(campaign.id)]);
    return { campaign, stats, targets: targets ?? [] };
  });

  app.post<{ Params: { id: string } }>('/api/campaigns/:id/start', async (req, reply) => {
    const campaign = await store.getCampaign(req.params.id);
    if (!campaign) return reply.code(404).send({ error: 'not found' });
    if (!outboundReady()) return reply.code(400).send({ error: 'ตั้ง AMI_PASSWORD และ OUTBOUND_TRUNK ก่อนใช้โทรออก' });
    await store.setCampaignStatus(campaign.id, 'running');
    // เดินแคมเปญแบบ background (dial ทีละ batch จนหมดหรือถูก pause) — ไม่บล็อก HTTP request
    void startCampaign(campaign.id).catch((err) => console.error('[campaign]', (err as Error).message));
    return { started: true };
  });

  app.post<{ Params: { id: string } }>('/api/campaigns/:id/pause', async (req) => {
    await store.setCampaignStatus(req.params.id, 'paused');
    return { ok: true };
  });

  // --- P6: webhooks ไป CRM/ERP ---
  app.get<{ Querystring: Q }>('/api/webhooks', async (req) => {
    const t = await tenantOf(req.query.tenant);
    return { webhooks: t ? ((await store.listWebhooks(t.id)) ?? []) : [] };
  });

  app.post<{ Body: Body }>('/api/webhooks', async (req, reply) => {
    const t = await tenantOf(req.body?.tenant);
    if (!t) return reply.code(400).send({ error: 'unknown tenant' });
    if (!req.body?.url) return reply.code(400).send({ error: 'url required' });
    return { webhook: await store.addWebhook({ tenantId: t.id, url: req.body.url, events: req.body.events, secret: req.body.secret }) };
  });

  app.delete<{ Params: { id: string } }>('/api/webhooks/:id', async (req) => {
    await store.removeWebhook(req.params.id);
    return { deleted: true };
  });

  // --- P1: คลังความรู้ (RAG) ---
  app.get<{ Querystring: Q }>('/api/knowledge', async (req) => {
    const t = await tenantOf(req.query.tenant);
    if (!t) return { documents: [], chunks: 0 };
    const [documents, chunks] = await Promise.all([knowledge.listDocs(t.id), knowledge.countDocs(t.id)]);
    return { documents: documents ?? [], chunks: Number(chunks) };
  });

  app.post<{ Body: Body }>('/api/knowledge', async (req, reply) => {
    const t = await tenantOf(req.body?.tenant);
    if (!t) return reply.code(400).send({ error: 'unknown tenant' });
    const content = req.body?.content?.trim();
    if (!content) return reply.code(400).send({ error: 'content required' });
    const chunks = await knowledge.ingest({
      tenantId: t.id,
      agentId: req.body?.agentId,
      title: req.body?.title,
      content,
    });
    return { chunks, status: chunks ? 'ingested' : 'failed' };
  });

  app.post<{ Body: Body }>('/api/knowledge/search', async (req, reply) => {
    const t = await tenantOf(req.body?.tenant);
    if (!t) return reply.code(400).send({ error: 'unknown tenant' });
    const query = req.body?.query?.trim();
    if (!query) return reply.code(400).send({ error: 'query required' });
    return { results: await knowledge.search(t.id, query, req.body?.k ?? 4) };
  });

  app.delete<{ Params: { id: string } }>('/api/knowledge/:id', async (req) => {
    await knowledge.removeDoc(req.params.id);
    return { deleted: true };
  });

  // --- P2: LINE OA webhook ---
  app.post('/line/webhook', async (req, reply) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!raw || !verifyLineSignature(raw, req.headers['x-line-signature'] as string | undefined)) {
      return reply.code(401).send({ error: 'invalid signature' });
    }
    await handleLineWebhook((req.body ?? {}) as { events?: never[] });
    return { ok: true };
  });

  // --- P2: web widget (WebSocket) ---
  const wss = new WebSocketServer({ noServer: true });
  app.server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/chat')) wss.handleUpgrade(req, socket, head, (ws) => handleChatWs(ws));
    else socket.destroy();
  });

  return app;
}
