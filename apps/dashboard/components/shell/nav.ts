import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Bell,
  Bot,
  Car,
  ClipboardList,
  Cog,
  DatabaseBackup,
  FileClock,
  FileSearch,
  Flag,
  Gavel,
  Gift,
  Home,
  KeyRound,
  LifeBuoy,
  ListChecks,
  Lock,
  Megaphone,
  MessageSquare,
  Rocket,
  ScrollText,
  Server,
  Shield,
  ShieldCheck,
  Siren,
  Ticket,
  Trophy,
  UserCheck,
  Users,
  Vote,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Eine Berechtigung oder mehrere (eine davon genügt). */
  permission?: string | string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Navigation; Einträge ohne Berechtigung werden ausgeblendet (die API prüft unabhängig davon). */
export const NAV: NavGroup[] = [
  { label: 'Übersicht', items: [{ href: '/', label: 'Lagebild', icon: Home, permission: 'monitoring:view' }] },
  {
    label: 'Spieler & Community',
    items: [
      { href: '/players', label: 'Spieler', icon: Users, permission: 'players:view' },
      { href: '/verification', label: 'Verifizierung', icon: UserCheck, permission: 'verification:view' },
      { href: '/factions', label: 'Fraktionen', icon: Shield, permission: 'factions:view' },
      { href: '/duty', label: 'Dienstsystem', icon: Siren, permission: 'duty:view' },
      { href: '/vehicles', label: 'Fahrzeuge', icon: Car, permission: 'vehicles:view' },
      { href: '/leaderboards', label: 'Ranglisten', icon: Trophy },
      { href: '/tickets', label: 'Tickets', icon: Ticket },
      { href: '/reports', label: 'Reports', icon: Flag, permission: 'reports:view' },
      { href: '/cases', label: 'Fallberichte', icon: FileSearch, permission: 'cases:view' },
    ],
  },
  {
    label: 'Moderation',
    items: [
      { href: '/moderation', label: 'Moderationsaktionen', icon: Gavel, permission: 'moderation:view' },
      { href: '/moderation/appeals', label: 'Einsprüche', icon: Vote, permission: 'appeals:view' },
    ],
  },
  {
    label: 'Bot-Verwaltung',
    items: [
      { href: '/bot/commands', label: 'Befehle & Overrides', icon: Bot, permission: 'permissions:view' },
      { href: '/bot/permissions', label: 'Rollen & Rechte', icon: KeyRound, permission: 'permissions:view' },
      { href: '/bot/settings', label: 'Konfiguration', icon: Cog, permission: 'settings:view' },
      { href: '/bot/flags', label: 'Feature-Flags & Kill-Switch', icon: ListChecks, permission: 'feature_flags:view' },
    ],
  },
  {
    label: 'Technik & Betrieb',
    items: [
      { href: '/ops/health', label: 'Gesundheit', icon: Activity, permission: 'monitoring:view' },
      {
        href: '/ops/roblox',
        label: 'Roblox-Server',
        icon: Server,
        permission: ['monitoring:view', 'roblox_servers:view'],
      },
      { href: '/ops/jobs', label: 'Warteschlangen & Jobs', icon: ClipboardList, permission: 'jobs:view' },
      { href: '/ops/incidents', label: 'Vorfälle', icon: AlertTriangle, permission: 'incidents:view' },
      { href: '/ops/backups', label: 'Backups', icon: DatabaseBackup, permission: 'backups:view' },
      { href: '/ops/releases', label: 'Releases & Umgebungen', icon: Rocket, permission: 'releases:view' },
      { href: '/ops/automations', label: 'Automatisierungen', icon: Wrench, permission: 'automations:view' },
    ],
  },
  {
    label: 'Sicherheit & Kontrolle',
    items: [
      { href: '/security/audit', label: 'Audit-Log', icon: ScrollText, permission: 'audit:view' },
      { href: '/security/approvals', label: 'Freigabezentrum', icon: ShieldCheck, permission: 'approvals:view' },
      { href: '/security/events', label: 'Sicherheitsereignisse', icon: Lock, permission: 'security:view' },
      { href: '/security/privacy', label: 'Datenschutz', icon: BadgeCheck, permission: 'privacy:view' },
      {
        href: '/security/config-history',
        label: 'Konfigurationshistorie',
        icon: FileClock,
        permission: 'settings:view',
      },
    ],
  },
  {
    label: 'Community-Tools',
    items: [
      {
        href: '/community/announcements',
        label: 'Ankündigungen & Changelog',
        icon: Megaphone,
        permission: 'announcements:view',
      },
      { href: '/community/polls', label: 'Umfragen', icon: Vote, permission: 'community:view' },
      { href: '/community/suggestions', label: 'Vorschläge', icon: MessageSquare, permission: 'community:view' },
      { href: '/community/giveaways', label: 'Giveaways', icon: Gift, permission: 'community:view' },
      { href: '/community/codes', label: 'Codes & Rewards', icon: KeyRound, permission: 'codes:view' },
      { href: '/community/rules', label: 'Regelwerk', icon: ScrollText, permission: 'rules:view' },
      { href: '/community/maintenance', label: 'Wartung', icon: Bell, permission: 'announcements:view' },
      { href: '/community/welcome', label: 'Begrüßung', icon: LifeBuoy, permission: 'settings:view' },
    ],
  },
];

export function findNav(pathname: string): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of NAV) {
    for (const item of group.items) {
      const match =
        item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (match && (!best || item.href.length > best.item.href.length)) best = { group, item };
    }
  }
  return best;
}
