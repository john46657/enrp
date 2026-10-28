import type { Permission } from './permissions.js';

/**
 * Navigationsbereiche des Emden Network Control Center.
 * `phase` gibt an, in welcher Implementierungsphase der Bereich umgesetzt wird.
 * `available: false` bedeutet: Der Bereich ist geplant und zeigt keine (erfundenen) Daten.
 * `permission`: Der Bereich erscheint nur für Personen mit dieser Berechtigung (Prüfung zusätzlich im Backend).
 */
export interface NavSection {
  slug: string;
  href: string;
  label: string;
  description: string;
  phase: number;
  available: boolean;
  permission?: Permission;
}

export const NAV_SECTIONS = [
  {
    slug: 'overview',
    href: '/',
    label: 'Übersicht',
    description: 'Gesamtzustand der Plattform auf einen Blick.',
    phase: 1,
    available: true,
  },
  {
    slug: 'servers',
    href: '/servers',
    label: 'Roblox-Server',
    description: 'Serverinstanzen, Heartbeats sowie Online-/Offline-Erkennung.',
    phase: 3,
    available: false,
  },
  {
    slug: 'players',
    href: '/players',
    label: 'Spieler',
    description: 'Vom Spiel gemeldete Spieler (Roblox-User-ID, optional Anzeigename).',
    phase: 3,
    available: false,
  },
  {
    slug: 'factions',
    href: '/factions',
    label: 'Fraktionen',
    description: 'Konfigurierbare Fraktionen wie Polizei, Feuerwehr, Rettungsdienst und Zivilisten.',
    phase: 3,
    available: false,
  },
  {
    slug: 'game-logs',
    href: '/game-logs',
    label: 'Spielprotokolle',
    description: 'Vom Spiel gemeldete Ereignisse und Vorfälle.',
    phase: 3,
    available: false,
  },
  {
    slug: 'moderation',
    href: '/moderation',
    label: 'Moderation',
    description: 'Moderationsaktionen mit Begründung, Status und Audit-Verweis.',
    phase: 3,
    available: false,
  },
  {
    slug: 'discord-security',
    href: '/discord-security',
    label: 'Discord Security',
    description: 'Anti-Spam, Raid-Erkennung, Lockdown und Sicherheitsvorfälle.',
    phase: 5,
    available: false,
  },
  {
    slug: 'tiktok-live',
    href: '/tiktok-live',
    label: 'TikTok LIVE',
    description: 'Creator, LIVE-Benachrichtigungen und manuelle Ankündigungen.',
    phase: 6,
    available: false,
  },
  {
    slug: 'notifications',
    href: '/notifications',
    label: 'Benachrichtigungen',
    description: 'Zielkanäle und Zustellstatus von Benachrichtigungen.',
    phase: 4,
    available: false,
  },
  {
    slug: 'audit-log',
    href: '/audit-log',
    label: 'Audit-Log',
    description: 'Nachvollziehbare Protokollierung kritischer Aktionen.',
    phase: 2,
    available: true,
    permission: 'audit.read',
  },
  {
    slug: 'users',
    href: '/users',
    label: 'Benutzer und Rollen',
    description: 'Freigeschaltete Personen, ihre Rollen (Owner bis Viewer) und Berechtigungen.',
    phase: 2,
    available: true,
    permission: 'users.read',
  },
  {
    slug: 'settings',
    href: '/settings',
    label: 'Einstellungen',
    description: 'Discord-Kanäle, Discord-Rollen und weitere Einstellungen der Plattform.',
    phase: 4,
    available: false,
  },
  {
    slug: 'system',
    href: '/system',
    label: 'Systemstatus',
    description: 'Health- und Readiness-Status des Emden Network Backend.',
    phase: 1,
    available: true,
  },
] as const satisfies readonly NavSection[];

export type NavSlug = (typeof NAV_SECTIONS)[number]['slug'];

export function findNavSection(slug: string): NavSection | undefined {
  return NAV_SECTIONS.find((section) => section.slug === slug);
}

/** Bis einschließlich dieser Phase ist alles umgesetzt und getestet. */
export const COMPLETED_PHASE = 2;

/** Implementierungsphasen laut Projektplan. */
export const PHASES = {
  1: 'Grundgerüst',
  2: 'Datenbank und Authentifizierung',
  3: 'Roblox-Integration',
  4: 'Discord-Bot',
  5: 'Discord Security Center',
  6: 'TikTok LIVE',
  7: 'Betrieb und Veröffentlichung',
} as const satisfies Record<number, string>;

export function phaseLabel(phase: number): string {
  return PHASES[phase as keyof typeof PHASES] ?? `Phase ${phase}`;
}
