'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Button, FactionTag, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { useCan } from '@/lib/session';

interface Row {
  vehicle: { id: string; identifier: string; name: string; status: string };
  categoryName: string | null;
  factionName: string | null;
  factionKey: string | null;
  assignments: number;
}

export default function VehiclesPage() {
  const can = useCan();
  const categories = useQuery({
    queryKey: ['vehicle-categories'],
    queryFn: () => get<{ items: Array<{ id: string; name: string }> }>('/vehicles/categories'),
  });
  const factions = useQuery({
    queryKey: ['factions'],
    queryFn: () => get<{ items: Array<{ id: string; name: string }> }>('/factions'),
  });
  const categoryOptions = categories.data?.items.map((c) => ({ value: c.id, label: c.name })) ?? [];
  const factionOptions = factions.data?.items.map((f) => ({ value: f.id, label: f.name })) ?? [];
  return (
    <>
      <PageHeader
        title="Fahrzeuge"
        description="Der Fahrzeugkatalog ist vollständig konfigurierbar. Die Kennung muss dem Modellnamen im Roblox-Spiel entsprechen."
        actions={
          <>
            {can('vehicles:create') && (
              <ActionDialog
                title="Kategorie anlegen"
                submitLabel="Anlegen"
                requireReason
                fields={[
                  { name: 'key', label: 'Schlüssel (a–z, _)', required: true, placeholder: 'streifenwagen' },
                  { name: 'name', label: 'Name', required: true },
                ]}
                onSubmit={(v) => post('/vehicles/categories', v)}
                invalidate={[['vehicle-categories']]}
                trigger={(open) => <Button onClick={open}>Kategorie anlegen</Button>}
              />
            )}
            {can('vehicles:create') && (
              <ActionDialog
                title="Fahrzeug anlegen"
                submitLabel="Anlegen"
                requireReason
                fields={[
                  { name: 'identifier', label: 'Kennung im Spiel', required: true },
                  { name: 'name', label: 'Anzeigename', required: true },
                  { name: 'categoryId', label: 'Kategorie', type: 'select', options: categoryOptions },
                  {
                    name: 'factionId',
                    label: 'Fraktion',
                    type: 'select',
                    options: factionOptions,
                    hint: 'Leer = für alle nutzbar',
                  },
                  {
                    name: 'allowedConfigs',
                    label: 'Zulässige Konfigurationen (JSON)',
                    type: 'json',
                    placeholder: '{"lackierungen": ["Standard"], "ausstattung": []}',
                  },
                  { name: 'notes', label: 'Notizen', type: 'textarea' },
                ]}
                onSubmit={(v, k) => post('/vehicles', v, k)}
                invalidate={[['list', '/vehicles']]}
                trigger={(open) => (
                  <Button variant="primary" onClick={open}>
                    Fahrzeug anlegen
                  </Button>
                )}
              />
            )}
          </>
        }
      />
      <ResourceTable<Row>
        path="/vehicles"
        rowKey={(r) => r.vehicle.id}
        rowHref={(r) => `/vehicles/${r.vehicle.id}`}
        filters={[
          { name: 'categoryId', label: 'Kategorie', options: categoryOptions },
          { name: 'factionId', label: 'Fraktion', options: factionOptions },
          {
            name: 'status',
            label: 'Status',
            options: ['active', 'maintenance', 'disabled', 'retired'].map((v) => ({
              value: v,
              label: { active: 'Aktiv', maintenance: 'Wartung', disabled: 'Deaktiviert', retired: 'Ausgemustert' }[v]!,
            })),
          },
        ]}
        emptyTitle="Noch keine Fahrzeuge konfiguriert"
        emptyText="Lege Fahrzeuge mit der Kennung an, unter der sie im Spiel existieren."
        columns={[
          { key: 'name', header: 'Fahrzeug', render: (r) => r.vehicle.name, sortValue: (r) => r.vehicle.name },
          { key: 'id', header: 'Kennung', render: (r) => <code className="text-xs">{r.vehicle.identifier}</code> },
          { key: 'category', header: 'Kategorie', render: (r) => r.categoryName ?? '–' },
          {
            key: 'faction',
            header: 'Fraktion',
            render: (r) => (r.factionKey ? <FactionTag factionKey={r.factionKey} name={r.factionName} /> : 'alle'),
          },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.vehicle.status} /> },
          { key: 'assigned', header: 'Zuweisungen', render: (r) => r.assignments, sortValue: (r) => r.assignments },
        ]}
      />
    </>
  );
}
