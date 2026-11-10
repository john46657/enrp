import { formatDuration } from '@enrp/shared';

const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
const relative = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });

export const fmtDateTime = (v: string | null | undefined) => (v ? dateTime.format(new Date(v)) : '–');
export const fmtDate = (v: string | null | undefined) => (v ? dateOnly.format(new Date(v)) : '–');
export const fmtDuration = (s: number | null | undefined) => (s === null || s === undefined ? '–' : formatDuration(s));
export const fmtNumber = (n: number | null | undefined) =>
  n === null || n === undefined ? '–' : n.toLocaleString('de-DE');

export function fmtRelative(v: string | null | undefined) {
  if (!v) return '–';
  const diff = (new Date(v).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return relative.format(Math.round(diff), 'second');
  if (abs < 3600) return relative.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(diff / 3600), 'hour');
  return relative.format(Math.round(diff / 86400), 'day');
}

export const FACTION_COLORS: Record<string, string> = {
  polizei: 'var(--polizei)',
  feuerwehr: 'var(--feuerwehr)',
  rettungsdienst: 'var(--rettungsdienst)',
  zivil: 'var(--zivil)',
};

/** Deutsche Bezeichnungen für Statuswerte. */
export const STATUS_LABELS: Record<string, string> = {
  open: 'Offen',
  claimed: 'In Bearbeitung',
  waiting: 'Wartet',
  closed: 'Geschlossen',
  in_review: 'In Prüfung',
  resolved: 'Erledigt',
  rejected: 'Abgelehnt',
  active: 'Aktiv',
  completed: 'Abgeschlossen',
  auto_closed: 'Automatisch beendet',
  invalidated: 'Ungültig',
  expired: 'Abgelaufen',
  revoked: 'Aufgehoben',
  pending_execution: 'Wartet auf Ausführung',
  failed: 'Fehlgeschlagen',
  accepted: 'Angenommen',
  pending: 'Ausstehend',
  approved: 'Genehmigt',
  executed: 'Ausgeführt',
  cancelled: 'Abgebrochen',
  prepared: 'Vorbereitet',
  deploying: 'Wird ausgerollt',
  deployed: 'Ausgerollt',
  rolled_back: 'Zurückgerollt',
  running: 'Läuft',
  verifying: 'Wird geprüft',
  succeeded: 'Erfolgreich',
  draft: 'Entwurf',
  scheduled: 'Geplant',
  published: 'Veröffentlicht',
  under_review: 'In Prüfung',
  implemented: 'Umgesetzt',
  drawn: 'Ausgelost',
  disabled: 'Deaktiviert',
  maintenance: 'Wartung',
  retired: 'Ausgemustert',
  investigating: 'Untersuchung',
  monitoring: 'Beobachtung',
  online: 'Online',
  offline: 'Offline',
  delivered: 'Zugestellt',
  planned: 'Geplant',
  public: 'Öffentlich',
  private: 'Privat',
  reserved: 'Reserviert',
  awaiting_approval: 'Wartet auf Freigabe',
  processing: 'In Bearbeitung',
  manual_required: 'Manuell erforderlich',
  up: 'Betriebsbereit',
  down: 'Ausgefallen',
  degraded: 'Eingeschränkt',
  unknown: 'Noch nicht gemeldet',
  not_configured: 'Nicht verbunden',
  configured: 'Konfiguriert',
  ended: 'Beendet',
};
export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;
