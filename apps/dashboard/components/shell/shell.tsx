'use client';

import { LogOut, Menu, Moon, Search, Sun, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { post } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import { useCan, useSession } from '@/lib/session';
import { findNav, NAV } from './nav';

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    try {
      const stored = localStorage.getItem('enrp-theme');
      if (stored === 'light') setTheme('light');
    } catch {
      /* ohne Speicher bleibt Dark Mode */
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('enrp-theme', theme);
    } catch {
      /* ignorieren */
    }
  }, [theme]);
  return [theme, setTheme] as const;
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const can = useCan();
  const active = findNav(pathname)?.item.href;
  return (
    <nav aria-label="Hauptnavigation" className="space-y-5 px-3 py-4">
      {NAV.map((group) => {
        const items = group.items.filter((i) => can(i.permission));
        if (!items.length) return null;
        return (
          <div key={group.label}>
            <p className="px-2 pb-1.5 text-xs text-muted">{group.label}</p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const isActive = item.href === active;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={isActive ? 'page' : undefined}
                      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${isActive ? 'bg-surface-2 text-text shadow-[inset_3px_0_0_var(--signal)]' : 'text-muted hover:bg-surface-2 hover:text-text'}`}
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const me = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [theme, setTheme] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState('');
  const live = useRealtime();
  const nav = findNav(pathname);
  const avatar = me.user.avatarHash
    ? `https://cdn.discordapp.com/avatars/${me.user.id}/${me.user.avatarHash}.png?size=64`
    : null;

  async function logout() {
    await post('/auth/logout').catch(() => undefined);
    router.replace('/login');
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <a
        href="#inhalt"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-signal focus:px-3 focus:py-1 focus:text-signal-ink"
      >
        Zum Inhalt springen
      </a>
      <aside className="sticky top-0 hidden h-screen overflow-y-auto border-r border-line bg-surface lg:block">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <span className="block h-5 w-1.5 rounded-sm bg-signal" aria-hidden />
          <span className="font-condensed text-lg font-semibold">ENRP Verwaltung</span>
        </div>
        <Sidebar />
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            className="absolute inset-0 bg-black/60"
            aria-label="Navigation schließen"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-line bg-surface">
            <div className="flex items-center justify-between px-5 py-4">
              <span className="font-condensed text-lg font-semibold">ENRP Verwaltung</span>
              <button onClick={() => setMenuOpen(false)} aria-label="Navigation schließen">
                <X className="size-5" />
              </button>
            </div>
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur lg:px-8">
          <button className="lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Navigation öffnen">
            <Menu className="size-5" />
          </button>
          <ol className="hidden min-w-0 items-center gap-1.5 text-sm text-muted sm:flex" aria-label="Brotkrümel">
            <li>{nav?.group.label ?? 'Dashboard'}</li>
            {nav && (
              <>
                <li aria-hidden>/</li>
                <li className="truncate text-text">
                  <Link href={nav.item.href}>{nav.item.label}</Link>
                </li>
              </>
            )}
          </ol>
          <form
            role="search"
            className="relative ml-auto w-full max-w-64"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) router.push(`/players?q=${encodeURIComponent(q.trim())}`);
            }}
          >
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Spieler, Roblox- oder Discord-ID"
              aria-label="Spieler suchen"
              className="w-full rounded-md border border-line bg-surface py-1.5 pr-2 pl-8 text-sm placeholder:text-muted focus:border-signal focus:outline-none"
            />
          </form>
          <span className="hidden items-center gap-1.5 text-xs text-muted md:flex" title="Live-Aktualisierung">
            <span
              className={`size-2 rounded-full ${live === 'live' ? 'bg-ok' : live === 'connecting' ? 'bg-warn' : 'bg-bad'}`}
              aria-hidden
            />
            {live === 'live' ? 'Live' : live === 'connecting' ? 'Verbinde …' : 'Offline'}
          </span>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
            className="text-muted hover:text-text"
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <div className="flex items-center gap-2">
            {avatar ? (
              <img src={avatar} alt="" className="size-7 rounded-full" />
            ) : (
              <span className="grid size-7 place-items-center rounded-full bg-surface-2 text-xs">
                {me.user.username.slice(0, 2)}
              </span>
            )}
            <div className="hidden text-sm leading-tight xl:block">
              <p>{me.user.globalName ?? me.user.username}</p>
              <p className="text-xs text-muted">{me.isOwner ? 'Owner' : (me.roles[0]?.name ?? 'Team')}</p>
            </div>
            <button onClick={logout} aria-label="Abmelden" className="text-muted hover:text-text">
              <LogOut className="size-4" />
            </button>
          </div>
        </header>
        <main id="inhalt" className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
