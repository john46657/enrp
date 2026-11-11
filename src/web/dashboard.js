// Dashboard fürs Bewerbungsteam: Liste, Details, Entscheidungen, Statistik, Sperren, Protokoll und Einrichtung.
// Zugang über /dashboard in Discord (signierter Link → Cookie). Die Rechte werden bei jedem Aufruf neu geprüft.
const web = require('../lib/web');
const settings = require('../lib/settings');
const { embed, isStaff, sendTo } = require('../lib/util');
const store = require('../lib/applications/store');
const { decideAs } = require('../lib/applications/decide');
const { refreshPanels } = require('../lib/applications/messages');
const { findRobloxUser, profileUrl } = require('../lib/applications/roblox');
const { metrics, percent, hours } = require('../lib/applications/stats');
const { numbersOf } = require('../lib/applications/serviceNumbers');
const { escapeHtml: h, formatDate, page, notice } = require('./html');
const HttpError = require('./httpError');

const COOKIE = 'enrp_dash';
const SESSION_MS = 12 * 60 * 60_000;
const DAY = 86_400_000;
const STATUS_TAG = { ACCEPTED: 'ok', REJECTED: 'bad', WITHDRAWN: '', OPEN: 'warn', SUBMITTED: 'warn', SCREENING: 'warn', INTERVIEW: 'warn', PENDING_DECISION: 'warn' };
const AI_TAG = { gering: 'ok', mittel: 'warn', hoch: 'bad' };

const statusTag = (status) => `<span class="tag ${STATUS_TAG[status] ?? ''}">${h(store.STATUS[status] ?? status)}</span>`;

function readCookie(headers, name) {
  for (const part of (headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

const cookieHeader = (value, maxAgeSeconds) =>
  `${COOKIE}=${value}; Path=/dash; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${web.baseUrl().startsWith('https://') ? '; Secure' : ''}`;

// ---------- Anmeldung ----------

function login(token) {
  const payload = web.verify(token, 'login');
  if (!payload) throw new HttpError(403, 'Dieser Link ist ungültig oder abgelaufen. Hole dir mit /dashboard in Discord einen neuen.');
  const session = web.sign({ k: 'dash', g: payload.g, u: payload.u, exp: Date.now() + SESSION_MS });
  return { redirect: '/dash', headers: { 'Set-Cookie': cookieHeader(session, SESSION_MS / 1000) } };
}

async function authenticate(request) {
  const session = web.verify(readCookie(request.headers, COOKIE), 'dash');
  if (!session) throw new HttpError(401, 'Du bist nicht angemeldet. Öffne das Dashboard mit /dashboard in Discord.');
  const guild = request.client.guilds.cache.get(session.g);
  const member = await guild?.members.fetch(session.u).catch(() => null);
  if (!member || !store.managesAny(member)) throw new HttpError(403, 'Du gehörst nicht (mehr) zum Bewerbungsteam dieses Servers.');
  const csrf = web.sign({ k: 'csrf', g: session.g, u: session.u, exp: session.exp });
  if (request.method === 'POST') {
    const given = web.verify(request.body.get('csrf'), 'csrf');
    if (!given || given.u !== session.u || given.g !== session.g) throw new HttpError(403, 'Die Seite ist abgelaufen. Lade sie neu und versuche es noch einmal.');
  }
  return { guild, member, csrf, staff: isStaff(member) };
}

// ---------- Bausteine ----------

const TABS = [
  ['', 'Bewerbungen'],
  ['stats', 'Statistik'],
  ['bans', 'Sperren'],
  ['numbers', 'Dienstnummern'],
  ['log', 'Protokoll'],
  ['setup', 'Einrichtung'],
];

function layout(ctx, active, title, body) {
  const nav = `<header class="top"><strong>${h(ctx.guild.name)}</strong><nav>${TABS.map(
    ([path, label]) => `<a href="/dash${path ? `/${path}` : ''}"${path === active ? ' class="active"' : ''}>${label}</a>`,
  ).join('')}</nav><span class="muted small">${h(ctx.member.user.tag)} · <a href="/dash/logout">Abmelden</a></span></header>`;
  return { html: page({ title, nav, body }) };
}

const csrfField = (ctx) => `<input type="hidden" name="csrf" value="${h(ctx.csrf)}">`;
const userName = (guild, id) => guild.members.cache.get(id)?.user.tag ?? guild.client.users.cache.get(id)?.tag ?? id;
const names = (guild) => (kind, id) =>
  kind === 'role' ? guild.roles.cache.get(id)?.name : kind === 'channel' ? guild.channels.cache.get(id)?.name : userName(guild, id);

// Bewerbungen, die dieses Team-Mitglied sehen darf (Arten, für die es Manager ist; Staff sieht alles).
function visibleRecords(ctx) {
  const allowed = new Set(store.types(ctx.guild.id).filter((t) => store.isManager(ctx.member, t)).map((t) => t.id));
  return Object.values(store.recordsOf(ctx.guild.id)).filter((r) => ctx.staff || allowed.has(r.type));
}

const typeName = (guildId, id) => {
  const type = store.typeById(guildId, id);
  return type ? `${type.emoji} ${type.name}` : id;
};

const flash = (request) => {
  const ok = request.url.searchParams.get('ok');
  const error = request.url.searchParams.get('error');
  return (ok ? notice(h(ok), 'ok') : '') + (error ? notice(h(error), 'error') : '');
};
const back = (path, key, text) => ({ redirect: `${path}?${key}=${encodeURIComponent(text)}` });

// ---------- Seiten ----------

function listPage(ctx, request) {
  const status = request.url.searchParams.get('status') ?? 'open';
  const typeId = request.url.searchParams.get('type') ?? '';
  const query = (request.url.searchParams.get('q') ?? '').trim().toLowerCase();
  const all = visibleRecords(ctx);
  const records = all
    .filter((r) => (status === 'all' ? true : status === 'open' ? store.isOpenStatus(r.status) : r.status === status))
    .filter((r) => !typeId || r.type === typeId)
    .filter((r) => !query || [r.number, r.userTag, r.userId, r.roblox?.name].some((v) => String(v ?? '').toLowerCase().includes(query)))
    .sort((a, b) => (status === 'open' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  const shown = records.slice(0, 200);

  const option = (value, label, current) => `<option value="${h(value)}"${value === current ? ' selected' : ''}>${h(label)}</option>`;
  const filters = `<form method="get" class="card row">
    <label>Status<select name="status">${[['open', 'Offen'], ['all', 'Alle'], ['ACCEPTED', 'Angenommen'], ['REJECTED', 'Abgelehnt'], ['WITHDRAWN', 'Zurückgezogen']]
      .map(([v, l]) => option(v, l, status))
      .join('')}</select></label>
    <label>Art<select name="type">${option('', 'Alle Arten', typeId)}${store
      .types(ctx.guild.id)
      .map((t) => option(t.id, t.name, typeId))
      .join('')}</select></label>
    <label>Suche<input type="text" name="q" value="${h(query)}" placeholder="Nummer, Name, Roblox"></label>
    <button type="submit">Filtern</button>
  </form>`;

  const rows = shown
    .map(
      (r) => `<tr>
      <td><a href="/dash/app/${h(r.number)}"><strong>${h(r.number)}</strong></a></td>
      <td>${h(typeName(ctx.guild.id, r.type))}</td>
      <td>${h(r.userTag)}${r.roblox ? `<br><span class="muted small">Roblox: ${h(r.roblox.name)}</span>` : ''}</td>
      <td>${statusTag(r.status)}</td>
      <td>${r.ai ? `<span class="tag ${AI_TAG[r.ai.level] ?? ''}">${h(r.ai.level)}</span>` : '—'}</td>
      <td>${formatDate(r.createdAt)}</td>
    </tr>`,
    )
    .join('');
  const table = shown.length
    ? `<div class="card scroll"><table><thead><tr><th>Nummer</th><th>Art</th><th>Bewerber</th><th>Status</th><th>KI-Checker</th><th>Eingegangen</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : notice('Keine Bewerbungen für diese Auswahl.');
  const progress = Object.values(store.progressOf(ctx.guild.id)).filter((p) => p.expiresAt > Date.now()).length;
  return layout(
    ctx,
    '',
    'Bewerbungen',
    `<h1>Bewerbungen</h1>${flash(request)}
    <p class="muted">${all.filter((r) => store.isOpenStatus(r.status)).length} offen · ${all.length} insgesamt · ${progress} werden gerade ausgefüllt${records.length > shown.length ? ` · es werden die ersten ${shown.length} von ${records.length} gezeigt` : ''}</p>
    ${filters}${table}`,
  );
}

function loadRecord(ctx, number) {
  const record = store.getRecord(ctx.guild.id, number);
  if (!record) throw new HttpError(404, `Die Bewerbung ${number} gibt es nicht.`);
  const type = store.typeById(ctx.guild.id, record.type);
  if (type ? !store.isManager(ctx.member, type) : !ctx.staff) throw new HttpError(403, 'Diese Bewerbung darfst du nicht sehen.');
  return { record, type };
}

function detailPage(ctx, request, number) {
  const { record, type } = loadRecord(ctx, number);
  const guild = ctx.guild;
  const flagged = new Set(record.ai?.flagged ?? []);
  const info = [
    ['Status', `${statusTag(record.status)}${record.decidedBy ? ` von ${h(userName(guild, record.decidedBy))} am ${formatDate(record.decidedAt)}` : ''}`],
    record.reason ? ['Grund', h(record.reason)] : null,
    ['Bewerber', `${h(record.userTag)} <span class="muted small">(${h(record.userId)})</span>`],
    record.roblox ? ['Roblox', `<a href="${h(profileUrl(record.roblox.id))}" rel="noreferrer noopener" target="_blank">${h(record.roblox.name)}</a> <span class="muted small">(ID ${h(record.roblox.id)})</span>`] : null,
    record.serviceNumber ? ['Dienstnummer', `<strong>${h(record.serviceNumber)}</strong>`] : null,
    ['Eingegangen', `${formatDate(record.createdAt)}${record.via === 'WEB' ? ' · Web-Formular' : ' · per Direktnachricht'}`],
    record.joinedAt ? ['Auf dem Server seit', formatDate(record.joinedAt)] : null,
    record.accountCreatedAt ? ['Discord-Konto seit', formatDate(record.accountCreatedAt)] : null,
    record.ai ? ['KI-Checker', `<span class="tag ${AI_TAG[record.ai.level] ?? ''}">Verdacht ${h(record.ai.level)}</span>${record.ai.reasons.length ? ` <span class="muted small">${h(record.ai.reasons.join(' · '))}</span>` : ''}`] : null,
    record.roleSelections?.length ? ['Rollen bei Annahme', h(record.roleSelections.map((id) => `@${guild.roles.cache.get(id)?.name ?? id}`).join(', '))] : null,
    record.messageId ? ['Discord', `<a href="https://discord.com/channels/${h(guild.id)}/${h(record.channelId)}/${h(record.messageId)}" rel="noreferrer noopener" target="_blank">Team-Nachricht öffnen</a>`] : null,
  ].filter(Boolean);

  let actions = '';
  if (type && store.isOpenStatus(record.status)) {
    if (record.userId === ctx.member.id) actions = notice('Über deine eigene Bewerbung kannst du nicht entscheiden.');
    else {
      const steps = (store.POLICE_TRANSITIONS[record.status] ?? []).filter((s) => !store.FINAL.includes(s));
      actions = `<form method="post" action="/dash/app/${h(record.number)}/decide" class="card">
        ${csrfField(ctx)}
        <h2 style="margin-top:0">Entscheiden</h2>
        <div class="field"><label class="q" for="reason">Grund (optional, geht per DM an die Person)</label><textarea id="reason" name="reason" maxlength="1000" style="min-height:70px"></textarea></div>
        <div class="row">
          <button class="ok" name="status" value="ACCEPTED">Annehmen</button>
          <button class="bad" name="status" value="REJECTED">Ablehnen</button>
          ${type.workflow === 'police' ? steps.map((s) => `<button class="plain" name="status" value="${s}">→ ${h(store.STATUS[s])}</button>`).join('') : ''}
          <button class="plain" name="status" value="WITHDRAWN">Zurückziehen</button>
        </div>
      </form>`;
    }
  }

  const others = store.historyOf(guild.id, record.userId).filter((r) => r.number !== record.number);
  return layout(
    ctx,
    '',
    record.number,
    `<p><a href="/dash">← Alle Bewerbungen</a></p>
    <h1>${h(typeName(guild.id, record.type))} – ${h(record.number)}</h1>${flash(request)}
    <div class="card scroll"><table><tbody>${info.map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`).join('')}</tbody></table></div>
    ${actions}
    <h2>Antworten</h2>
    ${record.answers
      .map(
        (a, i) => `<div class="card"><strong>${i + 1}. ${h(a.question)}</strong>${flagged.has(a.question) ? ' <span class="tag warn">vom KI-Checker markiert</span>' : ''}
        <div class="answer">${a.answer ? h(a.answer) : '<span class="muted">—</span>'}</div></div>`,
      )
      .join('')}
    <h2>Verlauf</h2>
    <div class="card scroll"><table><tbody>${record.history
      .map((e) => `<tr><td>${formatDate(e.at)}</td><td>${statusTag(e.status)}</td><td>${e.by ? h(userName(guild, e.by)) : 'System'}</td><td>${h(e.reason ?? '')}</td></tr>`)
      .join('')}</tbody></table></div>
    ${
      others.length
        ? `<h2>Weitere Bewerbungen dieser Person</h2><div class="card scroll"><table><tbody>${others
            .map((r) => `<tr><td><a href="/dash/app/${h(r.number)}">${h(r.number)}</a></td><td>${h(typeName(guild.id, r.type))}</td><td>${statusTag(r.status)}</td><td>${formatDate(r.createdAt)}</td></tr>`)
            .join('')}</tbody></table></div>`
        : ''
    }`,
  );
}

async function decide(ctx, request, number) {
  const { record, type } = loadRecord(ctx, number);
  if (!type) throw new HttpError(409, 'Die Bewerbungsart dieser Bewerbung wurde gelöscht.');
  const status = request.body.get('status');
  if (!store.STATUS[status]) throw new HttpError(400, 'Unbekannter Status.');
  const reason = (request.body.get('reason') ?? '').trim().slice(0, 1000) || null;
  const error = await decideAs(ctx.guild, record, type, ctx.member.user, status, reason);
  return error ? back(`/dash/app/${record.number}`, 'error', error) : back(`/dash/app/${record.number}`, 'ok', `Gespeichert: ${store.STATUS[status]}.`);
}

function statsPage(ctx, request) {
  const days = Math.min(365, Math.max(7, Number(request.url.searchParams.get('days')) || 30));
  const now = Date.now();
  const all = visibleRecords(ctx);
  const current = all.filter((r) => r.createdAt >= now - days * DAY);
  const previous = all.filter((r) => r.createdAt >= now - 2 * days * DAY && r.createdAt < now - days * DAY);
  const m = metrics(current);
  const p = metrics(previous);
  const perDay = Array.from({ length: days }, (_, i) => {
    const start = now - (days - i) * DAY;
    return current.filter((r) => r.createdAt >= start && r.createdAt < start + DAY).length;
  });
  const max = Math.max(...perDay, 1);
  const tile = (label, value, before) => `<div class="card"><span class="muted small">${label}</span><b>${value}</b><span class="muted small">davor: ${before}</span></div>`;

  const reviewers = {};
  for (const r of current) if (r.decidedBy && r.status !== 'WITHDRAWN') reviewers[r.decidedBy] = (reviewers[r.decidedBy] ?? 0) + 1;
  const top = Object.entries(reviewers)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);
  const perType = store
    .types(ctx.guild.id)
    .map((t) => [t, metrics(current.filter((r) => r.type === t.id))])
    .filter(([, own]) => own.count);

  return layout(
    ctx,
    'stats',
    'Statistik',
    `<h1>Statistik – letzte ${days} Tage</h1>
    <p>${[7, 30, 90, 365].map((d) => (d === days ? `<strong>${d} Tage</strong>` : `<a href="/dash/stats?days=${d}">${d} Tage</a>`)).join(' · ')}</p>
    <div class="stats">
      ${tile('Bewerbungen', m.count, p.count)}
      ${tile('Annahmequote', percent(m.acceptRate), percent(p.acceptRate))}
      ${tile('⌀ Bearbeitungszeit', hours(m.avgMs), hours(p.avgMs))}
      ${tile('Offen', m.open, p.open)}
      ${tile('Abschlussquote', percent(m.completion), percent(p.completion))}
    </div>
    <h2>Eingänge je Tag</h2>
    <div class="card"><div class="bars" role="img" aria-label="Eingänge je Tag">${perDay.map((v) => `<span style="height:${Math.round((v / max) * 100)}%" title="${v}"></span>`).join('')}</div>
    <p class="muted small">✅ ${m.accepted} angenommen · ⏳ ${m.open} offen · ❌ ${m.rejected} abgelehnt · ↩️ ${m.withdrawn} zurückgezogen</p></div>
    ${
      perType.length
        ? `<h2>Je Bewerbungsart</h2><div class="card scroll"><table><thead><tr><th>Art</th><th class="num">Gesamt</th><th class="num">Angenommen</th><th class="num">Abgelehnt</th><th class="num">Offen</th><th class="num">Annahmequote</th></tr></thead><tbody>${perType
            .map(([t, own]) => `<tr><td>${h(`${t.emoji} ${t.name}`)}</td><td class="num">${own.count}</td><td class="num">${own.accepted}</td><td class="num">${own.rejected}</td><td class="num">${own.open}</td><td class="num">${percent(own.acceptRate)}</td></tr>`)
            .join('')}</tbody></table></div>`
        : ''
    }
    ${
      top.length
        ? `<h2>Top-Prüfer</h2><div class="card scroll"><table><tbody>${top.map(([id, n], i) => `<tr><td>${i + 1}.</td><td>${h(userName(ctx.guild, id))}</td><td class="num">${n}</td></tr>`).join('')}</tbody></table></div>`
        : ''
    }`,
  );
}

function bansPage(ctx, request) {
  const guildId = ctx.guild.id;
  const active = store.activeBans(guildId);
  const rows = active
    .map(
      (b) => `<tr>
      <td><strong>${h(b.id)}</strong></td>
      <td>${[b.discordId && h(userName(ctx.guild, b.discordId)), b.robloxName && `Roblox ${h(b.robloxName)}`].filter(Boolean).join('<br>')}</td>
      <td>${h(b.scopes.map((s) => store.scopeName(guildId, s)).join(', '))}</td>
      <td>${b.expiresAt ? formatDate(b.expiresAt) : 'unbegrenzt'}</td>
      <td>${h(b.reason)}</td>
      <td><form method="post" action="/dash/bans/lift">${csrfField(ctx)}<input type="hidden" name="id" value="${h(b.id)}"><button class="plain">Aufheben</button></form></td>
    </tr>`,
    )
    .join('');
  const scopes = [['*', 'Alle Bewerbungen'], ['police', 'Polizei-Bewerbung'], ...store.types(guildId).filter((t) => t.workflow !== 'police').map((t) => [t.id, t.name])];
  return layout(
    ctx,
    'bans',
    'Sperren',
    `<h1>Bewerbungssperren</h1>${flash(request)}
    ${active.length ? `<div class="card scroll"><table><thead><tr><th>ID</th><th>Person</th><th>Bereich</th><th>Bis</th><th>Grund</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : notice('Es gibt keine aktiven Sperren.')}
    <h2>Neue Sperre</h2>
    <form method="post" action="/dash/bans/add" class="card">
      ${csrfField(ctx)}
      <div class="row">
        <label>Discord-ID<input type="text" name="discordId" inputmode="numeric" pattern="[0-9]{15,25}" placeholder="z. B. 123456789012345678"></label>
        <label>Roblox-Benutzername<input type="text" name="roblox" maxlength="20"></label>
        <label>Bereich<select name="scope">${scopes.map(([v, l]) => `<option value="${h(v)}">${h(l)}</option>`).join('')}</select></label>
        <label>Dauer in Tagen<input type="number" name="days" min="1" max="3650" placeholder="leer = unbegrenzt"></label>
      </div>
      <div class="field" style="margin-top:12px"><label class="q" for="banreason">Grund (sieht die Person)</label><input type="text" id="banreason" name="reason" maxlength="500" required></div>
      <button type="submit">Sperren</button>
    </form>`,
  );
}

async function addBan(ctx, request) {
  const body = request.body;
  const discordId = (body.get('discordId') ?? '').trim();
  const robloxName = (body.get('roblox') ?? '').trim();
  const reason = (body.get('reason') ?? '').trim().slice(0, 500);
  const days = Number(body.get('days')) || null;
  const scope = body.get('scope') ?? '*';
  if (!discordId && !robloxName) return back('/dash/bans', 'error', 'Gib eine Discord-ID und/oder einen Roblox-Namen an.');
  if (discordId && !/^\d{15,25}$/.test(discordId)) return back('/dash/bans', 'error', 'Die Discord-ID besteht nur aus Ziffern (Rechtsklick → ID kopieren).');
  if (!reason) return back('/dash/bans', 'error', 'Gib einen Grund an.');
  if (!['*', 'police'].includes(scope) && !store.typeById(ctx.guild.id, scope)) return back('/dash/bans', 'error', 'Diesen Bereich gibt es nicht.');
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) return back('/dash/bans', 'error', 'Die Dauer muss zwischen 1 und 3650 Tagen liegen.');
  let roblox = null;
  if (robloxName) {
    try {
      roblox = await findRobloxUser(robloxName);
    } catch {
      return back('/dash/bans', 'error', 'Roblox ist gerade nicht erreichbar. Versuche es gleich noch einmal.');
    }
    if (!roblox) return back('/dash/bans', 'error', `Kein Roblox-Konto „${robloxName}“ gefunden.`);
  }
  const ban = store.addBan(ctx.guild.id, { discordId: discordId || null, roblox, scope, reason, days, createdBy: ctx.member.id });
  const who = [discordId && `<@${discordId}>`, roblox && `Roblox ${roblox.name}`].filter(Boolean).join(' · ');
  await sendTo(ctx.guild, 'modLog', {
    embeds: [embed('danger').setDescription(`🚫 Sperre **${ban.id}** angelegt: ${who} – ${store.scopeName(ctx.guild.id, scope)}, ${days ? `${days} Tage` : 'unbegrenzt'}.\n**Grund:** ${reason}\nvon ${ctx.member} (Dashboard)`)],
    allowedMentions: { parse: [] },
  });
  return back('/dash/bans', 'ok', `Sperre ${ban.id} angelegt.`);
}

async function liftBan(ctx, request) {
  const ban = store.liftBan(ctx.guild.id, request.body.get('id') ?? '', ctx.member.id);
  if (!ban) return back('/dash/bans', 'error', 'Diese Sperre gibt es nicht oder sie ist schon aufgehoben.');
  await sendTo(ctx.guild, 'modLog', { embeds: [embed('success').setDescription(`✅ ${ctx.member} hat die Bewerbungssperre **${ban.id}** aufgehoben (Dashboard).`)], allowedMentions: { parse: [] } });
  return back('/dash/bans', 'ok', `Sperre ${ban.id} aufgehoben.`);
}

function numbersPage(ctx) {
  const entries = Object.values(numbersOf(ctx.guild.id)).sort((a, b) => a.value.localeCompare(b.value, 'de', { numeric: true }));
  return layout(
    ctx,
    'numbers',
    'Dienstnummern',
    `<h1>Dienstnummern</h1>
    ${
      entries.length
        ? `<div class="card scroll"><table><thead><tr><th>Nummer</th><th>Person</th><th>Art</th><th>Bewerbung</th><th>Seit</th></tr></thead><tbody>${entries
            .map(
              (e) =>
                `<tr><td><strong>${h(e.value)}</strong></td><td>${h(userName(ctx.guild, e.userId))}</td><td>${h(typeName(ctx.guild.id, e.typeId))}</td><td>${e.application ? `<a href="/dash/app/${h(e.application)}">${h(e.application)}</a>` : '—'}</td><td>${formatDate(e.at)}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : notice('Es sind noch keine Dienstnummern vergeben. Die Automatik schaltest du mit <code>/bewerbungsart dienstnummer</code> ein.')
    }
    <p class="muted small">Von Hand vergeben oder freigeben: <code>/dienstnummer setzen</code> und <code>/dienstnummer entfernen</code> in Discord.</p>`,
  );
}

function logPage(ctx) {
  const events = visibleRecords(ctx)
    .flatMap((r) => r.history.map((e) => ({ ...e, record: r })))
    .sort((a, b) => b.at - a.at)
    .slice(0, 200);
  return layout(
    ctx,
    'log',
    'Protokoll',
    `<h1>Protokoll</h1><p class="muted">Die letzten ${events.length} Statusänderungen.</p>
    ${
      events.length
        ? `<div class="card scroll"><table><thead><tr><th>Zeit</th><th>Bewerbung</th><th>Bewerber</th><th>Status</th><th>Von</th><th>Grund</th></tr></thead><tbody>${events
            .map(
              (e) =>
                `<tr><td>${formatDate(e.at)}</td><td><a href="/dash/app/${h(e.record.number)}">${h(e.record.number)}</a></td><td>${h(e.record.userTag)}</td><td>${statusTag(e.status)}</td><td>${e.by ? h(userName(ctx.guild, e.by)) : 'System'}</td><td>${h(e.reason ?? '')}</td></tr>`,
            )
            .join('')}</tbody></table></div>`
        : notice('Noch keine Einträge.')
    }`,
  );
}

function setupPage(ctx, request) {
  const guildId = ctx.guild.id;
  const config = settings.forGuild(guildId);
  const resolve = names(ctx.guild);
  const states = { open: ['ok', 'offen'], disabled: ['bad', 'deaktiviert'], before: ['warn', 'öffnet noch'], after: ['bad', 'Phase beendet'], full: ['bad', 'alle Plätze vergeben'] };
  const rows = store
    .types(guildId)
    .map((t) => {
      const phase = store.phaseOf(guildId, t);
      const [kind, label] = states[phase.state];
      const channelId = t.channels.open || (t.panel === 'apply' ? config.applications.channel : config.applications.qualiChannel);
      const toggle = ctx.staff
        ? `<form method="post" action="/dash/setup/toggle">${csrfField(ctx)}<input type="hidden" name="type" value="${h(t.id)}"><button class="plain">${t.enabled ? 'Schließen' : 'Öffnen'}</button></form>`
        : '';
      return `<tr>
        <td><strong>${h(`${t.emoji} ${t.name}`)}</strong><br><span class="muted small">${h(t.id)} · ${t.questions.length} Fragen · ${t.mode === 'WEB' ? 'Web-Formular' : 'Direktnachricht'}</span></td>
        <td><span class="tag ${kind}">${label}</span>${phase.opensAt ? `<br><span class="muted small">öffnet ${formatDate(phase.opensAt)}</span>` : ''}${phase.closesAt ? `<br><span class="muted small">schließt ${formatDate(phase.closesAt)}</span>` : ''}${phase.max ? `<br><span class="muted small">${phase.used}/${phase.max} Plätze</span>` : ''}</td>
        <td>${channelId ? `#${h(resolve('channel', channelId) ?? channelId)}` : '<span class="tag bad">kein Kanal</span>'}</td>
        <td>${t.roles.managers.length ? h(t.roles.managers.map((id) => `@${resolve('role', id) ?? id}`).join(', ')) : '<span class="muted">nur Staff</span>'}</td>
        <td>${t.serviceNumber?.enabled ? h(t.serviceNumber.format) : '—'}</td>
        <td>${toggle}</td>
      </tr>`;
    })
    .join('');
  return layout(
    ctx,
    'setup',
    'Einrichtung',
    `<h1>Einrichtung</h1>${flash(request)}
    <div class="card scroll"><table><thead><tr><th>Bewerbungsart</th><th>Zustand</th><th>Team-Kanal</th><th>Manager</th><th>Dienstnummer</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="card"><strong>Ändern in Discord</strong>
      <p class="muted">Arten, Fragen, Texte, Rollen, Bewerbungsphasen und Dienstnummern: <code>/bewerbungsart</code><br>
      Kanäle, Manager-Rolle, Wartezeit, Zeitlimit: <code>/einstellungen bewerbung</code> und <code>/einstellungen bewerbungs-kanaele</code><br>
      Panels posten: <code>/bewerbungspanel</code> und <code>/qualipanel</code></p></div>`,
  );
}

async function toggleType(ctx, request) {
  if (!ctx.staff) throw new HttpError(403, 'Das darf nur Staff.');
  const type = store.typeById(ctx.guild.id, request.body.get('type') ?? '');
  if (!type) return back('/dash/setup', 'error', 'Diese Bewerbungsart gibt es nicht.');
  settings.set(ctx.guild.id, `applications.types.${type.id}.enabled`, !type.enabled);
  await refreshPanels(ctx.guild).catch((err) => console.error('[web] Panels aktualisieren:', err.message));
  return back('/dash/setup', 'ok', `${type.name}: Bewerbungen sind jetzt ${type.enabled ? 'geöffnet' : 'geschlossen'}.`);
}

// ---------- Routen ----------

async function handle(request) {
  const [, section, a, b] = request.parts;
  if (section === 'login' && a && request.method === 'GET') return login(a);
  if (section === 'logout') return { redirect: '/', headers: { 'Set-Cookie': cookieHeader('', 0) } };
  const ctx = await authenticate(request);

  if (request.method === 'GET') {
    if (!section) return listPage(ctx, request);
    if (section === 'app' && a && !b) return detailPage(ctx, request, a.toUpperCase());
    if (section === 'stats') return statsPage(ctx, request);
    if (section === 'bans') return bansPage(ctx, request);
    if (section === 'numbers') return numbersPage(ctx);
    if (section === 'log') return logPage(ctx);
    if (section === 'setup') return setupPage(ctx, request);
  } else {
    if (section === 'app' && a && b === 'decide') return decide(ctx, request, a.toUpperCase());
    if (section === 'bans' && a === 'add') return addBan(ctx, request);
    if (section === 'bans' && a === 'lift') return liftBan(ctx, request);
    if (section === 'setup' && a === 'toggle') return toggleType(ctx, request);
  }
  throw new HttpError(404, 'Diese Seite gibt es nicht.');
}

module.exports = { handle };
