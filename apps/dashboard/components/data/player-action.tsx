'use client';

import { ActionDialog } from '@/components/data/action-dialog';
import { Button } from '@/components/ui/primitives';
import { post } from '@/lib/api';
import { useCan } from '@/lib/session';

export const ACTION_LABEL: Record<string, string> = {
  jail: 'Ins Gefängnis',
  unjail: 'Aus dem Gefängnis entlassen',
  wanted: 'Fahndungsstufe setzen',
  heal: 'Heilen',
  respawn: 'Respawn',
  team: 'Team setzen',
  pm: 'Private Nachricht',
  kill: 'Töten',
  kick: 'Vom Server kicken',
};

/** Töten und Kicken brauchen player_actions:delete, alles andere player_actions:edit. */
const HEAVY = new Set(['kill', 'kick']);

/**
 * Aktion an einem Spieler im Spiel. Die Plattform sucht den Server des Spielers; das Spiel führt den Befehl
 * innerhalb weniger Sekunden aus und bestätigt ihn (sichtbar unter Roblox-Server → Befehle).
 */
export function PlayerActionButton({ userId, username, teams }: { userId: number; username: string; teams: string[] }) {
  const can = useCan();
  const options = Object.entries(ACTION_LABEL)
    .filter(([action]) => can(HEAVY.has(action) ? 'player_actions:delete' : 'player_actions:edit'))
    .map(([value, label]) => ({ value, label }));
  if (!options.length) return null;
  return (
    <ActionDialog
      title={`Aktion: ${username}`}
      description="Je nach Aktion das passende Feld ausfüllen: Minuten (Gefängnis), Stufe (Fahndung), Team oder Nachricht."
      submitLabel="Ausführen"
      successMessage="An den Server geschickt"
      fields={[
        { name: 'action', label: 'Aktion', type: 'select', required: true, defaultValue: options[0]!.value, options },
        { name: 'minutes', label: 'Minuten (Gefängnis)', type: 'number', min: 1, max: 120 },
        { name: 'level', label: 'Fahndungsstufe 0–5', type: 'number', min: 0, max: 5 },
        teams.length
          ? {
              name: 'team',
              label: 'Team',
              type: 'select',
              options: [{ value: '', label: '–' }, ...teams.map((t) => ({ value: t, label: t }))],
            }
          : { name: 'team', label: 'Team' },
        { name: 'message', label: 'Nachricht', type: 'textarea' },
        { name: 'reason', label: 'Grund (Audit-Log)', required: true },
      ]}
      onSubmit={(v, key) =>
        post(
          `/roblox/players/${userId}/actions`,
          {
            action: v.action,
            reason: v.reason,
            minutes: v.action === 'jail' ? v.minutes : undefined,
            level: v.action === 'wanted' ? v.level : undefined,
            team: v.action === 'team' ? v.team || undefined : undefined,
            message: v.action === 'pm' ? v.message : undefined,
          },
          key,
        )
      }
      invalidate={[['live-players'], ['roblox-server']]}
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Aktion
        </Button>
      )}
    />
  );
}
