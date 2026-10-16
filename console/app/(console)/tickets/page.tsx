import { apiGet, fmtTime, TENANT } from '@/lib/api';

interface Ticket {
  id: string;
  call_id: string | null;
  category: string | null;
  summary: string | null;
  contact_name: string | null;
  callback_number: string | null;
  status: string;
  created_at: string;
}

export default async function TicketsPage() {
  const data = await apiGet<{ tickets: Ticket[] }>(`/api/tickets?tenant=${TENANT}&limit=100`);
  const tickets = data?.tickets ?? [];
  const open = tickets.filter((t) => t.status === 'open').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>เรื่องร้องเรียน</h1>
          <p>เรื่องที่ AI เปิดไว้ให้เจ้าหน้าที่ติดต่อกลับ</p>
        </div>
        <span className="dim">
          {tickets.length} เรื่อง · ค้าง {open}
        </span>
      </div>

      <div className="card">
        {tickets.length === 0 ? (
          <div className="empty">
            <strong>ยังไม่มีเรื่องร้องเรียน</strong>
            เมื่อ AI เปิดเรื่องผ่านเครื่องมือ <code className="mono">create_ticket</code> รายการจะมาที่นี่พร้อมเบอร์ติดต่อกลับ
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>เลขเรื่อง</th>
                <th>เปิดเมื่อ</th>
                <th>หมวด</th>
                <th>สรุป</th>
                <th>ผู้ติดต่อ</th>
                <th>เบอร์ติดต่อกลับ</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td className="mono">{t.id}</td>
                  <td className="dim">{fmtTime(t.created_at)}</td>
                  <td>{t.category ?? '—'}</td>
                  <td>{t.summary ?? '—'}</td>
                  <td>{t.contact_name ?? '—'}</td>
                  <td className="mono">{t.callback_number ?? '—'}</td>
                  <td>
                    <span className={`chip ${t.status === 'open' ? 'warn' : 'ok'}`}>
                      {t.status === 'open' ? 'ค้าง' : 'ปิดแล้ว'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
