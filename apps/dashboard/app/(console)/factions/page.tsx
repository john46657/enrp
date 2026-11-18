'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PERIOD_OPTIONS } from '@/components/data/options';
import { ErrorState, FactionTag, PageHeader, Select, Skeleton } from '@/components/ui/primitives';
import { get } from '@/lib/api';
import { fmtDuration } from '@/lib/format';

interface Faction {
  id: string;
  key: string;
  name: string;
  description: string;
  memberCount: number;
  hasDuty: boolean;
  isActive: boolean;
  discordRoleId: string | null;
}

export default function FactionsPage() {
  const [period, setPeriod] = useState('week');
  const list = useQuery({ queryKey: ['factions'], queryFn: () => get<{ items: Faction[] }>('/factions') });
  const stats = useQuery({
    queryKey: ['factions-stats', period],
    queryFn: () =>
      get<{ items: Array<{ factionId: string; dutySeconds: number; sessions: number; onDuty: number }> }>(
        '/factions/stats',
        { period },
      ),
  });
  if (list.isLoading) return <Skeleton />;
  if (list.error) return <ErrorState error={list.error} />;
  return (
    <>
      <PageHeader
        title="Fraktionen"
        description="Mitgliedschaften werden vom Team vergeben – nie automatisch durch die Verifizierung."
        actions={
          <Select aria-label="Zeitraum" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-auto">
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        }
      />
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Fraktion</th>
              <th className="px-3 py-2 font-medium">Mitglieder</th>
              <th className="px-3 py-2 font-medium">Im Dienst</th>
              <th className="px-3 py-2 font-medium">Dienstzeit im Zeitraum</th>
              <th className="px-3 py-2 font-medium">Sessions</th>
              <th className="px-3 py-2 font-medium">Discord-Rolle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.data!.items.map((f) => {
              const s = stats.data?.items.find((x) => x.factionId === f.id);
              return (
                <tr key={f.id} className="bg-surface hover:bg-surface-2">
                  <td className="px-3 py-2">
                    <Link href={`/factions/${f.key}`} className="font-medium hover:underline">
                      <FactionTag factionKey={f.key} name={f.name} />
                    </Link>
                    {!f.isActive && <span className="ml-2 text-xs text-muted">deaktiviert</span>}
                  </td>
                  <td className="tabular px-3 py-2">{f.memberCount}</td>
                  <td className="tabular px-3 py-2">{f.hasDuty ? (s?.onDuty ?? '–') : 'kein Dienstsystem'}</td>
                  <td className="tabular px-3 py-2">{f.hasDuty ? fmtDuration(s?.dutySeconds) : '–'}</td>
                  <td className="tabular px-3 py-2">{f.hasDuty ? (s?.sessions ?? '–') : '–'}</td>
                  <td className="px-3 py-2 text-muted">{f.discordRoleId ?? 'keine (optional)'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
