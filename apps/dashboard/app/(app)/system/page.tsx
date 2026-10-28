import type { Metadata } from 'next';
import type { ReadinessCheckStatus } from '@emden/shared';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { getBackendStatus } from '@/lib/api';
import { formatDateTime, formatUptime } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Systemstatus' };

const CHECK_VIEW: Record<ReadinessCheckStatus, { tone: StatusTone; label: string }> = {
  ok: { tone: 'ok', label: 'In Ordnung' },
  failed: { tone: 'error', label: 'Fehlgeschlagen' },
  not_configured: { tone: 'neutral', label: 'Nicht konfiguriert' },
};

const CHECK_NAMES: Record<string, string> = { database: 'Datenbank (PostgreSQL)' };

export default async function SystemPage() {
  const status = await getBackendStatus();

  return (
    <>
      <PageHeader
        title="Systemstatus"
        intro="Live-Abfrage der Health- und Readiness-Endpunkte des Emden Network Backend."
        aside={
          <p className="muted">
            Stand <time dateTime={status.checkedAt}>{formatDateTime(status.checkedAt)}</time>. Seite neu laden
            für eine neue Abfrage.
          </p>
        }
      />

      {status.state === 'unreachable' || status.state === 'invalid' ? (
        <EmptyState
          title={status.state === 'unreachable' ? 'Backend nicht erreichbar' : 'Unerwartete Antwort'}
        >
          <p>{status.reason}</p>
          <p>
            Starte das Backend lokal mit <code>npm run dev:api</code> und prüfe <code>API_INTERNAL_URL</code>{' '}
            in der <code>.env</code>.
          </p>
        </EmptyState>
      ) : (
        <div className="panels">
          <section className="panel" aria-labelledby="liveness-title">
            <h2 id="liveness-title">Prozess</h2>
            <dl className="facts">
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusBadge tone="ok">Läuft</StatusBadge>
                </dd>
              </div>
              <div>
                <dt>Dienst</dt>
                <dd>{status.health.service}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{status.health.version}</dd>
              </div>
              <div>
                <dt>Laufzeit</dt>
                <dd>{formatUptime(status.health.uptimeSeconds)}</dd>
              </div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="readiness-title">
            <h2 id="readiness-title">Bereitschaft</h2>
            {status.readiness ? (
              <table className="table">
                <caption className="sr-only">Ergebnisse der Bereitschaftsprüfungen</caption>
                <thead>
                  <tr>
                    <th scope="col">Prüfung</th>
                    <th scope="col">Ergebnis</th>
                    <th scope="col">Hinweis</th>
                  </tr>
                </thead>
                <tbody>
                  {status.readiness.checks.map((check) => (
                    <tr key={check.name}>
                      <td>{CHECK_NAMES[check.name] ?? check.name}</td>
                      <td>
                        <StatusBadge tone={CHECK_VIEW[check.status].tone}>
                          {CHECK_VIEW[check.status].label}
                        </StatusBadge>
                      </td>
                      <td className="muted">{check.message ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">/ready hat keine auswertbare Antwort geliefert.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
