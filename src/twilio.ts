// Adapter: Twilio Media Streams (μ-law 8kHz over WebSocket) — เหมาะกับ PoC
import type { WebSocket } from 'ws';
import { Downsampler24to8, mulawDecode, mulawEncode } from './audio.js';
import { CallAgent } from './agent.js';
import type { CallAction } from './tools.js';

export function handleTwilio(ws: WebSocket) {
  let streamSid = '';
  let callSid = '';
  let agent: CallAgent | undefined;
  let pending: CallAction | undefined;
  const down = new Downsampler24to8();
  const send = (o: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o));

  ws.on('message', async (raw) => {
    const msg = JSON.parse(raw.toString());
    switch (msg.event) {
      case 'start': {
        streamSid = msg.start.streamSid;
        callSid = msg.start.callSid;
        agent = new CallAgent(callSid, msg.start.customParameters?.from);
        agent.on('audio', (pcm24: Int16Array) => {
          const payload = Buffer.from(mulawEncode(down.process(pcm24))).toString('base64');
          send({ event: 'media', streamSid, media: { payload } });
        });
        agent.on('interrupted', () => send({ event: 'clear', streamSid }));
        agent.on('action', (a: CallAction) => {
          // mark จะถูกส่งกลับมาเมื่อ Twilio เล่นเสียงก่อนหน้าจบแล้ว
          pending = a;
          send({ event: 'mark', streamSid, mark: { name: 'action' } });
        });
        await agent.start();
        break;
      }
      case 'media':
        agent?.pushPcm8k(mulawDecode(Buffer.from(msg.media.payload, 'base64')));
        break;
      case 'mark':
        if (msg.mark?.name === 'action' && pending) {
          const a = pending;
          pending = undefined;
          await twilioAction(callSid, a).catch((e) => agent?.log.write('error', { stage: 'twilio', message: String(e) }));
        }
        break;
      case 'stop':
        agent?.close();
        break;
    }
  });
  ws.on('close', () => agent?.close());
}

async function twilioAction(callSid: string, action: CallAction) {
  const target = action === 'emergency' ? process.env.EMERGENCY_TRANSFER_NUMBER : process.env.OFFICER_TRANSFER_NUMBER;
  const twiml = action === 'hangup' ? '<Response><Hangup/></Response>' : `<Response><Dial>${target}</Dial></Response>`;
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${callSid}.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ Twiml: twiml }),
  });
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${await r.text()}`);
}
