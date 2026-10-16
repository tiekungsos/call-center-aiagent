import { Shell } from '@/components/Shell';
import { apiGet, SERVER_API } from '@/lib/api';
import { currentUser } from '@/lib/session';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const [health, user] = await Promise.all([
    apiGet<{ ok: boolean; db: boolean }>('/health'),
    currentUser(),
  ]);
  return (
    <Shell
      dbOn={Boolean(health?.db)}
      apiUp={Boolean(health?.ok)}
      apiUrl={SERVER_API}
      user={user ? { username: user.username, role: user.role } : undefined}
    >
      {children}
    </Shell>
  );
}
