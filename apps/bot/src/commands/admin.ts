import { AttachmentBuilder, SlashCommandBuilder, type SlashCommandSubcommandBuilder } from 'discord.js';
import { defineCommand } from '../command';
import { embed, reply, table, trunc, ts, user } from '../ui';

const reasonOpt = (s: SlashCommandSubcommandBuilder) => s.addStringOption((o) => o.setName('grund').setDescription('Begründung').setRequired(true).setMinLength(3).setMaxLength(500));
const commandOpt = (s: SlashCommandSubcommandBuilder) => s.addStringOption((o) => o.setName('befehl').setDescription('Befehl, z. B. "mod" oder "mod ban"').setRequired(true).setMaxLength(60));

type ApprovalResult = { status: 'approval_required'; approval: { number: number } } | { status: 'applied' };
const approvalText = (r: ApprovalResult) =>
  r.status === 'approval_required' ? `⏳ Kritische Änderung – Freigabeanfrage **#${r.approval.number}** wurde angelegt. Eine zweite Person muss sie mit \`/approval approve\` genehmigen.` : '✅ Übernommen.';

export const permissions = defineCommand({
  data: new SlashCommandBuilder()
    .setName('permissions')
    .setDescription('Befehlsrechte verwalten')
    .addSubcommand((s) => commandOpt(s.setName('view').setDescription('Rechte und Overrides eines Befehls')))
    .addSubcommand((s) => reasonOpt(commandOpt(s.setName('grant').setDescription('Discord-Rolle für Befehl freischalten').addRoleOption((o) => o.setName('rolle').setDescription('Discord-Rolle').setRequired(true)))))
    .addSubcommand((s) => reasonOpt(commandOpt(s.setName('revoke').setDescription('Befehl für Discord-Rolle sperren').addRoleOption((o) => o.setName('rolle').setDescription('Discord-Rolle').setRequired(true)))))
    .addSubcommand((s) => commandOpt(s.setName('test').setDescription('Darf eine Person den Befehl nutzen?').addUserOption((o) => o.setName('nutzer').setDescription('Person').setRequired(true))))
    .addSubcommand((s) => reasonOpt(commandOpt(s.setName('reset').setDescription('Alle Overrides des Befehls entfernen')))),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    const command = interaction.options.getString('befehl', true).trim().toLowerCase().replace(/^\//, '');
    if (sub === 'view') {
      const d = await api.get<{ defaultPermission: string | null; locked: boolean; subcommands: Array<{ command: string; permission: string | null; locked: boolean }>; overrides: Array<{ discordRoleId: string; effect: string; reason: string | null }> }>(
        '/api/v1/permissions/commands',
        { query: { command } },
      );
      return reply(
        interaction,
        embed()
          .setTitle(`🔐 /${command}`)
          .setDescription(
            table([
              ['Standardrecht', d.defaultPermission ? `\`${d.defaultPermission}\`` : d.subcommands.length ? 'je Unterbefehl' : 'für alle'],
              ['Gesperrt für Overrides', d.locked ? 'ja' : 'nein'],
              ['Overrides', d.overrides.map((o) => `<@&${o.discordRoleId}> → ${o.effect}`).join(', ') || 'keine'],
            ]) + (d.subcommands.length ? `\n\n${d.subcommands.map((s) => `\`/${s.command}\` → ${s.permission ?? 'alle'}${s.locked ? ' 🔒' : ''}`).join('\n')}` : ''),
          ),
      );
    }
    if (sub === 'test') {
      const target = interaction.options.getUser('nutzer', true);
      const member = await interaction.guild?.members.fetch(target.id).catch(() => null);
      const r = await api.post<{ allowed: boolean; source: string; permission: string | null; roles: string[] }>('/api/v1/permissions/test', {
        discordUserId: target.id,
        roleIds: member ? [...member.roles.cache.keys()].filter((id) => id !== interaction.guildId) : undefined,
        command,
      });
      return reply(interaction, `${r.allowed ? '✅ erlaubt' : '⛔ nicht erlaubt'} – Quelle: ${r.source}${r.permission ? `, Recht \`${r.permission}\`` : ''}. Plattform-Rollen: ${r.roles.join(', ') || 'keine'}`);
    }
    const reason = interaction.options.getString('grund', true);
    if (sub === 'reset') {
      const r = await api.post<{ removed: number }>('/api/v1/permissions/commands/reset', { command, reason });
      return reply(interaction, `✅ ${r.removed} Override(s) für /${command} entfernt.`);
    }
    const role = interaction.options.getRole('rolle', true);
    await api.post('/api/v1/permissions/commands/override', { command, discordRoleId: role.id, effect: sub === 'grant' ? 'allow' : 'deny', reason });
    return reply(interaction, `✅ /${command} ist für <@&${role.id}> jetzt **${sub === 'grant' ? 'freigeschaltet' : 'gesperrt'}**.`);
  },
});

export const approval = defineCommand({
  data: new SlashCommandBuilder()
    .setName('approval')
    .setDescription('Freigabezentrum (Vier-Augen-Prinzip)')
    .addSubcommand((s) => s.setName('pending').setDescription('Offene Freigabeanfragen'))
    .addSubcommand((s) => s.setName('view').setDescription('Anfrage anzeigen').addIntegerOption((o) => o.setName('nummer').setDescription('Nummer').setRequired(true)))
    .addSubcommand((s) => reasonOpt(s.setName('approve').setDescription('Genehmigen und ausführen').addIntegerOption((o) => o.setName('nummer').setDescription('Nummer').setRequired(true))))
    .addSubcommand((s) => reasonOpt(s.setName('reject').setDescription('Ablehnen').addIntegerOption((o) => o.setName('nummer').setDescription('Nummer').setRequired(true))))
    .addSubcommand((s) =>
      reasonOpt(
        s
          .setName('create')
          .setDescription('Plattform-Rolle einer Discord-Rolle zuweisen (kritische Rollen → Freigabe)')
          .addStringOption((o) => o.setName('plattformrolle').setDescription('Schlüssel, z. B. moderation').setRequired(true))
          .addRoleOption((o) => o.setName('rolle').setDescription('Discord-Rolle').setRequired(true)),
      ),
    ),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    type A = { number: number; summary: string; status: string; requestedBy: string; reason: string; expiresAt: string; actionType: string; decidedBy: string | null; decisionReason: string | null };
    if (sub === 'pending') {
      const { items } = await api.get<{ items: A[] }>('/api/v1/approvals', { query: { status: 'pending' } });
      return reply(interaction, embed('warning').setTitle(`⏳ Offene Freigaben (${items.length})`).setDescription(items.map((a) => `**#${a.number}** ${a.summary} – von ${user(a.requestedBy)}, läuft ${ts(a.expiresAt, 'R')} ab`).join('\n') || 'Keine offenen Anfragen.'));
    }
    if (sub === 'create') {
      const roles = await api.get<{ items: Array<{ id: string; key: string }> }>('/api/v1/permissions/roles');
      const key = interaction.options.getString('plattformrolle', true);
      const role = roles.items.find((r) => r.key === key);
      if (!role) return reply(interaction, `Unbekannte Plattform-Rolle. Verfügbar: ${roles.items.map((r) => r.key).join(', ')}`);
      const r = await api.post<ApprovalResult>('/api/v1/permissions/bindings', { roleId: role.id, discordRoleId: interaction.options.getRole('rolle', true).id, reason: interaction.options.getString('grund', true) });
      return reply(interaction, approvalText(r));
    }
    const number = interaction.options.getInteger('nummer', true);
    if (sub === 'view') {
      const a = await api.get<A>(`/api/v1/approvals/${number}`);
      return reply(
        interaction,
        embed().setTitle(`Freigabe #${a.number}`).setDescription(table([['Aktion', a.summary], ['Typ', a.actionType], ['Status', a.status], ['Beantragt von', user(a.requestedBy)], ['Begründung', a.reason], ['Läuft ab', ts(a.expiresAt)], ...(a.decidedBy ? [['Entschieden von', `${user(a.decidedBy)}: ${a.decisionReason ?? ''}`] as [string, string]] : [])])),
      );
    }
    const a = await api.post<A>(`/api/v1/approvals/${number}/decide`, { decision: sub, reason: interaction.options.getString('grund', true) }, { idempotencyKey: `approval-${interaction.id}` });
    return reply(interaction, `✅ Freigabe #${a.number} ist jetzt **${a.status}**.`);
  },
});

export const audit = defineCommand({
  data: new SlashCommandBuilder()
    .setName('audit')
    .setDescription('Audit-Log')
    .addSubcommand((s) =>
      s
        .setName('search')
        .setDescription('Einträge suchen')
        .addUserOption((o) => o.setName('akteur').setDescription('Handelnde Person'))
        .addStringOption((o) => o.setName('aktion').setDescription('Aktion (Präfix), z. B. moderation.'))
        .addIntegerOption((o) => o.setName('tage').setDescription('Zeitraum in Tagen').setMinValue(1).setMaxValue(365)),
    )
    .addSubcommand((s) => s.setName('diff').setDescription('Vorher/Nachher eines Eintrags').addIntegerOption((o) => o.setName('id').setDescription('Eintrag').setRequired(true)))
    .addSubcommand((s) => reasonOpt(s.setName('export').setDescription('Export als JSON (max. 31 Tage)').addIntegerOption((o) => o.setName('tage').setDescription('Zeitraum in Tagen').setRequired(true).setMinValue(1).setMaxValue(31))))
    .addSubcommand((s) => s.setName('verify').setDescription('Hash-Kette auf Manipulation prüfen'))
    .addSubcommand((s) => s.setName('retention').setDescription('Aufbewahrungsfrist des Audit-Logs')),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'search') {
      const days = interaction.options.getInteger('tage');
      const r = await api.get<{ items: Array<{ id: number; occurredAt: string; actorId: string | null; action: string; resourceType: string; resourceId: string | null; reason: string | null }>; total: number }>('/api/v1/audit', {
        query: { actorId: interaction.options.getUser('akteur')?.id, action: interaction.options.getString('aktion') ?? undefined, from: days ? new Date(Date.now() - days * 86400_000).toISOString() : undefined, pageSize: 20 },
      });
      return reply(interaction, embed().setTitle(`🧾 Audit (${r.total})`).setDescription(r.items.map((e) => `\`${e.id}\` ${ts(e.occurredAt, 'd')} **${e.action}** ${e.resourceType}${e.resourceId ? `:${e.resourceId.slice(0, 8)}` : ''} · ${user(e.actorId)}${e.reason ? ` – ${trunc(e.reason, 60)}` : ''}`).join('\n') || 'Keine Einträge.'));
    }
    if (sub === 'diff') {
      const r = await api.get<{ event: { action: string; reason: string | null }; diff: Array<{ path: string; before: unknown; after: unknown }> }>(`/api/v1/audit/${interaction.options.getInteger('id', true)}`);
      return reply(interaction, embed().setTitle(`🔍 ${r.event.action}`).setDescription(r.diff.map((d) => `**${d.path}:** \`${trunc(JSON.stringify(d.before), 150)}\` → \`${trunc(JSON.stringify(d.after), 150)}\``).join('\n').slice(0, 4000) || 'Keine Feldänderungen gespeichert.'));
    }
    if (sub === 'verify') {
      const r = await api.get<{ ok: boolean; checked: number; brokenAt?: { id: number; reason: string } }>('/api/v1/audit/verify');
      return reply(interaction, r.ok ? `✅ Hash-Kette intakt (${r.checked} Einträge geprüft).` : `🚨 Manipulation erkannt bei Eintrag ${r.brokenAt?.id}: ${r.brokenAt?.reason}`);
    }
    if (sub === 'retention') {
      const r = await api.get<{ rule: { days: number; rows: number } | undefined; oldestEntry: string | null }>('/api/v1/audit/retention');
      return reply(interaction, `Aufbewahrung: **${r.rule?.days ?? '?'} Tage**. Ältester Eintrag: ${ts(r.oldestEntry, 'd')}. Bei der nächsten Bereinigung betroffen: ${r.rule?.rows ?? 0}.`);
    }
    const days = interaction.options.getInteger('tage', true);
    const r = await api.post<{ total: number; truncated: boolean }>('/api/v1/audit/export', { from: new Date(Date.now() - days * 86400_000).toISOString(), to: new Date().toISOString(), reason: interaction.options.getString('grund', true) });
    const file = new AttachmentBuilder(Buffer.from(JSON.stringify(r, null, 2)), { name: `audit-${days}d.json` });
    return interaction.editReply({ content: `📦 ${r.total} Einträge${r.truncated ? ' (gekürzt auf 10 000)' : ''}. Der Export wurde protokolliert.`, files: [file] });
  },
});

export const data = defineCommand({
  data: new SlashCommandBuilder()
    .setName('data')
    .setDescription('Datenschutz')
    .addSubcommand((s) => s.setName('inspect').setDescription('Gespeicherte Daten einer Person (Übersicht)').addUserOption((o) => o.setName('nutzer').setDescription('Person')).addStringOption((o) => o.setName('roblox').setDescription('Roblox-ID')))
    .addSubcommand((s) => reasonOpt(s.setName('export').setDescription('Datenauskunft erstellen').addUserOption((o) => o.setName('nutzer').setDescription('Person')).addStringOption((o) => o.setName('roblox').setDescription('Roblox-ID'))))
    .addSubcommand((s) => reasonOpt(s.setName('deletion-request').setDescription('Löschantrag (Vier-Augen-Freigabe)').addUserOption((o) => o.setName('nutzer').setDescription('Person')).addStringOption((o) => o.setName('roblox').setDescription('Roblox-ID'))))
    .addSubcommand((s) => s.setName('retention').setDescription('Aufbewahrungsfristen'))
    .addSubcommand((s) => s.setName('cleanup-preview').setDescription('Was die nächste Bereinigung löschen würde')),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'retention' || sub === 'cleanup-preview') {
      const { items } = await api.get<{ items: Array<{ label: string; days: number; rows: number }> }>('/api/v1/privacy/retention');
      return reply(interaction, embed().setTitle(sub === 'retention' ? '🗄️ Aufbewahrungsfristen' : '🧹 Vorschau Bereinigung').setDescription(items.map((i) => `**${i.label}:** ${i.days} Tage${sub === 'cleanup-preview' ? ` → ${i.rows} Einträge` : ''}`).join('\n')));
    }
    const roblox = interaction.options.getString('roblox');
    const subject = { discordUserId: interaction.options.getUser('nutzer')?.id, robloxUserId: roblox && /^\d+$/.test(roblox) ? Number(roblox) : undefined };
    if (!subject.discordUserId && !subject.robloxUserId) return reply(interaction, 'Bitte Nutzer oder Roblox-ID angeben.');
    if (sub === 'inspect') {
      const r = await api.post<{ categories: Record<string, number> }>('/api/v1/privacy/inspect', subject);
      return reply(interaction, embed().setTitle('🔎 Gespeicherte Daten').setDescription(Object.entries(r.categories).filter(([, v]) => v > 0).map(([k, v]) => `**${k}:** ${v}`).join('\n') || 'Keine Daten gefunden.'));
    }
    const reason = interaction.options.getString('grund', true);
    if (sub === 'export') {
      const r = await api.post<{ id: string; number: number; expiresAt: string }>('/api/v1/privacy/export', { ...subject, reason });
      return reply(interaction, `✅ Datenauskunft #${r.number} erstellt. Download im Dashboard unter Datenschutz (verfügbar bis ${ts(r.expiresAt)}).`);
    }
    const r = await api.post<{ approval: { number: number } }>('/api/v1/privacy/deletion', { ...subject, reason });
    return reply(interaction, `⏳ Löschantrag angelegt. Freigabe **#${r.approval.number}** muss von einer zweiten Person genehmigt werden.`);
  },
});
