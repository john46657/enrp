// JSON-API des Dashboards. Jede Anfrage kommt von einem eingeloggten Discord-Nutzer (session.id).
// Rechte wie in Discord:
//   admin   = Staff-Rolle oder „Server verwalten“ → Bewerbungsarten, Panels, alles andere
//   manager = Manager-Rolle mindestens einer Bewerbungsart → Bewerbungen dieser Arten, Sperren, Statistik
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { forGuild } = require('../lib/settings');
const { embed, isStaff, sendTo } = require('../lib/util');
const { save, nextNumber } = require('../lib/db');
const store = require('../lib/applications/store');
const admin = require('../lib/applications/admin');
const templates = require('../lib/applications/templates');
const decisions = require('../lib/applications/decide');
const { QUESTION_TYPES, renderMessage } = require('../lib/applications/forms');
const { postPanel, refreshPanels } = require('../lib/applications/messages');
const { teamChannelId } = require('../lib/applications/flow');
const { buildStats } = require('../lib/applications/stats');
const { findRobloxUser } = require('../lib/applications/roblox');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const deny = (message = 'Keine Berechtigung.') => {
  throw new HttpError(403, message);
};
const bad = (message) => {
  throw new HttpError(400, message);
};

// ---------- Zugriff ----------

async function access(client, guildId, userId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new HttpError(404, 'Den Server gibt es nicht oder der Bot ist dort nicht.');
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) deny('Du bist nicht auf diesem Server.');
  const isAdmin = isStaff(member);
  const isManager = isAdmin || store.managesAny(member);
  if (!isManager) deny('Du hast auf diesem Server keine Rechte für Bewerbungen.');
  return { guild, member, isAdmin };
}

async function guildsFor(client, userId) {
  const list = [];
  for (const guild of client.guilds.cache.values()) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    const isAdmin = isStaff(member);
    if (!isAdmin && !store.managesAny(member)) continue;
    list.push({ id: guild.id, name: guild.name, icon: guild.iconURL({ size: 64 }), isAdmin });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Eingaben bereinigen ----------

const str = (value, max, fallback = '') => (typeof value === 'string' ? value.trim().slice(0, max) : fallback);
const int = (value, min, max, name) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) bad(`${name} muss eine ganze Zahl von ${min} bis ${max} sein.`);
  return n;
};
const ids = (value, valid) => [...new Set((Array.isArray(value) ? value : []).filter((id) => typeof id === 'string' && valid.has(id)))].slice(0, 25);

const ROLE_FIELDS = ['required', 'blocked', 'acceptAdd', 'acceptRemove', 'rejectAdd', 'rejectRemove', 'pending', 'removeOnSubmit', 'ping', 'managers'];

function cleanQuestion(raw, existing, questions, roles) {
  const type = QUESTION_TYPES[raw?.type] ? raw.type : bad('Unbekannter Fragetyp.');
  const label = str(raw.label, 250) || bad('Jede Frage braucht einen Text.');
  const question = { key: existing?.key ?? admin.questionKey(label, questions), type, label, required: raw.required !== false };
  const description = str(raw.description, 500);
  if (description) question.description = description;
  if (type === 'TEXT') {
    if (raw.min) question.min = int(raw.min, 0, 5000, 'Mindestens Zeichen');
    if (raw.max) question.max = int(raw.max, 1, 5000, 'Höchstens Zeichen');
  }
  if (type === 'CHOICE') {
    question.options = (Array.isArray(raw.options) ? raw.options : [])
      .map((o) => ({ label: str(o?.label, 100), ...(str(o?.description, 100) ? { description: str(o.description, 100) } : {}) }))
      .filter((o) => o.label)
      .slice(0, 25);
    question.multiple = Boolean(raw.multiple);
  }
  if (type === 'ROLE') {
    const old = Object.fromEntries((existing?.options ?? []).map((o) => [o.roleId, o.description]));
    question.options = ids((raw.options ?? []).map((o) => o?.roleId), new Set(roles.keys())).map((id) => ({
      label: roles.get(id).name.slice(0, 100),
      value: id,
      roleId: id,
      ...(old[id] ? { description: old[id] } : {}),
    }));
    question.multiple = Boolean(raw.multiple);
  }
  return question;
}

// Übernimmt die bearbeitbaren Felder aus dem Formular in eine Kopie der Art. IDs von Rollen und Kanälen
// werden nur übernommen, wenn es sie auf dem Server gibt.
function applyTypeBody(type, body, guild) {
  const roles = guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed);
  const roleIds = new Set(roles.keys());
  const channelIds = new Set(guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).keys());

  if ('id' in body) type.id = str(body.id, 24).toLowerCase();
  if ('name' in body) type.name = str(body.name, 80);
  if ('emoji' in body) type.emoji = str(body.emoji, 60);
  if ('description' in body) type.description = str(body.description, 1000);
  if ('numberPrefix' in body) type.numberPrefix = admin.normalizePrefix(body.numberPrefix);
  if ('panel' in body) type.panel = str(body.panel, 24);
  if ('enabled' in body) type.enabled = Boolean(body.enabled);
  if ('teamThreads' in body) type.teamThreads = Boolean(body.teamThreads);
  if ('onLeave' in body) type.onLeave = ['NONE', 'DENY', 'WITHDRAW'].includes(body.onLeave) ? body.onLeave : bad('Ungültige Aktion beim Verlassen.');
  if ('cooldownMinutes' in body) type.cooldownMinutes = int(body.cooldownMinutes, 0, 525_600, 'Die Wartezeit');
  if ('timeLimitMinutes' in body) type.timeLimitMinutes = int(body.timeLimitMinutes, 5, 10_080, 'Das Zeitlimit');
  if ('stages' in body) type.stages = admin.stagesFromLines((Array.isArray(body.stages) ? body.stages : []).map((s) => str(s, 80)).join('\n'), type.stages);
  if (body.messages && typeof body.messages === 'object') {
    for (const key of ['start', 'finish', 'accept', 'reject']) if (key in body.messages) type.messages[key] = str(body.messages[key], 2000);
  }
  if (body.channels && typeof body.channels === 'object') {
    for (const key of ['open', 'accepted', 'rejected']) {
      if (key in body.channels) type.channels[key] = channelIds.has(body.channels[key]) ? body.channels[key] : '';
    }
  }
  if (body.roles && typeof body.roles === 'object') {
    for (const key of ROLE_FIELDS) if (key in body.roles) type.roles[key] = ids(body.roles[key], roleIds);
    if ('requiredMode' in body.roles) type.roles.requiredMode = body.roles.requiredMode === 'any' ? 'any' : 'all';
    if ('blockedMode' in body.roles) type.roles.blockedMode = body.roles.blockedMode === 'all' ? 'all' : 'any';
  }
  if ('questions' in body) {
    if (!Array.isArray(body.questions) || body.questions.length > 50) bad('Höchstens 50 Fragen.');
    const result = [];
    for (const raw of body.questions) {
      const existing = type.questions.find((q) => q.key === raw?.key);
      result.push(cleanQuestion(raw, existing, [...type.questions, ...result], roles));
    }
    type.questions = result;
  }
  delete type.workflow;
  return type;
}

// ---------- Ausgabe ----------

function recordSummary(record, type) {
  return {
    number: record.number,
    type: record.type,
    typeName: type?.name ?? record.type,
    emoji: type?.emoji ?? '',
    status: record.status,
    statusLabel: store.statusLabel(record.status, type),
    open: store.isOpenStatus(record.status),
    userId: record.userId,
    userTag: record.userTag,
    avatarUrl: record.avatarUrl ?? null,
    createdAt: record.createdAt,
    decidedBy: record.decidedBy ?? null,
    decidedAt: record.decidedAt ?? null,
    ai: record.ai?.level ?? null,
  };
}

function recordDetail(guild, record, type) {
  return {
    ...recordSummary(record, type),
    reason: record.reason ?? null,
    roblox: record.roblox ?? null,
    answers: record.answers,
    aiReasons: record.ai?.reasons ?? [],
    aiFlagged: record.ai?.flagged ?? [],
    durationMs: record.durationMs ?? null,
    joinedAt: record.joinedAt ?? null,
    accountCreatedAt: record.accountCreatedAt ?? null,
    roleSelections: record.roleSelections ?? [],
    history: record.history ?? [],
    nextStatuses: store.nextStatuses(record, type).map((s) => ({ id: s, label: s === 'WITHDRAWN' ? 'Zurückziehen' : store.statusLabel(s, type) })),
    messageUrl: record.messageId ? `https://discord.com/channels/${guild.id}/${record.channelId}/${record.messageId}` : null,
  };
}

const typeOut = (guildId, type) => ({ ...type, effectiveChannel: teamChannelId(guildId, type) || '' });

function meta(guild) {
  const me = guild.members.me;
  return {
    guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 64 }) },
    roles: guild.roles.cache
      .filter((r) => r.id !== guild.id && !r.managed)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, assignable: Boolean(me && r.position < me.roles.highest.position) })),
    channels: guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => ({ id: c.id, name: c.name, canSend: Boolean(me && c.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) })),
    templates: templates.choices(),
    questionTypes: QUESTION_TYPES,
    statuses: store.STATUS,
  };
}

// ---------- Routen ----------
// Jede Route: [Methode, Muster, Handler(ctx)] – ctx = { client, user, params, query, body, guild, member, isAdmin }

const needAdmin = (ctx) => ctx.isAdmin || deny('Dafür brauchst du „Server verwalten“ oder die Staff-Rolle.');

const routes = [
  ['GET', '/api/me', async ({ client, user }) => ({ user, guilds: await guildsFor(client, user.id) })],

  ['GET', '/api/guilds/:guild', (ctx) => ({
    ...meta(ctx.guild),
    isAdmin: ctx.isAdmin,
    types: store.types(ctx.guild.id).map((t) => typeOut(ctx.guild.id, t)),
    panels: forGuild(ctx.guild.id).applications.panels,
  })],

  // Bewerbungsarten
  ['POST', '/api/guilds/:guild/types', (ctx) => {
    needAdmin(ctx);
    const b = ctx.body;
    const type = admin.createType(ctx.guild.id, {
      id: b.id,
      name: str(b.name, 80),
      template: b.copyFrom ? undefined : str(b.template, 40) || 'leer',
      copyFrom: str(b.copyFrom, 24) || undefined,
      panel: str(b.panel, 24) || undefined,
      prefix: str(b.prefix, 10) || undefined,
      emoji: b.emoji === undefined ? undefined : str(b.emoji, 60),
    });
    refreshPanels(ctx.guild).catch(() => {});
    return typeOut(ctx.guild.id, type);
  }],
  ['PUT', '/api/guilds/:guild/types/:type', (ctx) => {
    needAdmin(ctx);
    const oldId = ctx.params.type;
    const newId = 'id' in ctx.body ? str(ctx.body.id, 24).toLowerCase() : oldId;
    if (newId !== oldId && admin.runningSessions(ctx.guild.id, oldId)) bad('Gerade füllt jemand diese Bewerbung aus – die ID kann erst danach geändert werden.');
    const type = admin.updateType(ctx.guild.id, oldId, (t) => applyTypeBody(t, ctx.body, ctx.guild));
    refreshPanels(ctx.guild).catch(() => {});
    return typeOut(ctx.guild.id, type);
  }],
  ['POST', '/api/guilds/:guild/types/:type/move', (ctx) => {
    needAdmin(ctx);
    admin.moveType(ctx.guild.id, ctx.params.type, ctx.body.delta < 0 ? -1 : 1);
    refreshPanels(ctx.guild).catch(() => {});
    return { ok: true };
  }],
  ['DELETE', '/api/guilds/:guild/types/:type', (ctx) => {
    needAdmin(ctx);
    admin.deleteType(ctx.guild.id, ctx.params.type);
    refreshPanels(ctx.guild).catch(() => {});
    return { ok: true };
  }],
  ['POST', '/api/guilds/:guild/types/:type/preview', (ctx) => {
    const type = store.typeById(ctx.guild.id, ctx.params.type) ?? bad('Unbekannte Bewerbungsart.');
    const key = ['start', 'finish', 'accept', 'reject'].includes(ctx.body.key) ? ctx.body.key : 'start';
    const template = str(ctx.body.text, 2000) || type.messages[key];
    return {
      text: renderMessage(template, {
        applicationName: type.name,
        applicant: `@${ctx.user.name}`,
        user: '@Teammitglied',
        number: `${type.numberPrefix}-0001`,
        reason: key === 'reject' || key === 'accept' ? 'Beispielgrund' : null,
        questionCount: type.questions.length,
        timeLimit: `${type.timeLimitMinutes} Minuten`,
      }),
    };
  }],

  // Panels
  ['POST', '/api/guilds/:guild/panels', (ctx) => {
    needAdmin(ctx);
    admin.createPanel(ctx.guild.id, { id: ctx.body.id, title: str(ctx.body.title, 200) });
    return forGuild(ctx.guild.id).applications.panels;
  }],
  ['PUT', '/api/guilds/:guild/panels/:panel', (ctx) => {
    needAdmin(ctx);
    const b = ctx.body;
    const channelIds = new Set(ctx.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).keys());
    admin.updatePanel(ctx.guild.id, ctx.params.panel, (p) => ({
      ...p,
      ...('title' in b ? { title: str(b.title, 200) } : {}),
      ...('description' in b ? { description: str(b.description, 3000) } : {}),
      ...('image' in b ? { image: str(b.image, 500) } : {}),
      ...('placeholder' in b ? { placeholder: str(b.placeholder, 150) } : {}),
      ...('showList' in b ? { showList: Boolean(b.showList) } : {}),
      ...('channel' in b ? { channel: channelIds.has(b.channel) ? b.channel : '' } : {}),
    }));
    refreshPanels(ctx.guild).catch(() => {});
    return forGuild(ctx.guild.id).applications.panels;
  }],
  ['DELETE', '/api/guilds/:guild/panels/:panel', (ctx) => {
    needAdmin(ctx);
    admin.deletePanel(ctx.guild.id, ctx.params.panel, ctx.query.get('moveTo') || undefined);
    refreshPanels(ctx.guild).catch(() => {});
    return forGuild(ctx.guild.id).applications.panels;
  }],
  ['POST', '/api/guilds/:guild/panels/:panel/post', async (ctx) => {
    needAdmin(ctx);
    if (!forGuild(ctx.guild.id).applications.panels[ctx.params.panel]) bad('Unbekanntes Panel.');
    const channel = ctx.guild.channels.cache.get(ctx.body.channelId);
    if (!channel?.isTextBased()) bad('Bitte einen Textkanal wählen.');
    const message = await postPanel(channel, ctx.params.panel).catch((err) => bad(`Posten fehlgeschlagen: ${err.message}`));
    return { url: message.url };
  }],

  // Bewerbungen
  ['GET', '/api/guilds/:guild/applications', (ctx) => {
    const filter = ctx.query.get('status') ?? 'open';
    const typeId = ctx.query.get('type');
    const search = (ctx.query.get('q') ?? '').toLowerCase();
    const visible = (r) => ctx.isAdmin || store.isManager(ctx.member, store.typeById(ctx.guild.id, r.type) ?? { roles: { managers: [] } });
    const list = Object.values(store.recordsOf(ctx.guild.id))
      .filter((r) => (filter === 'all' ? true : filter === 'open' ? store.isOpenStatus(r.status) : r.status === filter))
      .filter((r) => !typeId || r.type === typeId)
      .filter((r) => !search || [r.number, r.userTag, r.userId, r.roblox?.name].some((v) => String(v ?? '').toLowerCase().includes(search)))
      .filter(visible)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 500);
    return list.map((r) => recordSummary(r, store.typeById(ctx.guild.id, r.type)));
  }],
  ['GET', '/api/guilds/:guild/applications/:number', (ctx) => {
    const record = store.getRecord(ctx.guild.id, ctx.params.number.toUpperCase()) ?? bad('Bewerbung nicht gefunden.');
    const type = store.typeById(ctx.guild.id, record.type);
    if (!ctx.isAdmin && !(type && store.isManager(ctx.member, type))) deny();
    return { ...recordDetail(ctx.guild, record, type), previous: store.historyOf(ctx.guild.id, record.userId).filter((r) => r.number !== record.number).map((r) => recordSummary(r, store.typeById(ctx.guild.id, r.type))) };
  }],
  ['POST', '/api/guilds/:guild/applications/:number/decide', async (ctx) => {
    const record = store.getRecord(ctx.guild.id, ctx.params.number.toUpperCase()) ?? bad('Bewerbung nicht gefunden.');
    const type = store.typeById(ctx.guild.id, record.type);
    if (!type || !store.isManager(ctx.member, type)) deny('Du darfst über diese Bewerbung nicht entscheiden.');
    const by = await ctx.client.users.fetch(ctx.user.id);
    const error =
      ctx.body.action === 'accept' || ctx.body.action === 'reject'
        ? await decisions.decideExternal(ctx.guild, record.number, ctx.body.action, by, str(ctx.body.reason, 1000) || null)
        : await decisions.changeStatusExternal(ctx.guild, record.number, str(ctx.body.status, 40), by);
    if (error) bad(error);
    return recordDetail(ctx.guild, record, type);
  }],
  ['DELETE', '/api/guilds/:guild/applications/:number', async (ctx) => {
    needAdmin(ctx);
    const number = ctx.params.number.toUpperCase();
    const record = store.getRecord(ctx.guild.id, number) ?? bad('Bewerbung nicht gefunden.');
    if (record.messageId) {
      const channel = await ctx.guild.channels.fetch(record.channelId).catch(() => null);
      await channel?.messages.delete(record.messageId).catch(() => {});
    }
    delete store.recordsOf(ctx.guild.id)[number];
    save();
    await sendTo(ctx.guild, 'modLog', { embeds: [embed('danger').setDescription(`🗑️ <@${ctx.user.id}> hat die Bewerbung **${number}** (<@${record.userId}>) im Dashboard gelöscht.`)], allowedMentions: { parse: [] } });
    return { ok: true };
  }],

  // Sperren
  ['GET', '/api/guilds/:guild/bans', (ctx) => {
    const now = Date.now();
    return Object.values(store.bansOf(ctx.guild.id))
      .map((b) => ({ ...b, active: !b.liftedAt && (!b.expiresAt || b.expiresAt > now) }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }],
  ['POST', '/api/guilds/:guild/bans', async (ctx) => {
    const b = ctx.body;
    const discordId = /^\d{15,25}$/.test(b.discordId ?? '') ? b.discordId : null;
    const robloxName = str(b.roblox, 20);
    if (!discordId && !robloxName) bad('Gib eine Discord-ID und/oder einen Roblox-Namen an.');
    const reason = str(b.reason, 500) || bad('Bitte einen Grund angeben.');
    const scope = b.scope === '*' || store.typeById(ctx.guild.id, b.scope) ? b.scope : bad('Unbekannter Bereich.');
    let roblox = null;
    if (robloxName) {
      roblox = await findRobloxUser(robloxName).catch(() => bad('Roblox ist gerade nicht erreichbar.'));
      if (!roblox) bad(`Kein Roblox-Konto „${robloxName}“ gefunden.`);
    }
    const days = b.days ? int(b.days, 1, 3650, 'Die Dauer') : null;
    const id = `B-${String(nextNumber('appBan', ctx.guild.id)).padStart(4, '0')}`;
    const ban = {
      id,
      discordId,
      robloxId: roblox?.id ?? null,
      robloxName: roblox?.name ?? null,
      scopes: [scope],
      reason,
      expiresAt: days ? Date.now() + days * 86_400_000 : null,
      createdBy: ctx.user.id,
      createdAt: Date.now(),
    };
    store.bansOf(ctx.guild.id)[id] = ban;
    save();
    const who = [discordId && `<@${discordId}>`, roblox && `Roblox ${roblox.name}`].filter(Boolean).join(' · ');
    await sendTo(ctx.guild, 'modLog', { embeds: [embed('danger').setDescription(`🚫 Sperre **${id}** im Dashboard angelegt: ${who} – ${days ? `${days} Tage` : 'unbegrenzt'}\n**Grund:** ${reason}\nvon <@${ctx.user.id}>`)], allowedMentions: { parse: [] } });
    return ban;
  }],
  ['DELETE', '/api/guilds/:guild/bans/:ban', async (ctx) => {
    const ban = store.bansOf(ctx.guild.id)[ctx.params.ban.toUpperCase()];
    if (!ban || ban.liftedAt) bad('Diese Sperre gibt es nicht oder sie ist schon aufgehoben.');
    ban.liftedAt = Date.now();
    ban.liftedBy = ctx.user.id;
    save();
    await sendTo(ctx.guild, 'modLog', { embeds: [embed('success').setDescription(`✅ <@${ctx.user.id}> hat die Bewerbungssperre **${ban.id}** im Dashboard aufgehoben.`)] });
    return { ok: true };
  }],

  // Statistik (das Embed aus /bewerbungen statistik als Daten)
  ['GET', '/api/guilds/:guild/stats', (ctx) => {
    const days = Math.min(365, Math.max(7, Number(ctx.query.get('days')) || 30));
    return buildStats(ctx.guild.id, days, { typeId: ctx.query.get('type') || undefined }).toJSON();
  }],
];

// Sucht die Route und führt sie aus. Gibt { status, body } zurück.
async function handle(client, user, method, pathname, query, body) {
  for (const [m, pattern, handler] of routes) {
    if (m !== method) continue;
    const names = [];
    const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, name) => (names.push(name), '([^/]+)'))}$`);
    const match = pathname.match(regex);
    if (!match) continue;
    const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(match[i + 1])]));
    try {
      const ctx = { client, user, params, query, body: body ?? {} };
      if (params.guild) Object.assign(ctx, await access(client, params.guild, user.id));
      return { status: 200, body: await handler(ctx) };
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
      if (err instanceof admin.EditError) return { status: 400, body: { error: err.message } };
      console.error(`[dashboard] ${method} ${pathname}`, err);
      return { status: 500, body: { error: 'Interner Fehler – siehe Bot-Konsole.' } };
    }
  }
  return { status: 404, body: { error: 'Unbekannte Adresse.' } };
}

module.exports = { handle, applyTypeBody, cleanQuestion, HttpError };
