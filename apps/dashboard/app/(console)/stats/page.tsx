'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorState, KeyValues, PageHeader, Panel, Select, Skeleton } from '@/components/ui/primitives';
import { get } from '@/lib/api';
import { fmtDateTime, fmtDuration, fmtNumber } from '@/lib/format';

interface Stats {
  days: number;
  players: {
    hourly: Array<{ hour: string; players: number }>;
    peaks: Array<{ weekday: number; hour: number; avgPlayers: number }>;
    peak: { hour: string; players: number } | null;
    uniquePlayers: number;
    sessions: number;
    playSeconds: number;
  };
  moderation: Array<{ type: string; platform: string; count: number }>;
  tickets: {
    opened: number;
    closed: number;
    openNow: number;
    avgCloseSeconds: number | null;
    medianCloseSeconds: number | null;
  };
}

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MODERATION_LABELS: Record<string, string> = {
  warn: 'Verwarnungen',
  timeout: 'Timeouts',
  kick: 'Kicks',
  ban: 'Banns',
  unban: 'Entbannungen',
  note: 'Notizen',
};
const hourLabel = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export default function StatsPage() {
  const [days, setDays] = useState(7);
  const q = useQuery({ queryKey: ['stats', days], queryFn: () => get<Stats>('/stats/overview', { days }) });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Statistiken"
        description="Auswertung aus Spielsessions, Moderationsaktionen und Tickets."
        actions={
          <Select aria-label="Zeitraum" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Letzte 24 Stunden</option>
            <option value={7}>Letzte 7 Tage</option>
            <option value={30}>Letzte 30 Tage</option>
            <option value={90}>Letzte 90 Tage</option>
          </Select>
        }
      />
      {q.isLoading ? <Skeleton /> : q.error ? <ErrorState error={q.error} /> : <StatsView data={q.data!} />}
    </div>
  );
}

function StatsView({ data }: { data: Stats }) {
  const { players, tickets } = data;
  const chart = players.hourly.map((h) => ({ name: hourLabel.format(new Date(h.hour)), spieler: h.players }));
  const max = Math.max(1, ...players.peaks.map((p) => p.avgPlayers));
  const cell = (weekday: number, hour: number) =>
    players.peaks.find((p) => p.weekday === weekday && p.hour === hour)?.avgPlayers ?? 0;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Spieler">
          <KeyValues
            items={[
              ['Unterschiedliche Spieler', fmtNumber(players.uniquePlayers)],
              ['Spielsessions', fmtNumber(players.sessions)],
              ['Spielzeit gesamt', fmtDuration(players.playSeconds)],
              [
                'Spitzenstunde',
                players.peak ? `${fmtDateTime(players.peak.hour)} (${players.peak.players} Spieler)` : null,
              ],
            ]}
          />
        </Panel>
        <Panel title="Tickets">
          <KeyValues
            items={[
              ['Eröffnet', fmtNumber(tickets.opened)],
              ['Geschlossen', fmtNumber(tickets.closed)],
              ['Derzeit offen', fmtNumber(tickets.openNow)],
              ['Bearbeitungszeit (Median)', fmtDuration(tickets.medianCloseSeconds)],
              ['Bearbeitungszeit (Schnitt)', fmtDuration(tickets.avgCloseSeconds)],
            ]}
          />
        </Panel>
        <Panel title="Moderation">
          {data.moderation.length ? (
            <KeyValues
              items={data.moderation.map((m) => [
                `${MODERATION_LABELS[m.type] ?? m.type} (${m.platform === 'roblox' ? 'Roblox' : 'Discord'})`,
                fmtNumber(m.count),
              ])}
            />
          ) : (
            <p className="text-sm text-muted">Keine Moderationsaktionen im Zeitraum.</p>
          )}
        </Panel>
      </div>

      <Panel title="Spieler pro Stunde">
        {players.hourly.some((h) => h.players > 0) ? (
          <div className="h-64" role="img" aria-label="Unterschiedliche Spieler je Stunde">
            <ResponsiveContainer>
              <AreaChart data={chart} margin={{ left: -16 }}>
                <XAxis
                  dataKey="name"
                  stroke="var(--muted)"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  minTickGap={40}
                />
                <YAxis stroke="var(--muted)" tickLine={false} axisLine={false} fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6 }}
                  formatter={(v: number) => [v, 'Spieler']}
                />
                <Area
                  dataKey="spieler"
                  type="monotone"
                  stroke="var(--polizei)"
                  fill="var(--polizei)"
                  fillOpacity={0.2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Noch keine Spielsessions im Zeitraum. Werte erscheinen, sobald ein Roblox-Server Heartbeats sendet.
          </p>
        )}
      </Panel>

      <Panel title="Spitzenzeiten (Ø Spieler je Wochentag und Stunde, deutsche Zeit)">
        <div className="overflow-x-auto">
          <table className="text-xs tabular">
            <thead>
              <tr>
                <th />
                {Array.from({ length: 24 }, (_, h) => (
                  <th key={h} className="px-0.5 font-normal text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((label, i) => (
                <tr key={label}>
                  <th className="pr-2 text-left font-normal text-muted">{label}</th>
                  {Array.from({ length: 24 }, (_, h) => {
                    const v = cell(i + 1, h);
                    return (
                      <td key={h} className="p-0.5">
                        <div
                          className="h-5 w-5 rounded-sm"
                          title={`${label} ${h} Uhr: Ø ${v} Spieler`}
                          style={{
                            background: 'var(--polizei)',
                            opacity: v === 0 ? 0.06 : 0.15 + (0.85 * v) / max,
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
