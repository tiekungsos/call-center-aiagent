import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'วาที Console',
  description: 'ศูนย์ควบคุมวาที (WATEE) — สาย, แชท, agent, คลังความรู้, analytics',
  // console ภายใน — ไม่ให้ search engine/bot จัดทำดัชนี (เสริม X-Robots-Tag ใน next.config.mjs)
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
