import type { Metadata } from 'next';
import { Shell } from '@/components/Shell';
import { apiGet, SERVER_API } from '@/lib/api';
import './globals.css';

export const metadata: Metadata = {
  title: 'AILEO Console',
  description: 'ศูนย์ควบคุม AI คอลเซ็นเตอร์ — สาย, แชท, agent, คลังความรู้, analytics',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const health = await apiGet<{ ok: boolean; db: boolean }>('/health');
  return (
    <html lang="th">
      <body>
        <Shell dbOn={Boolean(health?.db)} apiUp={Boolean(health?.ok)} apiUrl={SERVER_API}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
