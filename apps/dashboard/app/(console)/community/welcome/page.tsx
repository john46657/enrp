'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import { Button, ErrorState, KeyValues, PageHeader, Panel, Skeleton } from '@/components/ui/primitives';
import { get, put } from '@/lib/api';
import { useCan } from '@/lib/session';

interface Welcome {
  enabled: boolean;
  channelId: string | null;
  title: string;
  message: string;
  color: string;
}

export default function WelcomePage() {
  const can = useCan();
  const q = useQuery({
    queryKey: ['settings'],
    queryFn: () => get<{ items: Array<{ key: string; value: unknown }> }>('/settings'),
  });
  if (q.isLoading) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} />;
  const w = q.data!.items.find((s) => s.key === 'welcome')!.value as Welcome;
  const preview = w.message
    .replaceAll('{user}', '@NeuesMitglied')
    .replaceAll('{name}', 'NeuesMitglied')
    .replaceAll('{server}', 'GermanRP')
    .replaceAll('{count}', '1234');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Begrüßung"
        description="Nachricht für neue Mitglieder. Ist sie deaktiviert, gilt die bisherige Begrüßung aus der config.json des Bots."
        actions={
          can('settings:edit') && (
            <ActionDialog
              title="Begrüßung bearbeiten"
              submitLabel="Speichern"
              requireReason
              fields={[
                { name: 'enabled', label: 'Begrüßung aktiv', type: 'checkbox', defaultValue: w.enabled },
                { name: 'channelId', label: 'Kanal-ID', defaultValue: w.channelId ?? '' },
                { name: 'title', label: 'Titel', defaultValue: w.title, required: true },
                {
                  name: 'message',
                  label: 'Nachricht',
                  type: 'textarea',
                  defaultValue: w.message,
                  required: true,
                  hint: 'Platzhalter: {user} {name} {server} {count}',
                },
                { name: 'color', label: 'Farbe (#RRGGBB)', defaultValue: w.color, required: true },
              ]}
              onSubmit={(v) =>
                put('/settings/welcome', {
                  value: {
                    enabled: Boolean(v.enabled),
                    channelId: v.channelId ?? null,
                    title: v.title,
                    message: v.message,
                    color: v.color,
                  },
                  reason: v.reason,
                })
              }
              invalidate={[['settings']]}
              trigger={(o) => (
                <Button variant="primary" onClick={o}>
                  Bearbeiten
                </Button>
              )}
            />
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Einstellungen">
          <KeyValues
            items={[
              ['Status', w.enabled ? 'aktiv' : 'deaktiviert'],
              ['Kanal', w.channelId ?? 'nicht gesetzt'],
              ['Farbe', w.color],
            ]}
          />
        </Panel>
        <Panel title="Vorschau">
          <div className="rounded-md border-l-4 bg-surface-2 p-3" style={{ borderColor: w.color }}>
            <p className="font-semibold">{w.title}</p>
            <p className="mt-1 text-sm whitespace-pre-wrap">{preview}</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
