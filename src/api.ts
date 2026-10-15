import crypto from 'node:crypto';
import Fastify from 'fastify';
import { WebSocketServer } from 'ws';
import { handleLineWebhook, verifyLineSignature } from './chat/line.js';
import { handleChatWs } from './chat/ws.js';
import { invalidateActiveAgent } from './core/agentConfig.js';
import { analyzeCall } from './core/analytics.js';
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
};

async function tenantOf(slug?: string) {
  const s = slug?.trim() || process.env.TENANT_SLUG?.trim() || 'aileo';
  return store.getTenantBySlug(s);
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
