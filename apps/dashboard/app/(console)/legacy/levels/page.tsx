'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { LegacyState, RoleSelect, SettingsForm, TABLE, type SettingField } from '@/components/data/legacy';
import { Button, EmptyState, Field, Input, PageHeader, Panel } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import {
  legacyAction,
  legacyKey,
  saveLegacySettings,
  useLegacyGuild,
  useLegacyLive,
  type LegacyGuild,
} from '@/lib/legacy';
import { useCan } from '@/lib/session';

interface Levels {
  enabled: boolean;
  total: number;
  top: Array<{
    rank: number;
    userId: string;
    userName: string | null;
    xp: number;
    level: number;
    current: number;
    needed: number;
  }>;
}

const SETTINGS: SettingField[] = [
  {
    path: 'leveling.enabled',
    label: 'Level-System aktiv',
    type: 'bool',
    hint: 'Mitglieder sammeln XP für Nachrichten (/rang, /bestenliste).',
  },
  {
    path: 'channels.levelUp',
    label: 'Kanal für Level-Up-Nachrichten',
    type: 'channel',
    hint: 'Leer = im Kanal der Nachricht.',
  },
  { path: 'leveling.cooldownSeconds', label: 'Sekunden zwischen XP-Vergaben', type: 'number', min: 0, max: 3600 },
  { path: 'leveling.xpMin', label: 'XP pro Nachricht (mindestens)', type: 'number', min: 0, max: 1000 },
  { path: 'leveling.xpMax', label: 'XP pro Nachricht (höchstens)', type: 'number', min: 0, max: 1000 },
];

function Rewards({ guild, canEdit }: { guild: LegacyGuild; canEdit: boolean }) {
  const toast = useToast();
  const client = useQueryClient();
  const rewards = ((guild.config.leveling as { roleRewards?: Record<string, string> })?.roleRewards ?? {}) as Record<
    string,
    string
  >;
  const [level, setLevel] = useState('');
  const [role, setRole] = useState('');
  const save = useMutation({
    mutationFn: (next: Record<string, string>) => saveLegacySettings([{ path: 'leveling.roleRewards', value: next }]),
    onSuccess: async () => {
      toast('success', 'Rollen-Belohnungen gespeichert.');
      setLevel('');
      setRole('');
      await client.invalidateQueries({ queryKey: legacyKey('guild') });
    },
    onError: (err) => toast('error', (err as Error).message),
  });
  const roleName = (id: string) => guild.roles.find((r) => r.id === id)?.name ?? `Unbekannt (${id})`;
  const entries = Object.entries(rewards).sort(([a], [b]) => Number(a) - Number(b));
  const n = Number(level);
  const valid = Number.isInteger(n) && n >= 1 && n <= 500 && role;
  return (
    <Panel title="Rollen-Belohnungen">
      <p className="mb-3 text-sm text-muted">
        Wer das Level erreicht, bekommt die Rolle. Bereits erreichte Level werden nicht nachträglich belohnt.
      </p>
      {entries.length ? (
        <table className={TABLE}>
          <thead>
            <tr>
              <th>Level</th>
              <th>Rolle</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map(([lvl, roleId]) => (
              <tr key={lvl}>
                <td>{lvl}</td>
                <td>@{roleName(roleId)}</td>
                <td className="text-right">
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={save.isPending}
                      onClick={() => save.mutate(Object.fromEntries(entries.filter(([l]) => l !== lvl)))}
                    >
                      Entfernen
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-muted">Noch keine Belohnungen.</p>
      )}
      {canEdit && (
        <div className="mt-4 grid items-end gap-3 sm:grid-cols-[8rem_1fr_auto]">
          <Field label="Level" htmlFor="reward-level">
            <Input
              id="reward-level"
              type="number"
              min={1}
              max={500}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            />
          </Field>
          <Field label="Rolle" htmlFor="reward-role">
            <RoleSelect id="reward-role" guild={guild} value={role} onChange={setRole} />
          </Field>
          <Button
            variant="primary"
            disabled={!valid || save.isPending}
            onClick={() => save.mutate({ ...rewards, [String(n)]: role })}
          >
            Hinzufügen
          </Button>
        </div>
      )}
    </Panel>
  );
}

export default function LevelsPage() {
  const can = useCan();
  const q = useLegacyLive<Levels>('levels');
  const guild = useLegacyGuild();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Level-System"
        description="Rangliste, Einstellungen und Rollen-Belohnungen des Level-Systems im Haupt-Discord."
        actions={
          can('community:edit') && (
            <ActionDialog
              title="XP setzen"
              description="Setzt die XP einer Person auf einen festen Wert. Rollen-Belohnungen werden dabei nicht vergeben oder entzogen."
              fields={[
                { name: 'userId', label: 'Discord-ID', required: true, placeholder: '123456789012345678' },
                { name: 'xp', label: 'XP', type: 'number', required: true, min: 0 },
              ]}
              submitLabel="Setzen"
              successMessage="XP gesetzt."
              onSubmit={(v) => legacyAction('level-set', v)}
              invalidate={[legacyKey('levels')]}
              trigger={(o) => <Button onClick={o}>XP setzen</Button>}
            />
          )
        }
      />
      <Panel title={q.data ? `Rangliste (${q.data.total.toLocaleString('de-DE')} Mitglieder mit XP)` : 'Rangliste'}>
        <LegacyState query={q}>
          {!q.data?.top.length ? (
            <EmptyState title="Noch hat niemand XP gesammelt">
              {q.data && !q.data.enabled ? 'Das Level-System ist ausgeschaltet.' : null}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th>Platz</th>
                    <th>Mitglied</th>
                    <th>Level</th>
                    <th>XP</th>
                    <th>Bis zum nächsten Level</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {q.data.top.map((e) => (
                    <tr key={e.userId}>
                      <td>{e.rank}</td>
                      <td>
                        {e.userName ?? <span className="text-muted">{e.userId} (nicht mehr auf dem Server)</span>}
                      </td>
                      <td>{e.level}</td>
                      <td>{e.xp.toLocaleString('de-DE')}</td>
                      <td>
                        {e.current.toLocaleString('de-DE')} / {e.needed.toLocaleString('de-DE')}
                      </td>
                      <td className="text-right">
                        {can('community:delete') && (
                          <ActionDialog
                            title={`XP von ${e.userName ?? e.userId} löschen`}
                            description="Löscht alle XP dieser Person. Das lässt sich nicht rückgängig machen."
                            fields={[]}
                            danger
                            submitLabel="Löschen"
                            successMessage="XP gelöscht."
                            onSubmit={() => legacyAction('level-reset', { userId: e.userId })}
                            invalidate={[legacyKey('levels')]}
                            trigger={(o) => (
                              <Button size="sm" variant="danger" onClick={o}>
                                Zurücksetzen
                              </Button>
                            )}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </LegacyState>
      </Panel>
      <LegacyState query={guild}>
        {guild.data && (
          <>
            <SettingsForm title="Einstellungen" guild={guild.data} fields={SETTINGS} canEdit={can('settings:edit')} />
            <Rewards guild={guild.data} canEdit={can('settings:edit')} />
          </>
        )}
      </LegacyState>
    </div>
  );
}
