import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auditLogResponseSchema, type AuditEntry } from '@emden/shared';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { callBackend, getSession, hasPermission } from '@/lib/backend';
import { formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Audit-Log' };

const OUTCOME: Record<AuditEntry['outcome'], { tone: StatusTone; label: string }> = {
  success: { tone: 'ok', label: 'Erfolgreich' },
  denied: { tone: 'warn', label: 'Abgelehnt' },
  failure: { tone: 'error', label: 'Fehlgeschlagen' },
};

const ACTOR_TYPE: Record<AuditEntry['actorType'], string> = {
  user: '',
  system: 'System',
  cli: 'Terminal',
};

// Lesbare Bezeichnungen für die technischen Felder im Audit-Log (unbekannte Felder bleiben, wie sie sind).
const DETAIL_LABELS: Record<string, string> = {
  roleFrom: 'Rolle vorher',
  roleTo: 'Rolle nachher',
  statusFrom: 'Status vorher',
  statusTo: 'Status nachher',
  displayName: 'Name',
  discordUserId: 'Discord-ID',
  role: 'Rolle',
  added: 'Hinzugefügt',
  removed: 'Entfernt',
  reason: 'Grund',
  result: 'Ergebnis',
  source: 'Quelle',
};
const VALUE_LABELS: Record<string, string> = {
  active: 'aktiv',
  disabled: 'gesperrt',
  created: 'angelegt',
  promoted: 'befördert',
  not_registered: 'nicht freigeschaltet',
  RANK_TOO_HIGH: 'Rolle zu hoch',
  SELF_CHANGE: 'eigenes Konto',
  OWNER_ONLY_BOOTSTRAP: 'Owner nur per Ersteinrichtung',
  OWNER_ROLE_FIXED: 'Owner-Rolle unveränderlich',
  PERMISSION_NOT_HELD: 'Berechtigung nicht vorhanden',
};
const TARGET_LABELS: Record<string, string> = {
  user: 'Benutzer',
  role: 'Rolle',
  discord_user: 'Discord-Konto',
};

function Details({ details }: { details: AuditEntry['details'] }) {
  const entries = Object.entries(details).filter(([, value]) => value !== '' && value !== null);
  if (entries.length === 0) return <span className="muted">–</span>;
  return (
    <dl className="details">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{DETAIL_LABELS[key] ?? key}</dt>
          <dd>{VALUE_LABELS[String(value)] ?? String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AuditLogPage({ searchParams }: Props) {
  const session = await getSession();
  if (session.state !== 'authenticated') redirect('/login?info=expired');
  if (!hasPermission(session.user, 'audit.read')) {
    return (
      <>
        <PageHeader title="Audit-Log" />
        <EmptyState title="Keine Berechtigung">
          <p>Für diesen Bereich brauchst du die Berechtigung „Audit-Log ansehen“.</p>
        </EmptyState>
      </>
    );
  }

  const before = (await searchParams).before;
  const beforeId = typeof before === 'string' && /^[0-9]{1,15}$/.test(before) ? before : undefined;
  const result = await callBackend(
    `/audit-log?limit=50${beforeId ? `&before=${beforeId}` : ''}`,
    auditLogResponseSchema,
  );
  if (!result.ok) {
    if (result.status === 401) redirect('/login?info=expired');
    throw new Error(result.message);
  }
  const { entries, nextBefore } = result.data;

  return (
    <>
      <PageHeader
        title="Audit-Log"
        intro="Wer hat wann was getan? Einträge lassen sich nicht nachträglich ändern und werden nach der Aufbewahrungsfrist automatisch gelöscht."
      />
      {entries.length === 0 ? (
        <EmptyState title="Noch keine Einträge">
          <p>Sobald sich jemand anmeldet oder etwas verwaltet, erscheint es hier.</p>
        </EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">Audit-Log, neueste Einträge zuerst</caption>
            <thead>
              <tr>
                <th scope="col">Zeitpunkt</th>
                <th scope="col">Wer</th>
                <th scope="col">Aktion</th>
                <th scope="col">Ergebnis</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="muted">
                    <time dateTime={entry.occurredAt}>{formatDateTime(entry.occurredAt)}</time>
                  </td>
                  <td>
                    <span className="cell__primary">{entry.actorLabel}</span>
                    {ACTOR_TYPE[entry.actorType] ? (
                      <span className="cell__secondary">{ACTOR_TYPE[entry.actorType]}</span>
                    ) : null}
                  </td>
                  <td>
                    <span className="cell__primary">{entry.actionLabel}</span>
                    {entry.targetType ? (
                      <span className="cell__secondary">
                        {TARGET_LABELS[entry.targetType] ?? entry.targetType} {entry.targetId}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <StatusBadge tone={OUTCOME[entry.outcome].tone}>
                      {OUTCOME[entry.outcome].label}
                    </StatusBadge>
                  </td>
                  <td>
                    <Details details={entry.details} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className="pager" aria-label="Seiten des Audit-Logs">
        {beforeId ? <Link href="/audit-log">Neueste Einträge</Link> : null}
        {nextBefore ? <Link href={`/audit-log?before=${nextBefore}`}>Ältere Einträge</Link> : null}
      </nav>
    </>
  );
}
