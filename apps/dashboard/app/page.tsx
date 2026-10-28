import Link from 'next/link';
import { NAV_SECTIONS, PHASES } from '@emden/shared';
import { PageHeader } from '@/components/PageHeader';
import { SignalLight } from '@/components/SignalLight';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { getBackendStatus, type BackendStatus } from '@/lib/api';
import { formatDateTime, formatUptime } from '@/lib/format';

export const dynamic = 'force-dynamic';

function describe(status: BackendStatus): { tone: StatusTone; headline: string; detail: string } {
  switch (status.state) {
    case 'online':
      return {
        tone: 'ok',
        headline: 'Backend erreichbar',
        detail: `Läuft seit ${formatUptime(status.health.uptimeSeconds)}, Version ${status.health.version}.`,
      };
    case 'degraded':
      return {
        tone: 'warn',
        headline: 'Backend erreichbar, aber nicht bereit',
        detail: 'Mindestens eine Bereitschaftsprüfung ist fehlgeschlagen. Details unter Systemstatus.',
      };
    case 'unreachable':
      return { tone: 'error', headline: 'Backend nicht erreichbar', detail: status.reason };
    case 'invalid':
      return { tone: 'error', headline: 'Backend antwortet unerwartet', detail: status.reason };
  }
}

export default async function OverviewPage() {
  const status = await getBackendStatus();
  const view = describe(status);
  const phases = Object.entries(PHASES).map(([phase, name]) => ({
    phase: Number(phase),
    name,
    sections: NAV_SECTIONS.filter((s) => s.phase === Number(phase) && s.slug !== 'overview'),
  }));

  return (
    <>
      <PageHeader
        title="Übersicht"
        intro="Zustand der Plattform. Es werden nur Daten angezeigt, die das Backend tatsächlich liefert."
      />

      <section className="beacon" aria-labelledby="beacon-title">
        <SignalLight tone={view.tone} />
        <div className="beacon__text">
          <h2 id="beacon-title">{view.headline}</h2>
          <p>{view.detail}</p>
          <p className="beacon__meta">
            Geprüft am <time dateTime={status.checkedAt}>{formatDateTime(status.checkedAt)}</time>.{' '}
            <Link href="/system">Details im Systemstatus</Link>
          </p>
        </div>
      </section>

      <section className="roadmap" aria-labelledby="roadmap-title">
        <h2 id="roadmap-title">Ausbaustand</h2>
        <p className="roadmap__intro">
          Bereiche werden phasenweise freigeschaltet. Geplante Bereiche zeigen keine Daten, bis ihre Phase
          umgesetzt und getestet ist.
        </p>
        <ol className="roadmap__list">
          {phases.map(({ phase, name, sections }) => (
            <li key={phase} className={`roadmap__phase${phase === 1 ? ' roadmap__phase--done' : ''}`}>
              <div className="roadmap__head">
                <span className="roadmap__num">Phase {phase}</span>
                <span className="roadmap__name">{name}</span>
                {phase === 1 ? (
                  <StatusBadge tone="ok">Umgesetzt</StatusBadge>
                ) : (
                  <StatusBadge tone="planned">Geplant</StatusBadge>
                )}
              </div>
              {sections.length > 0 ? (
                <ul className="roadmap__sections">
                  {sections.map((s) => (
                    <li key={s.slug}>
                      <Link href={s.href}>{s.label}</Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
