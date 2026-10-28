'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import { Badge, Button, ErrorState, PageHeader, Panel, Skeleton } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Rule {
  id: string;
  name: string;
  trigger: string;
  action: string;
  conditions: { threshold?: number };
  actionConfig: { channelId?: string; severity?: string };
  enabled: boolean;
  cooldownSeconds: number;
  lastFiredAt: string | null;
}
const TRIGGERS: Record<string, string> = {
  backup_failed: 'Backup fehlgeschlagen',
  service_down: 'Dienst ausgefallen',
  release_deployed: 'Release ausgerollt',
  roblox_disconnected: 'Roblox nicht erreichbar',
  incident_created: 'Vorfall eröffnet',
  error_rate_high: 'Hohe Fehlerquote',
};
const ACTIONS: Record<string, string> = {
  notify_discord: 'Discord benachrichtigen',
  create_incident: 'Vorfall eröffnen',
  run_health_check: 'Health-Check ausführen',
};

export default function AutomationsPage() {
  const can = useCan();
  const rules = useQuery({ queryKey: ['automations'], queryFn: () => get<{ items: Rule[] }>('/automations') });
  const history = useQuery({
    queryKey: ['automation-history'],
    queryFn: () =>
      get<{
        items: Array<{
          id: string;
          ruleId: string;
          status: string;
          test: boolean;
          createdAt: string;
          details: { summary?: string } | null;
        }>;
      }>('/automations/history'),
  });
  if (rules.isLoading) return <Skeleton />;
  if (rules.error) return <ErrorState error={rules.error} />;
  const invalidate = [['automations'], ['automation-history']];
  const nameOf = (id: string) => rules.data!.items.find((r) => r.id === id)?.name ?? id.slice(0, 8);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Automatisierungen"
        description="Regeln führen nur begrenzte Aktionen aus (Benachrichtigen, Vorfall eröffnen, Health-Check). Cooldowns und eine Verkettungsgrenze verhindern Endlosschleifen."
        actions={
          can('automations:create') && (
            <ActionDialog
              title="Regel anlegen"
              submitLabel="Anlegen"
              requireReason
              fields={[
                { name: 'name', label: 'Name', required: true },
                {
                  name: 'trigger',
                  label: 'Auslöser',
                  type: 'select',
                  required: true,
                  options: Object.entries(TRIGGERS).map(([value, label]) => ({ value, label })),
                },
                {
                  name: 'action',
                  label: 'Aktion',
                  type: 'select',
                  required: true,
                  options: Object.entries(ACTIONS).map(([value, label]) => ({ value, label })),
                },
                { name: 'threshold', label: 'Schwelle (z. B. Fehlschläge in Folge)', type: 'number', min: 1 },
                {
                  name: 'cooldownMinutes',
                  label: 'Mindestabstand in Minuten',
                  type: 'number',
                  defaultValue: 15,
                  min: 1,
                },
                { name: 'channelId', label: 'Discord-Kanal (optional, sonst Warnkanal)' },
              ]}
              onSubmit={(v) =>
                post('/automations', {
                  name: v.name,
                  trigger: v.trigger,
                  action: v.action,
                  reason: v.reason,
                  conditions: v.threshold ? { threshold: v.threshold } : {},
                  actionConfig: v.channelId ? { channelId: v.channelId } : {},
                  cooldownSeconds: Math.round(Number(v.cooldownMinutes ?? 15) * 60),
                })
              }
              invalidate={invalidate}
              trigger={(open) => (
                <Button variant="primary" onClick={open}>
                  Regel anlegen
                </Button>
              )}
            />
          )
        }
      />
      <Panel title="Regeln">
        <ul className="divide-y divide-line">
          {rules.data!.items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <div className="min-w-56 flex-1">
                <p className="font-medium">{r.name}</p>
                <p className="text-muted">
                  Wenn „{TRIGGERS[r.trigger]}“{r.conditions.threshold ? ` (ab ${r.conditions.threshold})` : ''}, dann „
                  {ACTIONS[r.action]}“, höchstens alle {Math.round(r.cooldownSeconds / 60)} Minuten. Zuletzt{' '}
                  {fmtRelative(r.lastFiredAt)}.
                </p>
              </div>
              <Badge tone={r.enabled ? 'ok' : 'muted'}>{r.enabled ? 'aktiv' : 'pausiert'}</Badge>
              {can('automations:edit') && (
                <>
                  <ActionDialog
                    title="Probelauf"
                    description="Prüft Bedingungen und Cooldown, ohne die Aktion auszuführen."
                    submitLabel="Probelauf starten"
                    fields={[{ name: 'count', label: 'Simulierter Zählwert', type: 'number' }]}
                    onSubmit={(v) => post<{ matches: boolean; wouldRun: boolean }>(`/automations/${r.id}/test`, v)}
                    successMessage={(res) =>
                      `Bedingungen ${(res as { matches: boolean }).matches ? 'erfüllt' : 'nicht erfüllt'}, würde ${(res as { wouldRun: boolean }).wouldRun ? '' : 'nicht '}ausgeführt`
                    }
                    invalidate={invalidate}
                    trigger={(open) => (
                      <Button size="sm" onClick={open}>
                        Probelauf
                      </Button>
                    )}
                  />
                  <ActionDialog
                    title={r.enabled ? 'Regel pausieren' : 'Regel fortsetzen'}
                    submitLabel={r.enabled ? 'Pausieren' : 'Fortsetzen'}
                    requireReason
                    fields={[]}
                    onSubmit={(v) => post(`/automations/${r.id}/enabled`, { enabled: !r.enabled, reason: v.reason })}
                    invalidate={invalidate}
                    trigger={(open) => (
                      <Button size="sm" onClick={open}>
                        {r.enabled ? 'Pausieren' : 'Fortsetzen'}
                      </Button>
                    )}
                  />
                </>
              )}
              {can('automations:delete') && (
                <ActionDialog
                  title="Regel löschen"
                  submitLabel="Löschen"
                  danger
                  requireReason
                  fields={[]}
                  onSubmit={(v) => post(`/automations/${r.id}/delete`, v)}
                  invalidate={invalidate}
                  trigger={(open) => (
                    <Button size="sm" variant="ghost" onClick={open}>
                      Löschen
                    </Button>
                  )}
                />
              )}
            </li>
          ))}
          {!rules.data!.items.length && (
            <li className="py-2 text-sm text-muted">
              Noch keine Regeln. Beispiele: bei 2 fehlgeschlagenen Backups in Folge einen Vorfall eröffnen; bei Ausfall
              des Bots im Warnkanal benachrichtigen.
            </li>
          )}
        </ul>
      </Panel>
      <Panel title="Ausführungen">
        <ul className="divide-y divide-line text-sm">
          {history.data?.items.map((h) => (
            <li key={h.id} className="flex flex-wrap gap-3 py-1.5">
              <span className="text-muted">{fmtDateTime(h.createdAt)}</span>
              <span>{nameOf(h.ruleId)}</span>
              <Badge tone={h.status === 'succeeded' ? 'ok' : h.status === 'failed' ? 'bad' : 'muted'}>
                {h.test ? 'Probelauf' : h.status === 'skipped_cooldown' ? 'Cooldown' : h.status}
              </Badge>
              <span className="text-muted">{h.details?.summary}</span>
            </li>
          ))}
          {!history.data?.items.length && <li className="text-muted">Keine Ausführungen.</li>}
        </ul>
      </Panel>
    </div>
  );
}
