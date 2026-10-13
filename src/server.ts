import 'dotenv/config';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { buildApi } from './api.js';
import { startAudioSocketServer, takeNextAction } from './audiosocket.js';
import { getActiveAgent } from './core/agentConfig.js';
import { migrate } from './db.js';
import { handleTwilio } from './twilio.js';

const PORT = Number(process.env.PORT ?? 8080);
const API_PORT = Number(process.env.API_PORT ?? 8090);
// ฟังเฉพาะ localhost: Asterisk อยู่เครื่องเดียวกัน, Twilio ให้ผ่าน reverse proxy
const HOST = process.env.BIND_HOST ?? '127.0.0.1';
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// เตรียม DB (ถ้าตั้ง DATABASE_URL) + resolve agent (seed tenant/agent ให้ครั้งแรก)
const hasDb = await migrate();
const agent = await getActiveAgent();
console.log(`[profile] ${agent.profileId} (${agent.name}) tenant=${agent.tenantId ?? '-'} db=${hasDb ? 'on' : 'off'}`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  // Twilio voice webhook -> เปิด Media Stream มาที่ /twilio
  if (req.method === 'POST' && url.pathname === '/twilio/voice') {
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://${process.env.PUBLIC_HOST}/twilio" /></Connect></Response>`,
    );
    return;
  }

  // Asterisk dialplan ถามว่าจะทำอะไรต่อ (เปิดเฉพาะ localhost)
  const m = url.pathname.match(/^\/next\/([0-9a-f-]{36})$/);
  if (m && LOCAL.has(req.socket.remoteAddress ?? '')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(takeNextAction(m[1]));
    return;
  }

  if (url.pathname === '/health') {
    res.end('ok');
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, sock, head) => {
  if (req.url?.startsWith('/twilio')) wss.handleUpgrade(req, sock, head, (ws) => handleTwilio(ws));
  else sock.destroy();
});

server.listen(PORT, HOST, () => console.log(`HTTP/WS listening ${HOST}:${PORT}`));
startAudioSocketServer(Number(process.env.AUDIOSOCKET_PORT ?? 9093), HOST);

// REST API สำหรับ console/analytics
const api = buildApi();
api
  .listen({ port: API_PORT, host: HOST })
  .then(() => console.log(`API listening ${HOST}:${API_PORT}`))
  .catch((err) => console.error('[api]', err));
