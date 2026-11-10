import { SlashCommandBuilder, type SlashCommandSubcommandBuilder } from 'discord.js';
import { defineCommand } from '../command';
import { embed, reply, table, trunc, ts, user } from '../ui';

const reasonOpt = (s: SlashCommandSubcommandBuilder) =>
  s.addStringOption((o) =>
    o.setName('grund').setDescription('Begründung').setRequired(true).setMinLength(3).setMaxLength(500),
  );
const severity = (s: SlashCommandSubcommandBuilder, name = 'prioritaet') =>
  s.addStringOption((o) =>
    o
      .setName(name)
      .setDescription('Priorität')
      .addChoices(
        { name: 'SEV1 – kritisch', value: 'sev1' },
        { name: 'SEV2 – hoch', value: 'sev2' },
        { name: 'SEV3 – mittel', value: 'sev3' },
        { name: 'SEV4 – niedrig', value: 'sev4' },
      ),
  );
const ENV_CHOICES = [
  { name: 'Entwicklung', value: 'development' },
  { name: 'Staging', value: 'staging' },
  { name: 'Produktion', value: 'production' },
];
const icon = (status: string) =>
  ({ up: '🟢', configured: '🟢', degraded: '🟡', down: '🔴', not_configured: '⚪', unknown: '⚪' })[status] ?? '⚪';

export const ops = defineCommand({
  data: new SlashCommandBuilder()
    .setName('ops')
    .setDescription('Betrieb & Monitoring')
    .addSubcommand((s) => s.setName('health').setDescription('Gesundheit aller Dienste'))
    .addSubcommand((s) => s.setName('metrics').setDescription('API-Messwerte'))
    .addSubcommand((s) => s.setName('dependencies').setDescription('Abhängigkeiten'))
    .addSubcommand((s) => s.setName('queue').setDescription('Warteschlangen und fehlgeschlagene Jobs'))
    .addSubcommand((s) => s.setName('alerts').setDescription('Aktive Warnungen')),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'health') {
      type H = {
        status: string;
        dependencies: Array<{ name: string; status: string; latencyMs: number | null }>;
        services: Array<{ service: string; status: string; ageSeconds: number | null; version: string | null }> | null;
        roblox: { connected: boolean; servers: number; playersOnline: number; lastHeartbeatAt: string | null } | null;
      };
      const h = await api.get<H>('/api/v1/monitoring/health');
      return reply(
        interaction,
        embed(h.status === 'up' ? 'success' : h.status === 'degraded' ? 'warning' : 'danger')
          .setTitle(`${icon(h.status)} Systemstatus: ${h.status}`)
          .addFields(
            {
              name: 'Dienste',
              value:
                h.services
                  ?.map(
                    (s) =>
                      `${icon(s.status)} ${s.service}${s.ageSeconds !== null ? ` (vor ${s.ageSeconds} s)` : ''}${s.version ? ` · ${s.version}` : ''}`,
                  )
                  .join('\n') || '–',
            },
            {
              name: 'Abhängigkeiten',
              value: h.dependencies
                .map((d) => `${icon(d.status)} ${d.name}${d.latencyMs !== null ? ` · ${d.latencyMs} ms` : ''}`)
                .join('\n'),
            },
            {
              name: 'Roblox',
              value: h.roblox
                ? h.roblox.connected
                  ? `🟢 ${h.roblox.servers} Server · ${h.roblox.playersOnline} Spieler`
                  : `🔴 nicht verbunden · letzter Heartbeat ${ts(h.roblox.lastHeartbeatAt, 'R')}`
                : '–',
            },
          ),
      );
    }
    if (sub === 'metrics') {
      const { api: m } = await api.get<{
        api: {
          uptimeSeconds: number;
          requestsTotal: number;
          errors5xx: number;
          latencyMs: { p50: number | null; p95: number | null };
          last5Minutes: { requests: number; errorRate: number | null };
          memoryMb: number;
        };
      }>('/api/v1/monitoring/metrics');
      return reply(
        interaction,
        embed()
          .setTitle('📈 API-Messwerte (diese Instanz)')
          .setDescription(
            table([
              ['Laufzeit', `${Math.round(m.uptimeSeconds / 60)} Min.`],
              ['Anfragen gesamt', String(m.requestsTotal)],
              ['5xx-Fehler', String(m.errors5xx)],
              ['Latenz p50 / p95', `${m.latencyMs.p50 ?? '–'} / ${m.latencyMs.p95 ?? '–'} ms`],
              [
                'Letzte 5 Min.',
                `${m.last5Minutes.requests} Anfragen, Fehlerquote ${m.last5Minutes.errorRate ?? '–'} %`,
              ],
              ['Speicher', `${m.memoryMb} MB`],
            ]),
          ),
      );
    }
    if (sub === 'dependencies') {
      const { items } = await api.get<{
        items: Array<{ name: string; status: string; latencyMs: number | null; error: string | null }>;
      }>('/api/v1/monitoring/dependencies');
      return reply(
        interaction,
        embed()
          .setTitle('🔗 Abhängigkeiten')
          .setDescription(
            items
              .map(
                (d) =>
                  `${icon(d.status)} **${d.name}** – ${d.status}${d.latencyMs !== null ? ` (${d.latencyMs} ms)` : ''}${d.error ? ` – ${d.error}` : ''}`,
              )
              .join('\n'),
          ),
      );
    }
    if (sub === 'queue') {
      const q = await api.get<{
        configured: boolean;
        queues: Record<string, Record<string, number>> | null;
        failed: Array<{ queue: string; name: string; failedReason: string; id: string }>;
      }>('/api/v1/monitoring/queues');
      if (!q.configured) return reply(interaction, '⚪ Keine Warteschlange konfiguriert (REDIS_URL fehlt).');
      return reply(
        interaction,
        embed()
          .setTitle('📬 Warteschlangen')
          .setDescription(
            Object.entries(q.queues ?? {})
              .map(
                ([n, c]) =>
                  `**${n}:** ${c.waiting} wartend · ${c.active} aktiv · ${c.delayed} geplant · ${c.failed} fehlgeschlagen`,
              )
              .join('\n'),
          )
          .addFields({
            name: 'Letzte Fehler',
            value:
              q.failed
                .slice(0, 5)
                .map((f) => `${f.queue}/${f.name} (#${f.id}): ${trunc(f.failedReason, 120)}`)
                .join('\n') || 'keine',
          }),
      );
    }
    const { items } = await api.get<{ items: Array<{ severity: string; message: string }> }>(
      '/api/v1/monitoring/alerts',
    );
    return reply(
      interaction,
      embed(items.some((a) => a.severity === 'critical') ? 'danger' : items.length ? 'warning' : 'success')
        .setTitle('🚨 Warnungen')
        .setDescription(
          items
            .map((a) => `${a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : 'ℹ️'} ${a.message}`)
            .join('\n') || '✅ Keine aktiven Warnungen.',
        ),
    );
  },
});

export const incident = defineCommand({
  data: new SlashCommandBuilder()
    .setName('incident')
    .setDescription('Vorfallsverwaltung')
    .addSubcommand((s) =>
      severity(
        s
          .setName('create')
          .setDescription('Vorfall eröffnen')
          .addStringOption((o) => o.setName('titel').setDescription('Titel').setRequired(true).setMaxLength(200)),
      ).addStringOption((o) => o.setName('beschreibung').setDescription('Beschreibung').setMaxLength(2000)),
    )
    .addSubcommand((s) =>
      s
        .setName('assign')
        .setDescription('Zuweisen')
        .addIntegerOption((o) => o.setName('id').setDescription('Nummer').setRequired(true))
        .addUserOption((o) => o.setName('nutzer').setDescription('Person').setRequired(true)),
    )
    .addSubcommand((s) =>
      severity(
        s
          .setName('update')
          .setDescription('Status/Kommentar')
          .addIntegerOption((o) => o.setName('id').setDescription('Nummer').setRequired(true))
          .addStringOption((o) =>
            o
              .setName('status')
              .setDescription('Status')
              .addChoices(
                { name: 'Offen', value: 'open' },
                { name: 'Untersuchung', value: 'investigating' },
                { name: 'Beobachtung', value: 'monitoring' },
              ),
          )
          .addStringOption((o) => o.setName('kommentar').setDescription('Kommentar').setMaxLength(2000)),
      ),
    )
    .addSubcommand((s) =>
      s
        .setName('resolve')
        .setDescription('Abschließen')
        .addIntegerOption((o) => o.setName('id').setDescription('Nummer').setRequired(true))
        .addStringOption((o) =>
          o.setName('loesung').setDescription('Ursache und Lösung').setRequired(true).setMaxLength(2000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription('Vorfälle anzeigen')
        .addIntegerOption((o) => o.setName('id').setDescription('Details zu einem Vorfall')),
    ),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    type I = {
      number: number;
      title: string;
      status: string;
      severity: string;
      assigneeId: string | null;
      createdAt: string;
    };
    if (sub === 'create') {
      const i = await api.post<I>(
        '/api/v1/incidents',
        {
          title: interaction.options.getString('titel', true),
          description: interaction.options.getString('beschreibung') ?? undefined,
          severity: interaction.options.getString('prioritaet') ?? undefined,
        },
        { idempotencyKey: `incident-${interaction.id}` },
      );
      return reply(interaction, `🚨 Vorfall **#${i.number}** eröffnet (${i.severity}).`, false);
    }
    if (sub === 'history') {
      const id = interaction.options.getInteger('id');
      if (id) {
        const d = await api.get<{
          incident: I & { description: string; resolution: string | null };
          events: Array<{ type: string; actorId: string | null; body: string | null; createdAt: string }>;
        }>(`/api/v1/incidents/${id}`);
        return reply(
          interaction,
          embed()
            .setTitle(`#${d.incident.number} ${d.incident.title}`)
            .setDescription(
              `${table([
                ['Status', d.incident.status],
                ['Priorität', d.incident.severity],
                ['Zuständig', user(d.incident.assigneeId)],
              ])}\n\n${d.events.map((e) => `${ts(e.createdAt, 'f')} ${e.type} ${user(e.actorId)}${e.body ? `: ${trunc(e.body, 150)}` : ''}`).join('\n')}`.slice(
                0,
                4000,
              ),
            ),
        );
      }
      const r = await api.get<{ items: I[] }>('/api/v1/incidents', { query: { pageSize: 15 } });
      return reply(
        interaction,
        embed()
          .setTitle('📒 Vorfälle')
          .setDescription(
            r.items
              .map((i) => `**#${i.number}** [${i.severity}] ${i.title} – ${i.status} ${user(i.assigneeId)}`)
              .join('\n') || 'Keine Vorfälle.',
          ),
      );
    }
    const id = interaction.options.getInteger('id', true);
    if (sub === 'resolve') {
      await api.post(`/api/v1/incidents/${id}/resolve`, { resolution: interaction.options.getString('loesung', true) });
      return reply(interaction, `✅ Vorfall #${id} abgeschlossen.`, false);
    }
    const body =
      sub === 'assign'
        ? { assigneeId: interaction.options.getUser('nutzer', true).id }
        : {
            status: interaction.options.getString('status') ?? undefined,
            severity: interaction.options.getString('prioritaet') ?? undefined,
            comment: interaction.options.getString('kommentar') ?? undefined,
          };
    const i = await api.patch<I>(`/api/v1/incidents/${id}`, body);
    return reply(
      interaction,
      `✅ Vorfall #${i.number}: ${i.status}, ${i.severity}${i.assigneeId ? `, zuständig ${user(i.assigneeId)}` : ''}.`,
    );
  },
});

export const feature = defineCommand({
  data: new SlashCommandBuilder()
    .setName('feature')
    .setDescription('Feature-Flags')
    .addSubcommand((s) => s.setName('list').setDescription('Alle Flags'))
    .addSubcommand((s) =>
      reasonOpt(
        s
          .setName('enable')
          .setDescription('Aktivieren')
          .addStringOption((o) => o.setName('name').setDescription('Flag').setRequired(true)),
      ),
    )
    .addSubcommand((s) =>
      reasonOpt(
        s
          .setName('disable')
          .setDescription('Deaktivieren')
          .addStringOption((o) => o.setName('name').setDescription('Flag').setRequired(true)),
      ),
    )
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Status eines Flags')
        .addStringOption((o) => o.setName('name').setDescription('Flag').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription('Änderungen eines Flags')
        .addStringOption((o) => o.setName('name').setDescription('Flag').setRequired(true)),
    ),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    type F = { key: string; enabled: boolean; description: string; updatedBy: string | null; updatedAt: string };
    if (sub === 'list' || sub === 'status') {
      const { items } = await api.get<{ items: F[] }>('/api/v1/flags');
      const name = interaction.options.getString('name');
      const list = name ? items.filter((f) => f.key === name) : items;
      if (name && !list.length) return reply(interaction, 'Unbekanntes Flag.');
      return reply(
        interaction,
        embed()
          .setTitle('🚩 Feature-Flags')
          .setDescription(
            list
              .map(
                (f) =>
                  `${f.enabled ? '🟢' : '⚫'} \`${f.key}\` – ${f.description}${name ? `\nZuletzt geändert ${ts(f.updatedAt)} von ${user(f.updatedBy)}` : ''}`,
              )
              .join('\n'),
          ),
      );
    }
    const name = interaction.options.getString('name', true);
    if (sub === 'history') {
      const { items } = await api.get<{
        items: Array<{
          version: number;
          value: { enabled: boolean } | null;
          actorId: string;
          reason: string | null;
          createdAt: string;
        }>;
      }>(`/api/v1/flags/${name}/history`);
      return reply(
        interaction,
        embed()
          .setTitle(`🕓 ${name}`)
          .setDescription(
            items
              .map(
                (v) =>
                  `v${v.version} ${ts(v.createdAt, 'f')} → ${v.value?.enabled ? 'an' : 'aus'} · ${user(v.actorId)}${v.reason ? ` – ${v.reason}` : ''}`,
              )
              .join('\n') || 'Keine Änderungen.',
          ),
      );
    }
    await api.put(`/api/v1/flags/${name}`, {
      enabled: sub === 'enable',
      reason: interaction.options.getString('grund', true),
    });
    return reply(interaction, `✅ \`${name}\` ist jetzt ${sub === 'enable' ? 'aktiv' : 'deaktiviert'}.`);
  },
});

export const killswitch = defineCommand({
  data: new SlashCommandBuilder()
    .setName('killswitch')
    .setDescription('Notfall-Kill-Switch')
    .addSubcommand((s) => s.setName('status').setDescription('Status anzeigen'))
    .addSubcommand((s) => reasonOpt(s.setName('activate').setDescription('Alle schreibenden Aktionen sofort sperren')))
    .addSubcommand((s) => reasonOpt(s.setName('deactivate').setDescription('Sperre aufheben'))),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') {
      const { items } = await api.get<{
        items: Array<{ key: string; enabled: boolean; updatedBy: string | null; updatedAt: string }>;
      }>('/api/v1/flags');
      const k = items.find((f) => f.key === 'kill_switch');
      return reply(
        interaction,
        k?.enabled ? `🛑 **Aktiv** seit ${ts(k.updatedAt)} (${user(k.updatedBy)})` : '🟢 Nicht aktiv.',
      );
    }
    await api.put('/api/v1/flags/kill_switch', {
      enabled: sub === 'activate',
      reason: interaction.options.getString('grund', true),
    });
    return reply(
      interaction,
      sub === 'activate'
        ? '🛑 Kill-Switch **aktiviert**. Schreibende Bot-Befehle und Roblox-Ereignisse sind gesperrt; Anmeldung und Lesezugriffe bleiben verfügbar.'
        : '🟢 Kill-Switch deaktiviert.',
      false,
    );
  },
});

export const deploy = defineCommand({
  data: new SlashCommandBuilder()
    .setName('deploy')
    .setDescription('Release-Management (über die CI/CD-Pipeline, keine Shell)')
    .addSubcommand((s) => s.setName('status').setDescription('Aktuelle Versionen und laufende Releases'))
    .addSubcommand((s) =>
      s
        .setName('prepare')
        .setDescription('Release vorbereiten')
        .addStringOption((o) => o.setName('version').setDescription('z. B. 1.4.0').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('umgebung')
            .setDescription('Ziel')
            .setRequired(true)
            .addChoices(...ENV_CHOICES),
        )
        .addStringOption((o) => o.setName('commit').setDescription('Commit-Hash'))
        .addStringOption((o) => o.setName('notizen').setDescription('Release-Notizen').setMaxLength(1500)),
    )
    .addSubcommand((s) =>
      reasonOpt(
        s
          .setName('approve')
          .setDescription('Release freigeben (andere Person als Vorbereiter)')
          .addIntegerOption((o) => o.setName('id').setDescription('Release-Nummer').setRequired(true)),
      ),
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription('Release-Historie')
        .addStringOption((o) =>
          o
            .setName('umgebung')
            .setDescription('Umgebung')
            .addChoices(...ENV_CHOICES),
        ),
    )
    .addSubcommand((s) =>
      reasonOpt(
        s
          .setName('rollback')
          .setDescription('Rollback auf eine frühere Version vorbereiten')
          .addStringOption((o) => o.setName('version').setDescription('Zielversion').setRequired(true))
          .addStringOption((o) =>
            o
              .setName('umgebung')
              .setDescription('Umgebung')
              .setRequired(true)
              .addChoices(...ENV_CHOICES),
          ),
      ),
    ),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    type R = {
      release: {
        number: number;
        version: string;
        status: string;
        kind: string;
        preparedBy: string;
        approvedBy: string | null;
        createdAt: string;
      };
      environmentKey: string;
    };
    if (sub === 'status' || sub === 'history') {
      const [envs, rel] = await Promise.all([
        api.get<{ items: Array<{ key: string; currentVersion: string | null }> }>('/api/v1/environments'),
        api.get<{ items: R[] }>('/api/v1/releases', {
          query: { environment: interaction.options.getString('umgebung') ?? undefined, limit: 15 },
        }),
      ]);
      const list =
        sub === 'status'
          ? rel.items.filter((r) => ['prepared', 'approved', 'deploying'].includes(r.release.status))
          : rel.items;
      return reply(
        interaction,
        embed()
          .setTitle(sub === 'status' ? '🚀 Deploy-Status' : '🗂️ Release-Historie')
          .setDescription(
            `${sub === 'status' ? `${envs.items.map((e) => `**${e.key}:** ${e.currentVersion ?? 'unbekannt'}`).join('\n')}\n\n` : ''}${list.map((r) => `#${r.release.number} ${r.release.kind} **${r.release.version}** → ${r.environmentKey}: ${r.release.status} (${user(r.release.preparedBy)}${r.release.approvedBy ? ` / ${user(r.release.approvedBy)}` : ''})`).join('\n') || 'Keine Releases.'}`,
          ),
      );
    }
    if (sub === 'approve') {
      const r = await api.post<{ number: number; status: string }>(
        `/api/v1/releases/${interaction.options.getInteger('id', true)}/approve`,
        { reason: interaction.options.getString('grund', true) },
      );
      return reply(
        interaction,
        `✅ Release #${r.number} freigegeben – die Pipeline wird angestoßen (sofern konfiguriert).`,
      );
    }
    const r = await api.post<{ number: number }>('/api/v1/releases', {
      version: interaction.options.getString('version', true),
      environment: interaction.options.getString('umgebung', true),
      commitSha: interaction.options.getString('commit') ?? undefined,
      notes: interaction.options.getString('notizen') ?? interaction.options.getString('grund') ?? undefined,
      kind: sub === 'rollback' ? 'rollback' : 'deploy',
    });
    return reply(
      interaction,
      `📝 Release #${r.number} vorbereitet. Eine **andere** Person muss es mit \`/deploy approve id:${r.number}\` freigeben.`,
    );
  },
});

export const env = defineCommand({
  data: new SlashCommandBuilder()
    .setName('env')
    .setDescription('Umgebungen')
    .addSubcommand((s) => s.setName('status').setDescription('Versionen je Umgebung'))
    .addSubcommand((s) =>
      s
        .setName('compare')
        .setDescription('Zwei Umgebungen vergleichen')
        .addStringOption((o) =>
          o
            .setName('a')
            .setDescription('Umgebung A')
            .setRequired(true)
            .addChoices(...ENV_CHOICES),
        )
        .addStringOption((o) =>
          o
            .setName('b')
            .setDescription('Umgebung B')
            .setRequired(true)
            .addChoices(...ENV_CHOICES),
        ),
    )
    .addSubcommand((s) => s.setName('config-diff').setDescription('Konfigurationsunterschiede Staging ↔ Produktion'))
    .addSubcommand((s) => s.setName('promote').setDescription('Staging-Version für Produktion vorbereiten'))
    .addSubcommand((s) => s.setName('history').setDescription('Release-Historie aller Umgebungen')),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') {
      const { items } = await api.get<{
        items: Array<{
          key: string;
          name: string;
          currentVersion: string | null;
          url: string | null;
          updatedAt: string;
          requiresApproval: boolean;
        }>;
      }>('/api/v1/environments');
      return reply(
        interaction,
        embed()
          .setTitle('🌍 Umgebungen')
          .setDescription(
            items
              .map(
                (e) =>
                  `**${e.name}** (${e.key}): ${e.currentVersion ?? 'keine Meldung'} · gemeldet ${ts(e.updatedAt, 'R')}${e.requiresApproval ? ' · Freigabe nötig' : ''}`,
              )
              .join('\n'),
          ),
      );
    }
    if (sub === 'history') {
      const { items } = await api.get<{
        items: Array<{
          release: { number: number; version: string; status: string; createdAt: string };
          environmentKey: string;
        }>;
      }>('/api/v1/releases', { query: { limit: 20 } });
      return reply(
        interaction,
        embed()
          .setTitle('🕓 Umgebungshistorie')
          .setDescription(
            items
              .map(
                (r) =>
                  `${ts(r.release.createdAt, 'd')} #${r.release.number} ${r.environmentKey}: ${r.release.version} (${r.release.status})`,
              )
              .join('\n') || 'Keine Releases.',
          ),
      );
    }
    const a = sub === 'compare' ? interaction.options.getString('a', true) : 'staging';
    const b = sub === 'compare' ? interaction.options.getString('b', true) : 'production';
    const d = await api.get<{
      a: { key: string; version: string | null };
      b: { key: string; version: string | null };
      configDiff: Array<{ path: string; before: unknown; after: unknown }>;
    }>('/api/v1/environments/compare', { query: { a, b } });
    if (sub === 'promote') {
      if (!d.a.version) return reply(interaction, 'Staging hat keine gemeldete Version.');
      const r = await api.post<{ number: number }>('/api/v1/releases', {
        version: d.a.version,
        environment: 'production',
        kind: 'promote',
        notes: `Promotion von Staging (${d.a.version})`,
      });
      return reply(
        interaction,
        `📝 Promotion **${d.a.version}** → Produktion als Release #${r.number} vorbereitet. Freigabe durch eine zweite Person mit \`/deploy approve\`.`,
      );
    }
    return reply(
      interaction,
      embed()
        .setTitle(`⚖️ ${d.a.key} ↔ ${d.b.key}`)
        .setDescription(
          `Version: ${d.a.version ?? '–'} ↔ ${d.b.version ?? '–'}\n\n${d.configDiff.map((c) => `**${c.path}:** ${JSON.stringify(c.before)} ↔ ${JSON.stringify(c.after)}`).join('\n') || 'Keine Konfigurationsunterschiede (nur nicht geheime Werte werden verglichen).'}`,
        ),
    );
  },
});

export const automation = defineCommand({
  data: new SlashCommandBuilder()
    .setName('automation')
    .setDescription('Automatisierungen')
    .addSubcommand((s) => s.setName('list').setDescription('Alle Regeln'))
    .addSubcommand((s) =>
      reasonOpt(
        s
          .setName('create')
          .setDescription('Regel anlegen')
          .addStringOption((o) => o.setName('name').setDescription('Name').setRequired(true).setMaxLength(100))
          .addStringOption((o) =>
            o
              .setName('ausloeser')
              .setDescription('Auslöser')
              .setRequired(true)
              .addChoices(
                { name: 'Backup fehlgeschlagen', value: 'backup_failed' },
                { name: 'Dienst ausgefallen', value: 'service_down' },
                { name: 'Release ausgerollt', value: 'release_deployed' },
                { name: 'Roblox nicht erreichbar', value: 'roblox_disconnected' },
                { name: 'Vorfall erstellt', value: 'incident_created' },
                { name: 'Hohe Fehlerquote', value: 'error_rate_high' },
              ),
          )
          .addStringOption((o) =>
            o
              .setName('aktion')
              .setDescription('Aktion')
              .setRequired(true)
              .addChoices(
                { name: 'Discord benachrichtigen', value: 'notify_discord' },
                { name: 'Vorfall eröffnen', value: 'create_incident' },
                { name: 'Health-Check ausführen', value: 'run_health_check' },
              ),
          )
          .addIntegerOption((o) =>
            o.setName('schwelle').setDescription('z. B. Anzahl Fehlschläge in Folge').setMinValue(1).setMaxValue(100),
          )
          .addIntegerOption((o) =>
            o.setName('cooldown').setDescription('Mindestabstand in Minuten (≥ 1)').setMinValue(1).setMaxValue(10080),
          )
          .addChannelOption((o) => o.setName('kanal').setDescription('Kanal für Benachrichtigungen')),
      ),
    )
    .addSubcommand((s) =>
      reasonOpt(
        s
          .setName('pause')
          .setDescription('Pausieren/fortsetzen')
          .addStringOption((o) => o.setName('id').setDescription('Regel-ID').setRequired(true))
          .addBooleanOption((o) => o.setName('fortsetzen').setDescription('Wieder aktivieren statt pausieren')),
      ),
    )
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('Probelauf ohne Wirkung')
        .addStringOption((o) => o.setName('id').setDescription('Regel-ID').setRequired(true))
        .addIntegerOption((o) => o.setName('anzahl').setDescription('Simulierter Zählwert')),
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription('Ausführungen')
        .addStringOption((o) => o.setName('id').setDescription('Regel-ID')),
    ),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const { items } = await api.get<{
        items: Array<{
          id: string;
          name: string;
          trigger: string;
          action: string;
          enabled: boolean;
          cooldownSeconds: number;
          lastFiredAt: string | null;
        }>;
      }>('/api/v1/automations');
      return reply(
        interaction,
        embed()
          .setTitle('⚙️ Automatisierungen')
          .setDescription(
            items
              .map(
                (a) =>
                  `${a.enabled ? '🟢' : '⏸️'} **${a.name}** (\`${a.id.slice(0, 8)}\`) – ${a.trigger} → ${a.action} · Cooldown ${Math.round(a.cooldownSeconds / 60)} Min. · zuletzt ${ts(a.lastFiredAt, 'R')}`,
              )
              .join('\n') || 'Keine Regeln.',
          ),
      );
    }
    if (sub === 'history') {
      const { items } = await api.get<{
        items: Array<{ status: string; createdAt: string; details: { summary?: string } | null }>;
      }>('/api/v1/automations/history', { query: { ruleId: interaction.options.getString('id') ?? undefined } });
      return reply(
        interaction,
        embed()
          .setTitle('🕓 Ausführungen')
          .setDescription(
            items
              .slice(0, 20)
              .map(
                (r) =>
                  `${ts(r.createdAt, 'f')} ${r.status}${r.details?.summary ? ` – ${trunc(r.details.summary, 80)}` : ''}`,
              )
              .join('\n') || 'Keine Ausführungen.',
          ),
      );
    }
    if (sub === 'create') {
      const r = await api.post<{ id: string }>('/api/v1/automations', {
        name: interaction.options.getString('name', true),
        trigger: interaction.options.getString('ausloeser', true),
        action: interaction.options.getString('aktion', true),
        conditions: interaction.options.getInteger('schwelle')
          ? { threshold: interaction.options.getInteger('schwelle') }
          : {},
        actionConfig: interaction.options.getChannel('kanal')
          ? { channelId: interaction.options.getChannel('kanal')!.id }
          : {},
        cooldownSeconds: (interaction.options.getInteger('cooldown') ?? 15) * 60,
        reason: interaction.options.getString('grund', true),
      });
      return reply(interaction, `✅ Regel angelegt (\`${r.id}\`).`);
    }
    const id = await resolveRuleId(api, interaction.options.getString('id', true));
    if (sub === 'test') {
      const r = await api.post<{ matches: boolean; wouldRun: boolean; cooldownUntil: string | null }>(
        `/api/v1/automations/${id}/test`,
        { count: interaction.options.getInteger('anzahl') ?? undefined },
      );
      return reply(
        interaction,
        `🧪 Bedingungen erfüllt: ${r.matches ? 'ja' : 'nein'} · würde ausgeführt: ${r.wouldRun ? 'ja' : 'nein'}${r.cooldownUntil ? ` · Cooldown bis ${ts(r.cooldownUntil)}` : ''}`,
      );
    }
    const resume = interaction.options.getBoolean('fortsetzen') ?? false;
    await api.post(`/api/v1/automations/${id}/enabled`, {
      enabled: resume,
      reason: interaction.options.getString('grund', true),
    });
    return reply(interaction, resume ? '▶️ Regel fortgesetzt.' : '⏸️ Regel pausiert.');
  },
});

/** Erlaubt die Angabe der gekürzten ID aus /automation list. */
async function resolveRuleId(api: { get: <T>(p: string) => Promise<T> }, input: string) {
  if (input.length === 36) return input;
  const { items } = await api.get<{ items: Array<{ id: string }> }>('/api/v1/automations');
  const match = items.filter((i) => i.id.startsWith(input));
  if (match.length !== 1) throw new Error('Regel nicht eindeutig gefunden.');
  return match[0]!.id;
}

export const backup = defineCommand({
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Backups')
    .addSubcommand((s) => s.setName('status').setDescription('Backup-Status'))
    .addSubcommand((s) => s.setName('run').setDescription('Backup jetzt erstellen')),
  async execute(interaction, { api }) {
    if (interaction.options.getSubcommand() === 'run') {
      await api.post('/api/v1/backups/run');
      return reply(
        interaction,
        '✅ Backup angestoßen. Es gilt erst nach erfolgreicher Integritätsprüfung als erfolgreich – siehe `/backup status`.',
      );
    }
    const r = await api.get<{
      health: { lastSuccessAt: string | null; consecutiveFailures: number };
      items: Array<{ status: string; startedAt: string; sizeBytes: number | null; error: string | null }>;
    }>('/api/v1/backups');
    return reply(
      interaction,
      embed(r.health.consecutiveFailures ? 'warning' : 'success')
        .setTitle('💾 Backups')
        .setDescription(
          `Letztes geprüftes Backup: ${ts(r.health.lastSuccessAt)}\nFehlschläge in Folge: ${r.health.consecutiveFailures}\n\n${r.items
            .slice(0, 8)
            .map(
              (b) =>
                `${ts(b.startedAt, 'f')} ${b.status}${b.sizeBytes ? ` · ${(b.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ''}${b.error ? ` – ${trunc(b.error, 80)}` : ''}`,
            )
            .join('\n')}`,
        ),
    );
  },
});

export const status = defineCommand({
  data: new SlashCommandBuilder().setName('status').setDescription('Status des Roblox-Servers und der Plattform'),
  defer: 'public',
  async execute(interaction, { api }) {
    const [s, m] = await Promise.all([
      api.get<{ status: string; roblox: { connected: boolean; playersOnline: number } | null }>('/api/v1/status'),
      api.get<{ current: { active: boolean; window: { message: string; endsAt: string } | null } }>(
        '/api/v1/maintenance',
      ),
    ]);
    return interaction.editReply({
      embeds: [
        embed(s.roblox?.connected ? 'success' : 'muted')
          .setTitle('🎮 Serverstatus')
          .setDescription(
            table([
              [
                'Roblox-Server',
                s.roblox?.connected ? `🟢 online · ${s.roblox.playersOnline} Spieler` : '⚫ derzeit keine Verbindung',
              ],
              ['Plattform', `${icon(s.status)} ${s.status}`],
              ['Wartung', m.current.active ? `🛠️ ${m.current.window?.message ?? 'aktiv'}` : 'keine'],
            ]),
          ),
      ],
    });
  },
});
