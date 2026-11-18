'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { ApiError, get, setCsrfToken } from './api';

export interface Me {
  user: { id: string; username: string; globalName: string | null; avatarHash: string | null };
  isOwner: boolean;
  roles: Array<{ key: string; name: string }>;
  permissions: string[];
  scopedGrants: Array<{ permission: string; factionIds: string[] }>;
  csrfToken: string | null;
  sessionExpiresAt: string | null;
}

const SessionContext = createContext<Me | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => get<Me>('/auth/me'),
    retry: false,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  useEffect(() => {
    if (me.data) setCsrfToken(me.data.csrfToken);
  }, [me.data]);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401)
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
  }, [me.error, pathname, router]);

  if (me.isLoading) {
    return (
      <div className="grid min-h-screen place-items-center text-muted" role="status">
        Sitzung wird geprüft …
      </div>
    );
  }
  if (me.error) {
    const e = me.error as ApiError;
    if (e.status === 401) return null;
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <h1 className="text-xl">Dashboard nicht erreichbar</h1>
          <p className="mt-2 text-muted">{e.message}</p>
          <button className="mt-4 rounded-md border border-line px-3 py-1.5" onClick={() => me.refetch()}>
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  }
  return <SessionContext.Provider value={me.data!}>{children}</SessionContext.Provider>;
}

export function useSession(): Me {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession außerhalb des SessionProvider');
  return ctx;
}

/** Nur zur Darstellung – jede Aktion wird zusätzlich serverseitig geprüft. */
export function useCan() {
  const me = useSession();
  return (permission: string | null | undefined) => {
    if (!permission) return true;
    if (me.isOwner || me.permissions.includes(permission)) return true;
    return me.scopedGrants.some((g) => g.permission === permission || g.permission === `${permission.split(':')[0]}:*`);
  };
}
