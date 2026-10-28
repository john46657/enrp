'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BRAND, NAV_SECTIONS } from '@emden/shared';
import { CloseIcon, MenuIcon } from './icons';

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  // Das mobile Menü merkt sich, auf welcher Seite es geöffnet wurde – nach einem Seitenwechsel ist es zu.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenOn(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <div className="topbar">
        <Link href="/" className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__name">{BRAND.name}</span>
        </Link>
        <button
          type="button"
          className="topbar__menu"
          aria-expanded={open}
          aria-controls="main-nav"
          onClick={() => setOpenOn(open ? null : pathname)}
        >
          {open ? <CloseIcon /> : <MenuIcon />}
          <span>{open ? 'Menü schließen' : 'Menü'}</span>
        </button>
      </div>

      <aside className={`sidebar${open ? ' sidebar--open' : ''}`}>
        <Link href="/" className="brand brand--sidebar">
          <span className="brand__mark" aria-hidden="true" />
          <span>
            <span className="brand__name">{BRAND.name}</span>
            <span className="brand__sub">Control Center</span>
          </span>
        </Link>
        <nav id="main-nav" aria-label="Hauptnavigation">
          <ul className="nav">
            {NAV_SECTIONS.map((section) => {
              const active = isActive(pathname, section.href);
              return (
                <li key={section.slug}>
                  <Link
                    href={section.href}
                    className={`nav__link${active ? ' nav__link--active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span>{section.label}</span>
                    {section.available ? null : <span className="nav__planned">Geplant</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <p className="sidebar__note">
          Phase 1 ohne Anmeldung. Nur lokal betreiben, bis die Authentifizierung (Phase 2) aktiv ist.
        </p>
      </aside>
    </>
  );
}
