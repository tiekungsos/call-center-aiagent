'use client';

import { useEffect, useRef, useState } from 'react';
import { isKnownVoice, voiceSampleUrl } from '@/lib/voices';

/**
 * ปุ่มฟังตัวอย่างเสียง — เล่นไฟล์ตัวอย่างจาก AI Studio (ชื่อเสียง + .wav)
 * ตัวอย่างอยู่ใน <audio> ที่สร้างเอง จึงไม่ต้องมี CORS
 */
export function VoiceSampleButton({ voice }: { voice: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // เปลี่ยนเสียงที่เลือก = หยุดของเดิม และรีเซ็ตปุ่ม
  useEffect(() => {
    setState('idle');
    audioRef.current?.pause();
    audioRef.current = null;
  }, [voice]);

  // ออกจากหน้าแล้วต้องหยุดเสียง
  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  const known = isKnownVoice(voice);

  async function toggle() {
    if (state === 'playing') {
      audioRef.current?.pause();
      audioRef.current = null;
      setState('idle');
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(voiceSampleUrl(voice));
    audioRef.current = audio;
    audio.onended = () => setState('idle');
    setState('loading');
    try {
      await audio.play();
      setState('playing');
    } catch {
      setState('error');
    }
  }

  const label =
    state === 'loading' ? 'กำลังโหลด…' : state === 'playing' ? '■ หยุด' : state === 'error' ? 'ฟังไม่ได้ — ลองใหม่' : '▶ ฟังตัวอย่าง';

  return (
    <button
      type="button"
      className="btn ghost sm"
      onClick={toggle}
      disabled={!known || state === 'loading'}
      title={known ? `ฟังตัวอย่างเสียง ${voice}` : 'เสียงนี้ไม่มีตัวอย่างให้ฟัง'}
    >
      {label}
    </button>
  );
}
