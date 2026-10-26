'use client';

import { useQuery } from '@tanstack/react-query';
import { Fragment } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { Badge, Button, ErrorState, PageHeader, Panel, Skeleton } from '@/components/ui/primitives';
import { get, post, put } from '@/lib/api';
import { useCan } from '@/lib/session';

interface Role {
  id: string;
  key: string;
  name: string;
  description: string;
  priority: number;
  isSystem: boolean;
  grants: Array<{ permission: string; factionIds: string[] | null }>;
  bindings: Array<{ id: string; discordRoleId: string | null; discordUserId: string | null }>;
}
interface Catalog {
  actions: Record<string, string>;
  resources: Record<string, { label: string; group: string; actions: string[] }>;
  permissions: Array<{ key: string; critical: boolean }>;
}

function has(role: Role, permission: string) {
  const [res] = permission.split(':');
  return role.grants.find((g) => g.permission === '*' || g.permission === permission || g.permission === `${res}:*`);
}

type ApprovalResult = { status: 'approval_required'; approval: { number: number } } | { status: 'applied' };
const resultText = (r: unknown) =>
  (r as ApprovalResult).status === 'approval_required'
    ? `Kritische Änderung: Freigabe #${(r as { approval: { number: number } }).approval.number} angelegt`
    : 'Übernommen';

export default function PermissionsPage() {
  const can = useCan();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<{ items: Role[] }>('/permissions/roles') });
  const catalog = useQuery({ queryKey: ['permission-catalog'], queryFn: () => get<Catalog>('/permissions/catalog') });
  if (roles.isLoading || catalog.isLoading) return <Skeleton rows={10} />;
  if (roles.error || catalog.error) return <ErrorState error={roles.error ?? catalog.error} />;
  const groups = new Map<string, Array<[string, Catalog['resources'][string]]>>();
  for (const [key, res] of Object.entries(catalog.data!.resources))
    groups.set(res.group, [...(groups.get(res.group) ?? []), [key, res]]);
  const critical = new Set(catalog.data!.permissions.filter((p) => p.critical).map((p) => p.key));
  const invalidate = [['roles']];
  const list = roles.data!.items;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rollen & Rechte"
        description="Plattform-Rollen werden Discord-Rollen oder einzelnen Personen zugewiesen. Niemand kann Rechte vergeben, die er selbst nicht hat; kritische Rechte (rot markiert) brauchen eine zweite Freigabe."
        actions={
          can('permissions:configure') && (
            <ActionDialog
              title="Rolle anlegen"
              submitLabel="Anlegen"
              requireReason
              fields={[
                { name: 'key', label: 'Schlüssel (a–z, _)', required: true },
                { name: 'name', label: 'Name', required: true },
                { name: 'description', label: 'Beschreibung', type: 'textarea' },
                { name: 'priority', label: 'Priorität (0–999)', type: 'number' },
              ]}
              onSubmit={(v) => post('/permissions/roles', v)}
              invalidate={invalidate}
              trigger={(open) => (
                <Button variant="primary" onClick={open}>
                  Rolle anlegen
                </Button>
              )}
            />
          )
        }
      />

      <Panel title="Rollen und Zuweisungen">
        <ul className="divide-y divide-line">
          {list.map((role) => (
            <li key={role.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-48 flex-1">
                <p className="font-medium">
                  {role.name} <span className="text-xs text-muted">({role.key})</span>
                </p>
                <p className="text-sm text-muted">{role.description}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {role.bindings.map((b) => (
                  <span key={b.id} className="inline-flex items-center gap-1">
                    <Badge tone="info">
                      {b.discordRoleId ? `Discord-Rolle ${b.discordRoleId}` : `Person ${b.discordUserId}`}
                    </Badge>
                    {can('permissions:edit') && (
                      <ActionDialog
                        title="Zuweisung entfernen"
                        submitLabel="Entfernen"
                        danger
                        requireReason
                        fields={[]}
                        onSubmit={(v) => post(`/permissions/bindings/${b.id}/remove`, v)}
                        invalidate={invalidate}
                        trigger={(open) => (
                          <button className="text-muted hover:text-bad" onClick={open} aria-label="Zuweisung entfernen">
                            ×
                          </button>
                        )}
                      />
                    )}
                  </span>
                ))}
                {!role.bindings.length && <span className="text-muted">nicht zugewiesen</span>}
              </div>
              {can('permissions:edit') && (
                <div className="flex gap-2">
                  <ActionDialog
                    title={`„${role.name}“ zuweisen`}
                    description="Entweder Discord-Rollen-ID oder Discord-Nutzer-ID angeben."
                    submitLabel="Zuweisen"
                    requireReason
                    fields={[
                      { name: 'discordRoleId', label: 'Discord-Rollen-ID' },
                      { name: 'discordUserId', label: 'oder Discord-Nutzer-ID' },
                    ]}
                    onSubmit={(v, k) => post('/permissions/bindings', { roleId: role.id, ...v }, k)}
                    successMessage={resultText}
                    invalidate={invalidate}
                    trigger={(open) => (
                      <Button size="sm" onClick={open}>
                        Zuweisen
                      </Button>
                    )}
                  />
                  <ActionDialog
                    title={`Rechte von „${role.name}“`}
                    description="Ein Recht pro Zeile, z. B. tickets:view, tickets:* oder factions:edit@<fraktions-id> für eine Einschränkung auf eine Fraktion."
                    submitLabel="Rechte speichern"
                    requireReason
                    fields={[
                      {
                        name: 'grants',
                        label: 'Rechte',
                        type: 'textarea',
                        defaultValue: role.grants
                          .map((g) =>
                            g.factionIds?.length ? `${g.permission}@${g.factionIds.join(',')}` : g.permission,
                          )
                          .join('\n'),
                      },
                    ]}
                    onSubmit={(v) =>
                      put(`/permissions/roles/${role.id}/grants`, {
                        reason: v.reason,
                        grants: String(v.grants ?? '')
                          .split('\n')
                          .map((l) => l.trim())
                          .filter(Boolean)
                          .map((l) => {
                            const [permission, factions] = l.split('@');
                            return { permission: permission!, factionIds: factions ? factions.split(',') : null };
                          }),
                      })
                    }
                    successMessage={resultText}
                    invalidate={invalidate}
                    trigger={(open) => (
                      <Button size="sm" onClick={open}>
                        Rechte bearbeiten
                      </Button>
                    )}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Berechtigungsmatrix">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Recht</th>
                {list.map((r) => (
                  <th key={r.id} className="px-2 py-2 text-center font-medium whitespace-nowrap">
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...groups.entries()].map(([group, resources]) => (
                <Fragment key={group}>
                  <tr>
                    <th colSpan={list.length + 1} className="pt-4 pb-1 font-condensed text-base">
                      {group}
                    </th>
                  </tr>
                  {resources.flatMap(([key, res]) =>
                    res.actions.map((action) => {
                      const perm = `${key}:${action}`;
                      return (
                        <tr key={perm} className="border-t border-line">
                          <td className={`py-1.5 pr-3 ${critical.has(perm) ? 'text-bad' : ''}`}>
                            {res.label}: {catalog.data!.actions[action]}
                          </td>
                          {list.map((r) => {
                            const g = has(r, perm);
                            return (
                              <td key={r.id} className="px-2 py-1.5 text-center">
                                {g ? (
                                  <span title={g.factionIds?.length ? 'nur bestimmte Fraktionen' : 'erlaubt'}>
                                    {g.factionIds?.length ? '◐' : '●'}
                                  </span>
                                ) : (
                                  <span className="text-line-strong">·</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    }),
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">
          ● erlaubt, ◐ auf bestimmte Fraktionen beschränkt. Rot markierte Rechte sind kritisch.
        </p>
      </Panel>
    </div>
  );
}
