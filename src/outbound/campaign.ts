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

/** แคมเปญที่กำลังเดินอยู่ใน process นี้ (กันสั่ง start ซ้ำ) */
const running = new Set<string>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** dial เบอร์ที่ยัง pending ไม่เกิน `limit` เบอร์ — ตั้งเป็น dialing แล้วรอให้ bridge ปิดผลตอนวางสาย */
async function dialBatch(campaignId: string, limit: number): Promise<{ dialed: number; failed: number }> {
  const trunk = process.env.OUTBOUND_TRUNK;
  const amiClient = ami();
  if (!trunk || !amiClient) throw new Error('ต้องตั้ง AMI_PASSWORD และ OUTBOUND_TRUNK ก่อนใช้โทรออก');

  const targets = (await store.pendingTargets(campaignId, limit)) ?? [];
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
        // dialplan ใช้ CAMPAIGN_TARGET เป็น CALLID เพื่อให้ bridge รู้ว่าสายนี้เป็นสายออกของแคมเปญ
        variables: { CAMPAIGN_TARGET: t.id, CAMPAIGN_ID: campaignId },
      });
      // Async Originate: Success = รับคำสั่งแล้ว (ยังไม่รับสาย) -> ปล่อยเป็น dialing แล้วปิดผลตอนวางสาย
      if (res.Response === 'Success') dialed++;
      else {
        failed++;
        await store.markTargetFailed(t.id, res.Message ?? 'originate failed');
      }
    } catch (err) {
      failed++;
      await store.markTargetFailed(t.id, (err as Error).message);
    }
  }
  return { dialed, failed };
}

/**
 * P5: เดินแคมเปญต่อเนื่องแบบ background — dial จน target หมดหรือถูก pause
 * `CAMPAIGN_BATCH` คือเพดานสายพร้อมกัน: dial เพิ่มเฉพาะเมื่อจำนวนสายที่ยัง dialing อยู่ต่ำกว่า batch
 * ปลายทางที่รับสายจะเข้าบริบท `police-ai` เดียวกับสายเข้า (bridge รู้ว่าเป็นสายออกจาก CAMPAIGN_TARGET)
 * เรียกแบบ fire-and-forget จาก API ได้เลย
 */
export async function startCampaign(campaignId: string): Promise<void> {
  if (running.has(campaignId)) return;
  running.add(campaignId);
  const batch = Math.max(1, Number(process.env.CAMPAIGN_BATCH ?? 5));
  // เบอร์ที่ไม่รับสายจะค้างสถานะ dialing -> ปิดเป็น failed เมื่อเกิน timeout
  const unansweredSec = Math.ceil(Number(process.env.OUTBOUND_TIMEOUT_MS ?? 30_000) / 1000) + 15;
  // สายที่เชื่อมแล้วแต่ค้าง dialing นานเกินนี้ = ปิดผลไม่สำเร็จ (กันแคมเปญค้างเพราะ process ตายกลางสาย)
  const stuckSec = Math.max(900, unansweredSec * 4);
  try {
    for (;;) {
      const campaign = await store.getCampaign(campaignId);
      if (!campaign || campaign.status !== 'running') break;
      await store.failStaleDialing(campaignId, unansweredSec);
      await store.failOrphanedDialing(campaignId, stuckSec);

      const stats = (await store.campaignStats(campaignId)) as { pending?: number; dialing?: number } | undefined;
      const pending = Number(stats?.pending ?? 0);
      const dialing = Number(stats?.dialing ?? 0);
      if (pending === 0 && dialing === 0) break;

      // เคารพ CAMPAIGN_BATCH เป็นเพดานสายพร้อมกัน — dial เฉพาะช่องที่ว่าง
      if (pending > 0 && dialing < batch) await dialBatch(campaignId, batch - dialing);
      await sleep(2000);
    }
    await store.maybeFinishCampaign(campaignId);
  } finally {
    running.delete(campaignId);
  }
}

export function closeDialer() {
  client?.close();
  client = undefined;
}
