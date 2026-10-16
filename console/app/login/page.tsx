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
    <main className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ marginBottom: 4, padding: '0 0 2px' }}>
          <span className="brand-mark" aria-hidden>
            <WateeMark size={20} />
          </span>
          <span>
            <span className="brand-name" style={{ color: 'var(--ink)' }}>
              วาที
            </span>
            <span className="brand-sub" style={{ display: 'block' }}>
              WATEE Console
            </span>
          </span>
        </div>
        <p className="muted" style={{ margin: '0 0 6px' }}>
          เข้าสู่ระบบสำหรับผู้ดูแล — ระบบภายในเท่านั้น
        </p>

        {error ? <div className="banner err">{error}</div> : null}

        <label>
          ชื่อผู้ใช้
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label>
          รหัสผ่าน
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <button className="btn primary" type="submit" disabled={busy || !username || !password}>
          {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </main>
  );
}
