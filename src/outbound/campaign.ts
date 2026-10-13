import * as store from '../core/store.js';
import { AmiClient } from './ami.js';

let client: AmiClient | undefined;

function ami(): AmiClient | undefined {
  const secret = process.env.AMI_PASSWORD;
  if (!secret) return undefined;
  client ??= new AmiClient({
    host: process.env.AMI_HOST ?? '127.0.0.1',
    port: Number(process.env.AMI_PORT ?? 5038),
    username: process.env.AMI_USER ?? 'aileo',
    secret,
  });
  return client;
}

export const outboundReady = () => Boolean(process.env.AMI_PASSWORD && process.env.OUTBOUND_TRUNK);

/**
 * P5: เดินแคมเปญ — dial target ที่ยัง pending ทีละ batch ผ่าน AMI Originate
 * ปลายทางที่รับสายจะเข้าบริบท `police-ai` เดียวกับสายเข้า (AI พูดกับลูกค้าเลย)
 */
export async function runCampaign(campaignId: string): Promise<{ dialed: number; failed: number }> {
  const trunk = process.env.OUTBOUND_TRUNK;
  const amiClient = ami();
  if (!trunk || !amiClient) throw new Error('ต้องตั้ง AMI_PASSWORD และ OUTBOUND_TRUNK ก่อนใช้โทรออก');

  const batch = Number(process.env.CAMPAIGN_BATCH ?? 5);
  const targets = (await store.pendingTargets(campaignId, batch)) ?? [];
  let dialed = 0;
  let failed = 0;

  for (const t of targets) {
    await store.markTargetDialing(t.id);
    try {
      const res = await amiClient.originate({
        channel: `PJSIP/${t.phone}@${trunk}`,
        context: 'police-ai',
        exten: 's',
        priority: 1,
        callerId: process.env.OUTBOUND_CALLER_ID,
        timeoutMs: Number(process.env.OUTBOUND_TIMEOUT_MS ?? 30_000),
        variables: { CAMPAIGN_TARGET: t.id, CAMPAIGN_ID: campaignId },
      });
      if (res.Response === 'Success') {
        dialed++;
        await store.markTargetDone(t.id, 'dialed');
      } else {
        failed++;
        await store.markTargetFailed(t.id, res.Message ?? 'originate failed');
      }
    } catch (err) {
      failed++;
      await store.markTargetFailed(t.id, (err as Error).message);
    }
  }

  const stats = (await store.campaignStats(campaignId)) as { pending?: number } | undefined;
  if (stats && Number(stats.pending) === 0) await store.setCampaignStatus(campaignId, 'done');
  return { dialed, failed };
}

export function closeDialer() {
  client?.close();
  client = undefined;
}
