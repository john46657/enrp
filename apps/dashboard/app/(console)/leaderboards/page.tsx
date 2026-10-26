'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DUTY_FACTION_OPTIONS, PERIOD_OPTIONS } from '@/components/data/options';
import { EmptyState, ErrorState, PageHeader, Panel, Select, Skeleton } from '@/components/ui/primitives';
import { get } from '@/lib/api';
import { fmtDuration } from '@/lib/format';

type Entry = { rank: number; robloxUserId: number; username: string; seconds: number };

function Board({ query, title }: { query: ReturnType<typeof useQuery<{ items: Entry[] }>>; title: string }) {
  return (
    <Panel title={title}>
      {query.isLoading ? (
        <Skeleton />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : !query.data?.items.length ? (
        <EmptyState title="Noch keine Daten" />
      ) : (
        <ol className="divide-y divide-line">
          {query.data.items.map((e) => (
            <li key={e.robloxUserId} className="flex items-center gap-3 py-2">
              <span
                className={`tabular w-8 text-right text-lg font-semibold ${e.rank === 1 ? 'text-signal' : 'text-muted'}`}
              >
                {e.rank}
              </span>
              <a href={`/players/roblox/${e.robloxUserId}`} className="flex-1 hover:underline">
                {e.username}
              </a>
              <span className="tabular">{fmtDuration(e.seconds)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export default function LeaderboardsPage() {
  const [period, setPeriod] = useState('week');
  const [faction, setFaction] = useState('');
  const playtime = useQuery({
    queryKey: ['lb-playtime'],
    queryFn: () => get<{ items: Entry[] }>('/leaderboards/playtime', { limit: 25 }),
  });
  const duty = useQuery({
    queryKey: ['lb-duty', period, faction],
    queryFn: () => get<{ items: Entry[] }>('/leaderboards/duty', { period, faction, limit: 25 }),
  });
  return (
    <>
      <PageHeader
        title="Ranglisten"
        description="Öffentliche Statistiken nach Spiel- und Dienstzeit."
        actions={
          <>
            <Select aria-label="Zeitraum" className="w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Fraktion"
              className="w-auto"
              value={faction}
              onChange={(e) => setFaction(e.target.value)}
            >
              <option value="">Alle Fraktionen</option>
              {DUTY_FACTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Board query={duty} title="Dienstzeit" />
        <Board query={playtime} title="Spielzeit gesamt" />
      </div>
    </>
  );
}
