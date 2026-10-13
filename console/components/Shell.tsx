'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TENANT } from '@/lib/api';
import { IconAgent, IconBook, IconCalls, IconInbox, IconPulse, IconSend, IconSliders } from './icons';

const NAV = [
  { href: '/', label: 'ภาพรวม', icon: IconPulse },
  { href: '/calls', label: 'สายและแชท', icon: IconCalls },
  { href: '/tickets', label: 'เรื่องร้องเรียน', icon: IconInbox },
  { href: '/agents', label: 'Agent', icon: IconAgent },
  { href: '/knowledge', label: 'คลังความรู้', icon: IconBook },
  { href: '/campaigns', label: 'โทรออก', icon: IconSend },
  { href: '/settings', label: 'เชื่อมต่อ', icon: IconSliders },
];

export function Shell({
  children,
  dbOn,
  apiUp,
  apiUrl,
}: {
  children: React.ReactNode;
  dbOn: boolean;
  apiUp: boolean;
  apiUrl: string;
}) {
  const path = usePathname();
  const isActive = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            AI
          </span>
          <span>
            <span className="brand-name">AILEO</span>
            <span className="brand-sub" style={{ display: 'block' }}>
              Console
            </span>
          </span>
        </div>

        <nav className="nav" aria-label="เมนูหลัก">
          <span className="nav-label">ปฏิบัติการ</span>
          {NAV.slice(0, 3).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} data-active={isActive(href)}>
              <Icon aria-hidden />
              {label}
            </Link>
          ))}
          <span className="nav-label">ตั้งค่า</span>
          {NAV.slice(3).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} data-active={isActive(href)}>
              <Icon aria-hidden />
              {label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span>
            <span className={`dot ${apiUp ? 'on' : 'off'}`} aria-hidden />
            API {apiUp ? 'ออนไลน์' : 'ออฟไลน์'}
          </span>
          <span>
            <span className={`dot ${dbOn ? 'on' : 'off'}`} aria-hidden />
            ฐานข้อมูล {dbOn ? 'เชื่อมต่อ' : 'ปิด'}
          </span>
          <span className="dim">tenant: {TENANT}</span>
          <span className="dim" style={{ overflowWrap: 'anywhere' }}>
            {apiUrl}
          </span>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
