import Fastify from 'fastify';
import { invalidateActiveAgent } from './core/agentConfig.js';
import * as knowledge from './core/knowledge.js';
import * as store from './core/store.js';
import { dbEnabled } from './db.js';

type Q = { tenant?: string; limit?: string; offset?: string };
type Body = { tenant?: string; agentId?: string; title?: string; content?: string; query?: string; k?: number };

async function tenantOf(slug?: string) {
  const s = slug?.trim() || process.env.TENANT_SLUG?.trim() || 'aileo';
  return store.getTenantBySlug(s);
}

/** REST API สำหรับ console (P3) และ analytics (P4) — แยกพอร์ตจาก telephony bridge */
export function buildApi() {
  const app = Fastify({ logger: false });

  // เปิด CORS ให้ console (Next.js) เรียกได้ระหว่าง dev
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('access-control-allow-origin', '*');
    return payload;
  });
  app.options('/*', async (_req, reply) => reply.code(204).send());

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

  return app;
}
