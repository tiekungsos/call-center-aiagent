'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api';

/**
 * ปุ่ม "วิเคราะห์" — เรียก POST /api/calls/:id/analyze (สรุป + ความต้องการ + อารมณ์)
 * แล้ว refresh ข้อมูลจาก server เพื่อให้ผลลัพธ์ขึ้นทันที
 */
export function AnalyzeButton({ callId, compact }: { callId: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ analysis: unknown }>(`/api/calls/${encodeURIComponent(callId)}/analyze`, 'POST');
      if (!r?.analysis) throw new Error('วิเคราะห์ไม่สำเร็จ');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={`btn ghost ${compact ? 'sm' : ''}`}
      onClick={run}
      disabled={busy}
      title={error ?? 'วิเคราะห์บทสนทนา: สรุป ความต้องการ และอารมณ์'}
    >
      {busy ? 'กำลังวิเคราะห์…' : error ? 'ลองใหม่' : 'วิเคราะห์'}
    </button>
  );
}
