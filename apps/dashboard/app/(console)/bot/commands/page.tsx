'use client';

import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { Badge, Button, ErrorState, Input, PageHeader, Panel, Skeleton } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { useCan } from '@/lib/session';

interface Catalog {
  commands: Array<{ command: string; permission: string | null; locked: boolean }>;
}
interface Override {
  id: string;
  command: string;
  discordRoleId: string;
  effect: 'allow' | 'deny';
  reason: string | null;
  createdBy: string;
}

export default function CommandsPage() {
  const can = useCan();
  const [filter, setFilter] = useState('');
  const catalog = useQuery({ queryKey: ['permission-catalog'], queryFn: () => get<Catalog>('/permissions/catalog') });
  const overrides = useQuery({
    queryKey: ['command-overrides'],
    queryFn: () => get<{ items: Override[] }>('/permissions/commands'),
  });
  const grouped = useMemo(() => {
    const map = new Map<string, Catalog['commands']>();
    for (const c of catalog.data?.commands ?? []) {
      if (filter && !c.command.includes(filter.toLowerCase())) continue;
      const root = c.command.split(' ')[0]!;
      map.set(root, [...(map.get(root) ?? []), c]);
    }
    return [...map.entries()];
  }, [catalog.data, filter]);

  if (catalog.isLoading) return <Skeleton />;
  if (catalog.error) return <ErrorState error={catalog.error} />;
  const invalidate = [['command-overrides']];
  const overrideFor = (cmd: string) =>
    overrides.data?.items.filter((o) => o.command === cmd || o.command === cmd.split(' ')[0]) ?? [];

  return (
    <>
      <PageHeader
        title="Befehle & Overrides"
        description="Standardrechte kommen aus dem Berechtigungskatalog. Overrides schalten Befehle für Discord-Rollen frei oder sperren sie. Gesperrte Befehle (Schloss) lassen sich nicht per Override öffnen."
        actions={
          can('permissions:edit') && (
            <ActionDialog
              title="Override setzen"
              description="Du kannst nur Befehle freigeben, die du selbst ausführen darfst."
              submitLabel="Speichern"
              requireReason
              fields={[
                { name: 'command', label: 'Befehl (z. B. "mod" oder "mod ban")', required: true },
                { name: 'discordRoleId', label: 'Discord-Rollen-ID', required: true },
                {
                  name: 'effect',
                  label: 'Wirkung',
                  type: 'select',
                  required: true,
                  options: [
                    { value: 'allow', label: 'Freigeben' },
                    { value: 'deny', label: 'Sperren' },
                  ],
                },
              ]}
              onSubmit={(v, k) => post('/permissions/commands/override', v, k)}
              invalidate={invalidate}
              trigger={(open) => (
                <Button variant="primary" onClick={open}>
                  Override setzen
                </Button>
              )}
            />
          )
        }
      />
      <div className="mb-4 max-w-xs">
        <Input
          placeholder="Befehl filtern"
          aria-label="Befehl filtern"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {grouped.map(([root, cmds]) => (
          <Panel key={root} title={`/${root}`}>
            <ul className="space-y-1.5 text-sm">
              {cmds.map((c) => (
                <li key={c.command} className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-1">
                    {c.locked && <Lock className="size-3 text-warn" aria-label="Gesperrt für Overrides" />}
                    {c.command.split(' ').slice(1).join(' ') || c.command}
                  </span>
                  <code className="text-xs text-muted">{c.permission ?? 'alle'}</code>
                </li>
              ))}
            </ul>
            {overrideFor(`${root} x`).length > 0 && (
              <div className="mt-3 space-y-1 border-t border-line pt-2">
                {overrideFor(`${root} x`).map((o) => (
                  <div key={o.id} className="flex items-center gap-2 text-xs">
                    <Badge tone={o.effect === 'allow' ? 'ok' : 'bad'}>
                      {o.effect === 'allow' ? 'frei' : 'gesperrt'}
                    </Badge>
                    <span>
                      /{o.command} für Rolle {o.discordRoleId}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {(overrides.data?.items.some((o) => o.command.split(' ')[0] === root) ?? false) &&
              can('permissions:edit') && (
                <ActionDialog
                  title={`Overrides für /${root} zurücksetzen`}
                  submitLabel="Zurücksetzen"
                  danger
                  requireReason
                  fields={[]}
                  onSubmit={(v) => post('/permissions/commands/reset', { command: root, reason: v.reason })}
                  invalidate={invalidate}
                  trigger={(open) => (
                    <Button size="sm" variant="ghost" className="mt-2" onClick={open}>
                      Overrides zurücksetzen
                    </Button>
                  )}
                />
              )}
          </Panel>
        ))}
      </div>
    </>
  );
}
