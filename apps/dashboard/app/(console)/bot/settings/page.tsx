'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import { Badge, Button, ErrorState, PageHeader, Panel, Skeleton } from '@/components/ui/primitives';
import { get, put } from '@/lib/api';
import { useCan } from '@/lib/session';

interface Setting {
  key: string;
  label: string;
  critical: boolean;
  value: Record<string, unknown>;
}

const FIELD_LABELS: Record<string, string> = {
  ticketChannelId: 'Kanal für neue Tickets',
  reportChannelId: 'Kanal für neue Reports',
  moderationLogChannelId: 'Moderations-Log',
  alertChannelId: 'Kanal für Systemwarnungen',
  suggestionChannelId: 'Vorschlagskanal',
  announcementChannelId: 'Ankündigungskanal',
  auditChannelId: 'Audit-Kanal',
  verifiedRoleId: 'Rolle „Verifiziert“',
  unlinkCooldownHours: 'Wartezeit nach Aufheben (Stunden)',
  allowSelfUnlink: 'Selbst aufheben erlaubt',
  maxSessionHours: 'Höchstdauer einer Dienstsession (Stunden)',
  clockSkewToleranceSeconds: 'Erlaubte Zeitabweichung (Sekunden)',
  serverTimeoutSeconds: 'Server gilt als offline nach (Sekunden)',
  presenceText: 'Statustext des Bots',
  disabledCommands: 'Deaktivierte Befehle',
};

/** Einstellungsformulare werden aus den aktuellen Werten erzeugt; die API validiert jede Änderung. */
export default function SettingsPage() {
  const can = useCan();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<{ items: Setting[] }>('/settings') });
  if (q.isLoading) return <Skeleton rows={8} />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <>
      <PageHeader
        title="Konfiguration"
        description="Änderungen gelten sofort, werden versioniert und im Audit-Log protokolliert. Kritische Bereiche erfordern „settings:configure“."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        {q
          .data!.items.filter((s) => s.key !== 'welcome')
          .map((s) => (
            <Panel
              key={s.key}
              title={
                <span className="flex items-center gap-2">
                  {s.label}
                  {s.critical && <Badge tone="warn">kritisch</Badge>}
                </span>
              }
              actions={
                can(s.critical ? 'settings:configure' : 'settings:edit') && (
                  <ActionDialog
                    title={s.label}
                    submitLabel="Speichern"
                    requireReason
                    fields={Object.entries(s.value).map(([k, v]) => ({
                      name: k,
                      label: FIELD_LABELS[k] ?? k,
                      type:
                        typeof v === 'boolean'
                          ? 'checkbox'
                          : typeof v === 'number'
                            ? 'number'
                            : Array.isArray(v)
                              ? 'textarea'
                              : 'text',
                      defaultValue: Array.isArray(v) ? v.join('\n') : ((v ?? '') as string | number | boolean),
                      hint: Array.isArray(v)
                        ? 'Ein Eintrag pro Zeile'
                        : k.endsWith('ChannelId') || k.endsWith('RoleId')
                          ? 'Discord-ID; leer lassen zum Entfernen'
                          : undefined,
                    }))}
                    onSubmit={(v) => {
                      const value: Record<string, unknown> = {};
                      for (const [k, original] of Object.entries(s.value)) {
                        const input = v[k];
                        value[k] = Array.isArray(original)
                          ? String(input ?? '')
                              .split('\n')
                              .map((x) => x.trim())
                              .filter(Boolean)
                          : typeof original === 'boolean'
                            ? Boolean(input)
                            : input === undefined && (k.endsWith('Id') || original === null)
                              ? null
                              : (input ?? original);
                      }
                      return put(`/settings/${s.key}`, { value, reason: v.reason });
                    }}
                    invalidate={[['settings']]}
                    trigger={(open) => (
                      <Button size="sm" onClick={open}>
                        Bearbeiten
                      </Button>
                    )}
                  />
                )
              }
            >
              <dl className="grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
                {Object.entries(s.value).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{FIELD_LABELS[k] ?? k}</dt>
                    <dd className="break-all">
                      {v === null || v === '' ? (
                        <span className="text-muted">nicht gesetzt</span>
                      ) : Array.isArray(v) ? (
                        v.join(', ') || <span className="text-muted">keine</span>
                      ) : (
                        String(v)
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ))}
      </div>
    </>
  );
}
