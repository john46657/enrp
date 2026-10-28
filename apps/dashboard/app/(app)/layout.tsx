import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/EmptyState';
import { Sidebar } from '@/components/Sidebar';
import { getSession } from '@/lib/backend';

/**
 * Alle Seiten in (app) brauchen eine Anmeldung. Die eigentliche Sicherheitsprüfung macht das Backend bei
 * jeder Datenabfrage; diese Prüfung sorgt dafür, dass nicht angemeldete Personen zur Anmeldung geleitet werden.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (session.state === 'unreachable') {
    return (
      <main id="main" className="main main--standalone" tabIndex={-1}>
        <EmptyState title="Backend nicht erreichbar">
          <p>Ohne Backend kann die Anmeldung nicht geprüft werden.</p>
          <p>
            Starte es mit <code>npm run dev:api</code> und lade die Seite neu.
          </p>
        </EmptyState>
      </main>
    );
  }
  if (session.state === 'anonymous') {
    const path = (await headers()).get('x-pathname') ?? '/';
    redirect(path === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(path)}`);
  }

  const { user } = session;
  return (
    <div className="shell">
      <Sidebar
        user={{ displayName: user.displayName, roleName: user.role.name, permissions: user.permissions }}
      />
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
