'use client';

import { useQuery } from '@tanstack/react-query';
import { ErrorState, KeyValues, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { get } from '@/lib/api';
import { fmtRelative } from '@/lib/format';

interface Health {
  status: string;
  dependencies: Array<{ name: string; status: string; latencyMs: number | null; error: string | null }>;
  services: Array<{
    service: string;
    status: string;
    lastSeenAt: string | null;
    ageSeconds: number | null;
    version: string | null;
    instances: number;
  }> | null;
  version: string;
}
interface Metrics {
  api: {
    uptimeSeconds: number;
    requestsTotal: number;
    errors5xx: number;
    errors4xx: number;
    latencyMs: { p50: number | null; p95: number | null; p99: number | null; samples: number };
    last5Minutes: { requests: number; errors5xx: number; errorRate: number | null };
    memoryMb: number;
    topRoutes: Array<{ route: string; count: number; errors: number; avgMs: number }>;
  };
}

const NAMES: Record<string, string> = {
  postgres: 'PostgreSQL',
  redis: 'Redis',
  discord_api: 'Discord-API (Bot-Token)',
  discord_oauth: 'Discord-OAuth',
  roblox_oauth: 'Roblox-OAuth',
  api: 'Backend-API',
  bot: 'Discord-Bot',
  worker: 'Worker',
};

export default function HealthPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => get<Health>('/monitoring/health'),
    refetchInterval: 30_000,
  });
  const metrics = useQuery({
    queryKey: ['metrics'],
    queryFn: () => get<Metrics>('/monitoring/metrics'),
    refetchInterval: 30_000,
  });
  if (health.isLoading) return <Skeleton rows={8} />;
  if (health.error) return <ErrorState error={health.error} />;
  const h = health.data!;
  const m = metrics.data?.api;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Gesundheit"
        description={`Gesamtstatus: ${h.status === 'up' ? 'betriebsbereit' : h.status === 'degraded' ? 'eingeschränkt' : 'gestört'}. Version ${h.version}. Aktualisiert alle 30 Sekunden.`}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Dienste">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {h.services?.map((s) => (
                <tr key={s.service}>
                  <td className="py-2">{NAMES[s.service]}</td>
                  <td className="py-2">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="py-2 text-muted">
                    {s.lastSeenAt ? `Lebenszeichen ${fmtRelative(s.lastSeenAt)}` : 'nie gemeldet'}
                  </td>
                  <td className="py-2 text-muted">{s.version ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Abhängigkeiten">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {h.dependencies.map((d) => (
                <tr key={d.name}>
                  <td className="py-2">{NAMES[d.name] ?? d.name}</td>
                  <td className="py-2">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="tabular py-2 text-muted">{d.latencyMs !== null ? `${d.latencyMs} ms` : ''}</td>
                  <td className="py-2 text-bad">{d.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="API-Messwerte (diese Instanz)">
          {m ? (
            <KeyValues
              items={[
                ['Laufzeit', `${Math.round(m.uptimeSeconds / 60)} Minuten`],
                ['Anfragen', m.requestsTotal.toLocaleString('de-DE')],
                ['Fehler 5xx / 4xx', `${m.errors5xx} / ${m.errors4xx}`],
                [
                  'Latenz p50 / p95 / p99',
                  `${m.latencyMs.p50 ?? '–'} / ${m.latencyMs.p95 ?? '–'} / ${m.latencyMs.p99 ?? '–'} ms (${m.latencyMs.samples} Messungen)`,
                ],
                [
                  'Fehlerquote 5 Min.',
                  m.last5Minutes.errorRate === null ? 'keine Anfragen' : `${m.last5Minutes.errorRate} %`,
                ],
                ['Arbeitsspeicher', `${m.memoryMb} MB`],
              ]}
            />
          ) : (
            <Skeleton rows={3} />
          )}
        </Panel>
        <Panel title="Häufigste Endpunkte">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {m?.topRoutes.map((r) => (
                <tr key={r.route}>
                  <td className="py-1.5 break-all">{r.route}</td>
                  <td className="tabular py-1.5 text-right">{r.count}</td>
                  <td className="tabular py-1.5 text-right text-muted">{r.avgMs} ms</td>
                  <td className="tabular py-1.5 text-right text-bad">{r.errors || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
