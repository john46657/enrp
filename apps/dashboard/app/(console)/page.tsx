'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get } from '@/lib/api';
import { fmtRelative, statusLabel } from '@/lib/format';
import { ErrorState, Panel, PageHeader, Skeleton } from '@/components/ui/primitives';

interface Overview {
  health: {
    status: string;
    dependencies: Array<{ name: string; status: string; latencyMs: number | null }>;
    services: Array<{ service: string; status: string; ageSeconds: number | null; version: string | null }> | null;
    roblox: { connected: boolean; servers: number; playersOnline: number; lastHeartbeatAt: string | null } | null;
  };
  openTickets: number;
  openReports: number;
  openCases: number;
  openIncidents: number;
  pendingApprovals: number;
  alerts: Array<{ severity: string; code: string; message: string }>;
  api: {
    latencyMs: { p50: number | null; p95: number | null };
    last5Minutes: { requests: number; errorRate: number | null };
  };
}

const LIGHT: Record<string, string> = {
  up: 'var(--ok)',
  configured: 'var(--ok)',
  degraded: 'var(--warn)',
  down: 'var(--bad)',
  not_configured: 'var(--line-strong)',
  unknown: 'var(--line-strong)',
};

/** Lagebild: eine Leuchtleiste mit dem Zustand aller Systeme – das einzige auffällige Element der Seite. */
function LightBar({ data }: { data: Overview }) {
  const segments = [
    {
      label: 'Roblox',
      status: data.health.roblox?.connected ? 'up' : data.health.roblox?.lastHeartbeatAt ? 'down' : 'not_configured',
      detail: data.health.roblox?.connected
        ? `${data.health.roblox.servers} Server`
        : data.health.roblox?.lastHeartbeatAt
          ? `zuletzt ${fmtRelative(data.health.roblox.lastHeartbeatAt)}`
          : 'Noch kein Heartbeat empfangen',
    },
    ...(data.health.services ?? []).map((s) => ({
      label: s.service === 'api' ? 'Backend' : s.service === 'bot' ? 'Discord-Bot' : 'Worker',
      status: s.status,
      detail: s.ageSeconds !== null ? `Lebenszeichen vor ${s.ageSeconds} s` : statusLabel(s.status),
    })),
    ...data.health.dependencies
      .filter((d) => d.name === 'postgres' || d.name === 'redis')
      .map((d) => ({
        label: d.name === 'postgres' ? 'Datenbank' : 'Redis',
        status: d.status,
        detail: d.latencyMs !== null ? `${d.latencyMs} ms` : statusLabel(d.status),
      })),
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {segments.map((s) => (
          <div key={s.label} className="relative border-line px-4 pt-4 pb-3 not-last:border-r max-lg:border-b">
            <span
              className={`absolute inset-x-0 top-0 h-1.5 ${s.status === 'down' ? 'light-on' : ''}`}
              style={{ background: LIGHT[s.status] ?? 'var(--line-strong)' }}
              aria-hidden
            />
            <p className="text-sm text-muted">{s.label}</p>
            <p className="font-condensed text-lg font-semibold">{statusLabel(s.status)}</p>
            <p className="text-xs text-muted">{s.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Figure({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const body = (
    <>
      <p className="tabular text-3xl font-semibold">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-md px-3 py-2 hover:bg-surface-2">
      {body}
    </Link>
  ) : (
    <div className="px-3 py-2">{body}</div>
  );
}

export default function OverviewPage() {
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: () => get<Overview>('/overview'),
    refetchInterval: 60_000,
  });
  const factions = useQuery({
    queryKey: ['factions-stats', 'week'],
    queryFn: () =>
      get<{ items: Array<{ factionId: string; members: number; dutySeconds: number; onDuty: number }> }>(
        '/factions/stats',
        { period: 'week' },
      ),
  });
  const factionNames = useQuery({
    queryKey: ['factions'],
    queryFn: () => get<{ items: Array<{ id: string; name: string; key: string; hasDuty: boolean }> }>('/factions'),
  });
  const audit = useQuery({
    queryKey: ['list', '/audit', 'recent'],
    queryFn: () =>
      get<{
        items: Array<{ id: number; action: string; actorId: string | null; occurredAt: string; resourceType: string }>;
      }>('/audit', { pageSize: 8 }),
  });

  if (overview.isLoading) return <Skeleton rows={8} />;
  if (overview.error) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;
  const data = overview.data!;
  const chart = (factions.data?.items ?? [])
    .map((f) => ({ ...f, faction: factionNames.data?.items.find((n) => n.id === f.factionId) }))
    .filter((f) => f.faction?.hasDuty)
    .map((f) => ({
      name: f.faction!.name,
      stunden: Math.round(f.dutySeconds / 360) / 10,
      imDienst: f.onDuty,
      key: f.faction!.key,
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lagebild"
        description="Zustand von Spiel, Bot und Plattform. Angezeigt werden nur tatsächlich gemessene Werte."
      />
      <LightBar data={data} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Offene Arbeit" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Figure
              label="Spieler online"
              value={data.health.roblox?.connected ? data.health.roblox.playersOnline : '–'}
              href="/ops/roblox"
            />
            <Figure label="Offene Tickets" value={data.openTickets} href="/tickets" />
            <Figure label="Offene Reports" value={data.openReports} href="/reports" />
            <Figure label="Offene Vorfälle" value={data.openIncidents} href="/ops/incidents" />
            <Figure label="Ausstehende Freigaben" value={data.pendingApprovals} href="/security/approvals" />
            <Figure label="Offene Fallberichte" value={data.openCases} href="/cases" />
          </div>
          <div className="mt-4 border-t border-line pt-3 text-sm text-muted">
            API-Latenz p50 {data.api.latencyMs.p50 ?? '–'} ms, p95 {data.api.latencyMs.p95 ?? '–'} ms. Fehlerquote der
            letzten 5 Minuten:{' '}
            {data.api.last5Minutes.errorRate === null
              ? 'noch keine Anfragen'
              : `${data.api.last5Minutes.errorRate} % bei ${data.api.last5Minutes.requests} Anfragen`}
            .
          </div>
        </Panel>

        <Panel title="Warnungen">
          {data.alerts.length ? (
            <ul className="space-y-2 text-sm">
              {data.alerts.map((a) => (
                <li key={a.code} className="flex gap-2">
                  <span
                    className="mt-1.5 size-2 shrink-0 rounded-full"
                    style={{
                      background:
                        a.severity === 'critical'
                          ? 'var(--bad)'
                          : a.severity === 'warning'
                            ? 'var(--warn)'
                            : 'var(--info)',
                    }}
                    aria-hidden
                  />
                  <span>{a.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Keine aktiven Warnungen.</p>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Dienstzeit der letzten 7 Tage">
          {chart.length && chart.some((c) => c.stunden > 0) ? (
            <div
              className="h-56"
              role="img"
              aria-label={`Dienststunden: ${chart.map((c) => `${c.name} ${c.stunden} h`).join(', ')}`}
            >
              <ResponsiveContainer>
                <BarChart data={chart} margin={{ left: -16 }}>
                  <XAxis dataKey="name" stroke="var(--muted)" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis stroke="var(--muted)" tickLine={false} axisLine={false} fontSize={12} unit=" h" />
                  <Tooltip
                    cursor={{ fill: 'var(--surface-2)' }}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6 }}
                    formatter={(v: number) => [`${v} h`, 'Dienstzeit']}
                  />
                  <Bar dataKey="stunden" radius={[3, 3, 0, 0]} fill="var(--polizei)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted">
              Noch keine Dienstzeiten erfasst. Werte erscheinen, sobald ein Roblox-Server Dienstbeginn und -ende meldet.
            </p>
          )}
          {chart.length > 0 && (
            <p className="mt-2 text-sm text-muted">
              Aktuell im Dienst: {chart.map((c) => `${c.name} ${c.imDienst}`).join(', ')}
            </p>
          )}
        </Panel>

        <Panel
          title="Letzte Verwaltungsaktionen"
          actions={
            <Link href="/security/audit" className="text-sm text-muted hover:text-text">
              Audit-Log öffnen
            </Link>
          }
        >
          {audit.data?.items.length ? (
            <ul className="divide-y divide-line text-sm">
              {audit.data.items.map((e) => (
                <li key={e.id} className="flex justify-between gap-3 py-1.5">
                  <span className="truncate">{e.action}</span>
                  <span className="shrink-0 text-muted">{fmtRelative(e.occurredAt)}</span>
                </li>
              ))}
            </ul>
          ) : audit.error ? (
            <p className="text-sm text-muted">Für das Audit-Log fehlt dir die Berechtigung.</p>
          ) : (
            <p className="text-sm text-muted">Noch keine Einträge.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
