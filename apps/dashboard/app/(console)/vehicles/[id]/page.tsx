'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { Button, ErrorState, KeyValues, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { get, patch, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Detail {
  vehicle: {
    id: string;
    identifier: string;
    name: string;
    status: string;
    allowedConfigs: Record<string, string[]>;
    notes: string;
    factionId: string | null;
    updatedAt: string;
  };
  assignments: Array<{
    username: string;
    assignment: {
      id: string;
      robloxUserId: number;
      assignedAt: string;
      assignedBy: string;
      reason: string | null;
      unassignedAt: string | null;
      unassignReason: string | null;
    };
  }>;
}

export default function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const router = useRouter();
  const q = useQuery({ queryKey: ['vehicle', id], queryFn: () => get<Detail>(`/vehicles/${id}`) });
  if (q.isLoading) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} />;
  const { vehicle: v, assignments } = q.data!;
  const invalidate = [['vehicle', id]];
  return (
    <div className="space-y-6">
      <PageHeader
        title={v.name}
        description={`Kennung ${v.identifier}`}
        actions={
          <>
            {can('vehicles:edit') && (
              <ActionDialog
                title="Fahrzeug zuweisen"
                submitLabel="Zuweisen"
                requireReason
                fields={[{ name: 'roblox', label: 'Roblox-Name oder -ID', required: true }]}
                onSubmit={(val, k) => {
                  const r = String(val.roblox);
                  return post(
                    `/vehicles/${v.id}/assign`,
                    { ...(/^\d+$/.test(r) ? { robloxUserId: Number(r) } : { robloxUsername: r }), reason: val.reason },
                    k,
                  );
                }}
                invalidate={invalidate}
                trigger={(open) => (
                  <Button variant="primary" onClick={open}>
                    Zuweisen
                  </Button>
                )}
              />
            )}
            {can('vehicles:edit') && (
              <ActionDialog
                title="Fahrzeug bearbeiten"
                submitLabel="Speichern"
                requireReason
                fields={[
                  { name: 'name', label: 'Anzeigename', defaultValue: v.name },
                  {
                    name: 'status',
                    label: 'Status',
                    type: 'select',
                    required: true,
                    defaultValue: v.status,
                    options: [
                      { value: 'active', label: 'Aktiv' },
                      { value: 'maintenance', label: 'Wartung' },
                      { value: 'disabled', label: 'Deaktiviert' },
                      { value: 'retired', label: 'Ausgemustert' },
                    ],
                  },
                  {
                    name: 'allowedConfigs',
                    label: 'Zulässige Konfigurationen (JSON)',
                    type: 'json',
                    defaultValue: JSON.stringify(v.allowedConfigs, null, 2),
                  },
                  { name: 'notes', label: 'Notizen', type: 'textarea', defaultValue: v.notes },
                ]}
                onSubmit={(val) => patch(`/vehicles/${v.id}`, val)}
                invalidate={invalidate}
                trigger={(open) => <Button onClick={open}>Bearbeiten</Button>}
              />
            )}
            {can('vehicles:delete') && (
              <ActionDialog
                title="Fahrzeug löschen"
                description="Das Fahrzeug und seine Zuweisungen werden entfernt. Die Löschung bleibt im Audit-Log nachvollziehbar."
                submitLabel="Löschen"
                danger
                requireReason
                confirmWord={v.identifier}
                fields={[]}
                onSubmit={(val) => post(`/vehicles/${v.id}/delete`, { reason: val.reason })}
                onDone={() => router.push('/vehicles')}
                trigger={(open) => (
                  <Button variant="danger" onClick={open}>
                    Löschen
                  </Button>
                )}
              />
            )}
          </>
        }
      />
      <Panel title="Details">
        <KeyValues
          items={[
            ['Status', <StatusBadge key="s" status={v.status} />],
            [
              'Konfigurationen',
              Object.entries(v.allowedConfigs)
                .map(([k, list]) => `${k}: ${list.join(', ')}`)
                .join('; ') || 'keine Einschränkungen hinterlegt',
            ],
            ['Notizen', v.notes || '–'],
            ['Zuletzt geändert', fmtDateTime(v.updatedAt)],
          ]}
        />
      </Panel>
      <Panel title="Zuweisungen und Historie">
        {assignments.length ? (
          <ul className="divide-y divide-line text-sm">
            {assignments.map((a) => (
              <li key={a.assignment.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium">{a.username}</span>
                <span className="text-muted">
                  seit {fmtDateTime(a.assignment.assignedAt)} ({a.assignment.reason ?? 'ohne Angabe'})
                </span>
                {a.assignment.unassignedAt ? (
                  <span className="text-muted">
                    entfernt {fmtDateTime(a.assignment.unassignedAt)}: {a.assignment.unassignReason}
                  </span>
                ) : (
                  can('vehicles:edit') && (
                    <ActionDialog
                      title="Zuweisung entfernen"
                      submitLabel="Entfernen"
                      danger
                      requireReason
                      fields={[]}
                      onSubmit={(val) =>
                        post(`/vehicles/assignments/${a.assignment.id}/unassign`, { reason: val.reason })
                      }
                      invalidate={invalidate}
                      trigger={(open) => (
                        <Button size="sm" variant="ghost" className="ml-auto" onClick={open}>
                          Entfernen
                        </Button>
                      )}
                    />
                  )
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Keine Zuweisungen.</p>
        )}
      </Panel>
    </div>
  );
}
