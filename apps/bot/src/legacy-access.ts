/**
 * Entscheidung für Altbefehle (apps/bot/legacy) im Rechtesystem der Plattform. Wer bisher durfte (Discord-Recht
 * des Befehls bzw. Staff-/Support-Rolle der Altmodule), darf weiterhin. Zusätzlich:
 * - im Dashboard deaktivierte Befehle sind gesperrt,
 * - Rollen-Overrides mit „verweigern“ sperren,
 * - Plattform-Rechte (Recht, Override „erlauben“, Owner) geben Zugriff, auch ohne die alten Discord-Rechte.
 * Ist die Plattform nicht erreichbar (access = null), gilt das bisherige Verhalten.
 */
export type LegacyDecision = 'grant' | 'legacy' | 'disabled' | 'override-deny' | 'denied';

export function legacyAccess(input: {
  disabled: boolean;
  access: { allowed: boolean; source: string } | null;
  hasDiscordPermission: boolean;
}): LegacyDecision {
  if (input.disabled) return 'disabled';
  if (input.access?.source === 'override-deny') return 'override-deny';
  if (input.access?.allowed && input.access.source !== 'public') return 'grant';
  if (input.access?.allowed || input.hasDiscordPermission) return 'legacy';
  return 'denied';
}
