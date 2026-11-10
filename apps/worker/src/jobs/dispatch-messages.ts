import { bolo, dispatch, type CoreContext } from '@enrp/core';
import { dispatchAssignments, dispatchUnits, eq, isNull, and } from '@enrp/database';

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

const BOLO_PRIORITY = { 1: '🔴 Hoch', 2: '🟠 Mittel', 3: '🟢 Niedrig' } as Record<number, string>;
const serverLabel = (hit: bolo.BoloHit) =>
  `${hit.serverType === 'private' ? '🔒 Privat' : hit.serverType === 'reserved' ? '🔐 Reserviert' : '🌐 Öffentlich'} · \`${hit.jobId.slice(0, 8)}\``;

/** Treffermeldung einer Fahndung (BOLO) mit Button „Erledigt“. */
export async function boloHitMessage(ctx: CoreContext, boloId: string) {
  const b = await bolo.getBolo(ctx.db, boloId);
  const hit = b.lastHit as bolo.BoloHit | null;
  const target =
    b.kind === 'person'
      ? `👤 **${plain(b.personName ?? String(b.robloxUserId))}** (\`${b.robloxUserId}\`)`
      : `🚗 Kennzeichen **${plain(b.plate)}**${b.vehicleDescription ? ` · ${plain(b.vehicleDescription)}` : ''}`;
  const fields = [
    { name: 'Gesucht', value: target, inline: false },
    { name: 'Grund', value: plain(b.reason) || '—', inline: false },
    { name: 'Priorität', value: BOLO_PRIORITY[b.priority] ?? String(b.priority), inline: true },
    { name: 'Treffer', value: String(b.hitCount), inline: true },
  ];
  if (hit) {
    fields.push({ name: 'Server', value: serverLabel(hit), inline: true });
    if (hit.vehicle)
      fields.push({
        name: 'Fahrzeug',
        value: `${plain(hit.vehicle.model)} [${plain(hit.vehicle.plate ?? '—')}]${hit.vehicle.color ? ` · ${plain(hit.vehicle.color)}` : ''}`,
        inline: true,
      });
    if (hit.player)
      fields.push({
        name: b.kind === 'vehicle' ? 'Besitzer im Spiel' : 'Im Spiel',
        value: `${plain(hit.player.username)} · ${plain(hit.player.team ?? 'ohne Team')}${hit.player.wanted ? ` · ⭐${hit.player.wanted}` : ''}`,
        inline: true,
      });
  }
  return {
    bolo: b,
    message: {
      embed: {
        title: `🔎 Fahndungstreffer · BOLO #${b.number}`,
        description:
          b.kind === 'person'
            ? 'Die gesuchte Person ist gerade im Spiel.'
            : 'Ein gesuchtes Kennzeichen ist gerade im Spiel unterwegs.',
        color: b.priority === 1 ? '#dc2626' : '#ea580c',
        fields,
        footer: 'Fahndung · Treffer aus der Live-Lage des Spiels',
      },
      buttons:
        b.status === 'active'
          ? [{ customId: `bolo:resolve:${b.id}`, label: 'Erledigt', emoji: '✅', style: 'success' as const }]
          : [],
    },
  };
}
