'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { WateeMark } from '@/components/WateeMark';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `เข้าสู่ระบบไม่สำเร็จ (HTTP ${r.status})`);
      // อ่านปลายทางจาก URL ตอน submit (เลี่ยง useSearchParams ที่ต้องมี Suspense)
      const from = new URLSearchParams(window.location.search).get('from') ?? '/';
      router.replace(from.startsWith('/') ? from : '/');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="desk">
      <div className="slip-pad">
        <span className="slip-under slip-under-2" aria-hidden />
        <span className="slip-under" aria-hidden />

        <form className="slip" onSubmit={submit}>
          <header className="slip-head">
            <span className="slip-brand">
              <WateeMark size={26} />
              <span>
                <span className="slip-name">วาที</span>
                <span className="slip-sub">WATEE CONSOLE</span>
              </span>
            </span>
            <span className="slip-serial">วท-01</span>
          </header>

          <p className="slip-note">ใบบันทึกการเข้าถึงระบบ — สำหรับผู้ดูแลเท่านั้น</p>

          {error ? <div className="banner err">{error}</div> : null}

          <label className="blank">
            <span className="blank-label">ชื่อผู้ใช้</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
          </label>

          <label className="blank">
            <span className="blank-label">รหัสผ่าน</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <button className="btn primary slip-submit" type="submit" disabled={busy || !username || !password}>
            {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
          </button>

          <span className="slip-perf" aria-hidden />

          <footer className="slip-stub">
            <span className="stamp-sm">ระบบภายใน</span>
            <span className="slip-host">console.watee.co</span>
          </footer>
        </form>
      </div>
    </main>
  );
}
