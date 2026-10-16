'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiSend, fmtTime } from '@/lib/api';

interface User {
  id: string;
  username: string;
  name: string | null;
  role: string;
  disabled: boolean;
  last_login_at: string | null;
  created_at: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<{ id: string; username: string; role: string } | null>(null);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('admin');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, current] = await Promise.all([
        fetch('/api/users', { cache: 'no-store' }).then((r) => r.json() as Promise<{ users?: User[] }>),
        fetch('/api/auth/me', { cache: 'no-store' }).then((r) => r.json() as Promise<{ user?: User }>),
      ]);
      setUsers(list.users ?? []);
      setMe(current.user ? { id: current.user.id, username: current.user.username, role: current.user.role } : null);
    } catch {
      setNotice('โหลดรายชื่อผู้ใช้ไม่สำเร็จ');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setNotice(null);
    try {
      await apiSend('/api/users', 'POST', { username, name: name || undefined, password, role });
      setUsername('');
      setName('');
      setPassword('');
      setRole('admin');
      setNotice('เพิ่มผู้ใช้แล้ว');
      await load();
    } catch (err) {
      setNotice(`เพิ่มไม่สำเร็จ: ${(err as Error).message}`);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>, ok: string) => {
    setNotice(null);
    try {
      await apiSend(`/api/users/${id}`, 'PATCH', body);
      setNotice(ok);
      await load();
    } catch (err) {
      setNotice(`แก้ไขไม่สำเร็จ: ${(err as Error).message}`);
    }
  };

  const resetPassword = (u: User) => {
    const next = window.prompt(`ตั้งรหัสผ่านใหม่ให้ "${u.username}" (อย่างน้อย 8 ตัวอักษร)`);
    if (next === null) return;
    if (next.length < 8) {
      setNotice('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
      return;
    }
    void patch(u.id, { password: next }, `รีเซ็ตรหัสผ่านของ ${u.username} แล้ว`);
  };

  const remove = async (u: User) => {
    if (!window.confirm(`ลบผู้ใช้ "${u.username}" ?`)) return;
    setNotice(null);
    try {
      await apiSend(`/api/users/${u.id}`, 'DELETE');
      setNotice('ลบผู้ใช้แล้ว');
      await load();
    } catch (err) {
      setNotice(`ลบไม่สำเร็จ: ${(err as Error).message}`);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ผู้ใช้</h1>
          <p>บัญชีที่เข้าถึง console ได้ — admin จัดการผู้ใช้และดูทุกหน้าได้, viewer ดูได้อย่างเดียว</p>
        </div>
      </div>

      {notice ? <div className="banner">{notice}</div> : null}

      <div className="grid cols-2" style={{ marginTop: 14, alignItems: 'start' }}>
        <div className="card card-pad grid" style={{ gap: 12 }}>
          <h2>เพิ่มผู้ใช้</h2>
          <label>
            ชื่อผู้ใช้ (username)
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="เช่น somchai" autoComplete="off" />
          </label>
          <label>
            ชื่อที่แสดง
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ไม่บังคับ" />
          </label>
          <label>
            รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label>
            สิทธิ์
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">admin — จัดการได้ทุกอย่าง</option>
              <option value="viewer">viewer — ดูอย่างเดียว</option>
            </select>
          </label>
          <div className="row between">
            <span className="dim">รหัสผ่านเก็บเป็น scrypt hash — ฝั่งเซิร์ฟเวอร์มองไม่เห็นค่าจริง</span>
            <button className="btn primary" onClick={add} disabled={!username.trim() || password.length < 8}>
              เพิ่ม
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-pad">
            <h2>ผู้ใช้ทั้งหมด ({users.length})</h2>
          </div>
          {users.length === 0 ? (
            <div className="empty">
              <strong>ยังไม่มีผู้ใช้</strong>
              เพิ่มผู้ใช้คนแรกเพื่อเข้าใช้งาน console
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ผู้ใช้</th>
                  <th>สิทธิ์</th>
                  <th>เข้าใช้ล่าสุด</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {u.username}
                        {me?.id === u.id ? <span className="chip accent" style={{ marginLeft: 6 }}>คุณ</span> : null}
                      </div>
                      <div className="dim" style={{ fontSize: 12 }}>{u.name ?? '—'}</div>
                    </td>
                    <td>
                      <select
                        value={u.role}
                        disabled={u.disabled}
                        onChange={(e) => void patch(u.id, { role: e.target.value }, `เปลี่ยนสิทธิ์ของ ${u.username} แล้ว`)}
                        style={{ width: 'auto' }}
                      >
                        <option value="admin">admin</option>
                        <option value="viewer">viewer</option>
                      </select>
                      {u.disabled ? <span className="chip err" style={{ marginLeft: 6 }}>ปิดใช้งาน</span> : null}
                    </td>
                    <td className="dim">{fmtTime(u.last_login_at)}</td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn ghost" onClick={() => resetPassword(u)}>
                          ตั้งรหัสใหม่
                        </button>
                        <button
                          className="btn ghost"
                          onClick={() => void patch(u.id, { disabled: !u.disabled }, u.disabled ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว')}
                        >
                          {u.disabled ? 'เปิดใช้' : 'ปิดใช้'}
                        </button>
                        <button className="btn ghost" onClick={() => void remove(u)} disabled={me?.id === u.id}>
                          ลบ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
