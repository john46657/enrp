import { bolo, dispatch, type CoreContext } from '@enrp/core';
import { dispatchAssignments, dispatchUnits, eq, isNull, and, robloxUsers } from '@enrp/database';

/**
 * Discord-Nachrichten der Leitstelle. Buttons werden vom Bot ausgewertet (cad:…, mc:…), der wiederum nur die API
 * aufruft – Rechte und Audit gelten also genauso wie im Dashboard.
 */

/** Spielertext entschärfen: keine Formatierung, keine Erwähnungen, keine anklickbaren Links. */
export const plain = (text: string | null | undefined) =>
  String(text ?? '')
    .replace(/([\\*_`~|>[\]()])/g, '\\$1')
    .replace(/@/g, '@​')
    .replace(/https?:\/\//gi, (m) => m.replace('//', '/​/'));

const PRIORITY = { 1: '🔴 P1 · Hoch', 2: '🟠 P2 · Mittel', 3: '🟢 P3 · Niedrig' } as Record<number, string>;
const COLOR: Record<string, string> = {
  open: '#dc2626',
  assigned: '#ea580c',
  en_route: '#ca8a04',
  on_scene: '#16a34a',
  closed: '#4b5563',
};

export async function dispatchMessage(ctx: CoreContext, incidentId: string) {
  const incident = await dispatch.getIncident(ctx.db, incidentId);
  const units = await ctx.db
    .select({ unitId: dispatchAssignments.unitId, callsign: dispatchUnits.callsign })
    .from(dispatchAssignments)
    .leftJoin(dispatchUnits, eq(dispatchUnits.unitId, dispatchAssignments.unitId))
    .where(and(eq(dispatchAssignments.incidentId, incident.id), isNull(dispatchAssignments.releasedAt)));
  const open = dispatch.isOpenStatus(incident.status);
  const source =
    incident.source === 'ingame'
      ? `🎮 **Ingame-Notruf**${incident.callNumber ? ` #${incident.callNumber}` : ''} von ${plain(incident.callerName ?? String(incident.callerRobloxId))}`
      : '📝 **Einsatz der Leitstelle** (eigene Daten, nicht aus dem Spiel)';
  const fields = [
    { name: 'Status', value: dispatch.STATUS_LABEL[incident.status], inline: true },
    { name: 'Priorität', value: PRIORITY[incident.priority] ?? String(incident.priority), inline: true },
    { name: 'Bereich', value: incident.department, inline: true },
    { name: 'Ort', value: plain(incident.location) || '—', inline: true },
    {
      name: 'Einheiten',
      value:
        units.map((u) => (u.callsign ? `**${plain(u.callsign)}** (<@${u.unitId}>)` : `<@${u.unitId}>`)).join('\n') ||
        '—',
      inline: true,
    },
  ];
  if (incident.report) fields.push({ name: '📄 Einsatzbericht', value: plain(incident.report), inline: false });
  return {
    incident,
    message: {
      embed: {
        title: `🚨 Einsatz #${incident.number} · ${plain(incident.title)}`,
        description: `${source}\n\n${plain(incident.description) || '—'}`,
        color: COLOR[incident.status] ?? '#2563eb',
        fields,
        footer: `Leitstelle · ${incident.source === 'ingame' ? 'Quelle: Spiel' : 'Quelle: Discord/Dashboard'}`,
      },
      buttons: open
        ? [
            { customId: `cad:take:${incident.id}`, label: 'Übernehmen', emoji: '🚓', style: 'primary' as const },
            { customId: `cad:enroute:${incident.id}`, label: 'Anfahrt', emoji: '🟨', style: 'secondary' as const },
            { customId: `cad:onscene:${incident.id}`, label: 'Vor Ort', emoji: '🟩', style: 'success' as const },
            { customId: `cad:close:${incident.id}`, label: 'Abschließen', emoji: '✅', style: 'danger' as const },
          ]
        : [],
    },
  };
}

const MOD_COLOR: Record<string, string> = { open: '#dc2626', claimed: '#16a34a', closed: '#4b5563' };
const MOD_LABEL: Record<string, string> = { open: 'Offen', claimed: 'Übernommen', closed: 'Geschlossen' };

export async function modCallMessage(ctx: CoreContext, modCallId: string) {
  const call = await dispatch.getModCall(ctx.db, modCallId);
  const fields = [
    {
      name: 'Spieler',
      value: `${plain(call.username ?? String(call.robloxUserId))} (\`${call.robloxUserId}\`)`,
      inline: true,
    },
    { name: 'Status', value: MOD_LABEL[call.status] ?? call.status, inline: true },
  ];
  if (call.claimedBy) fields.push({ name: 'Übernommen von', value: `<@${call.claimedBy}>`, inline: true });
  if (call.note) fields.push({ name: 'Notiz', value: plain(call.note), inline: false });
  return {
    call,
    message: {
      embed: {
        title: `🆘 Mod-Call #${call.number}`,
        description: plain(call.text) || 'Ohne Beschreibung',
        color: MOD_COLOR[call.status] ?? '#2563eb',
        fields,
        footer: 'Mod-Call aus dem Spiel',
      },
      buttons:
        call.status === 'closed'
          ? []
          : [
              ...(call.status === 'open'
                ? [{ customId: `mc:claim:${call.id}`, label: 'Übernehmen', emoji: '🙋', style: 'primary' as const }]
                : []),
              { customId: `mc:close:${call.id}`, label: 'Schließen', emoji: '✅', style: 'secondary' as const },
            ],
    },
  };
}

/** Fahndung: Neuanlage oder Treffer im Spiel (mit Ort und Besitzer bzw. Team). */
export async function boloMessage(ctx: CoreContext, boloId: string, kind: 'created' | 'hit') {
  const row = await bolo.getBolo(ctx.db, boloId);
  const [user] = row.robloxUserId
    ? await ctx.db.select().from(robloxUsers).where(eq(robloxUsers.id, row.robloxUserId))
    : [];
  const b = { ...row, username: user?.username ?? null };
  const target =
    b.kind === 'vehicle'
      ? `🚗 Kennzeichen **${plain(b.plate)}**`
      : `👤 Spieler **${plain(b.username ?? String(b.robloxUserId))}** (\`${b.robloxUserId}\`)`;
  const fields = [{ name: 'Grund', value: plain(b.reason), inline: false }];
  if (b.description) fields.push({ name: 'Beschreibung', value: plain(b.description), inline: false });
  const hit = (b.lastHit ?? null) as Record<string, string | number | null> | null;
  if (kind === 'hit' && hit) {
    const details =
      b.kind === 'vehicle'
        ? `${plain(String(hit.model ?? 'Fahrzeug'))}${hit.color ? ` · ${plain(String(hit.color))}` : ''}${
            hit.ownerName ? `\nBesitzer: ${plain(String(hit.ownerName))}` : ''
          }`
        : `${plain(String(hit.username ?? ''))}${hit.team ? ` · Team ${plain(String(hit.team))}` : ''}`;
    fields.unshift({ name: '📍 Gesichtet im Spiel', value: details || '—', inline: false });
  }
  return {
    bolo: b,
    message: {
      embed: {
        title: kind === 'hit' ? `🚨 Fahndungstreffer · BOLO #${b.number}` : `🔎 Neue Fahndung · BOLO #${b.number}`,
        description: target,
        color: kind === 'hit' ? '#dc2626' : '#ca8a04',
        fields,
        footer: kind === 'hit' ? `Treffer Nr. ${b.hitCount} · Live-Lage aus dem Spiel` : 'Fahndung der Leitstelle',
      },
      buttons:
        b.status === 'active'
          ? [{ customId: `bolo:clear:${b.id}`, label: 'Fahndung aufheben', emoji: '✅', style: 'secondary' as const }]
          : [],
    },
  };
}
