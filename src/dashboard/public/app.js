// Bewerbungs-Dashboard (ohne Framework). Alle Texte werden über textContent gesetzt, nie als HTML.
'use strict';

const app = document.getElementById('app');
const state = { me: null, guild: null, guildId: null };

// ---------- Hilfen ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else if (key === 'checked') el.checked = Boolean(value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// Ersetzt den Inhalt eines Elements; Listen werden aufgelöst, null/false übersprungen.
function put(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false).map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))));
}

function toast(message, error = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.className = ''), error ? 6000 : 2500);
}

async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Enrp': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showLogin();
    throw new Error('Nicht angemeldet.');
  }
  if (!response.ok) throw new Error(data.error || `Fehler ${response.status}`);
  return data;
}

// Führt eine Aktion aus und zeigt Fehler als Hinweis an.
async function attempt(fn, success) {
  try {
    const result = await fn();
    if (success) toast(success);
    return result;
  } catch (err) {
    toast(err.message, true);
    return undefined;
  }
}

const date = (ms) => (ms ? new Date(ms).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const STATUS_CLASS = { ACCEPTED: 'ok', REJECTED: 'bad', WITHDRAWN: '' };
const statusBadge = (status, label) => h('span', { class: `badge ${STATUS_CLASS[status] ?? 'warn'}` }, label);
const roleName = (id) => state.guild?.roles.find((r) => r.id === id)?.name ?? id;
const channelName = (id) => (id ? `#${state.guild?.channels.find((c) => c.id === id)?.name ?? id}` : '—');
const linesToList = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);
const field = (labelText, input, hint) => h('div', {}, h('label', {}, labelText), input, hint ? h('div', { class: 'muted small' }, hint) : null);
const checkbox = (labelText, checked, onchange) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), labelText);

function select(options, value, onchange, { empty } = {}) {
  const el = h('select', { onchange: (e) => onchange(e.target.value) });
  if (empty !== undefined) el.append(h('option', { value: '' }, empty));
  for (const o of options) el.append(h('option', { value: o.value, selected: o.value === value }, o.label));
  el.value = value ?? '';
  return el;
}

const channelSelect = (value, onchange, empty = '— keiner —') =>
  select(state.guild.channels.map((c) => ({ value: c.id, label: `#${c.name}${c.canSend ? '' : ' (Bot darf nicht schreiben)'}` })), value, onchange, { empty });

// Mehrfachauswahl von Rollen als Chips.
function rolePicker(values, onchange) {
  const wrap = h('div', { class: 'chips' });
  const render = () => {
    put(wrap, 
      ...values.map((id) =>
        h('span', { class: 'chip' }, `@${roleName(id)}`, h('button', { type: 'button', title: 'Entfernen', onclick: () => ((values = values.filter((v) => v !== id)), onchange(values), render()) }, '×')),
      ),
      select(
        state.guild.roles.filter((r) => !values.includes(r.id)).map((r) => ({ value: r.id, label: `@${r.name}${r.assignable ? '' : ' (über dem Bot)'}` })),
        '',
        (id) => {
          if (!id) return;
          values = [...values, id];
          onchange(values);
          render();
        },
        { empty: '+ Rolle hinzufügen' },
      ),
    );
  };
  render();
  return wrap;
}

// ---------- Rahmen ----------

function showLogin() {
  put(document.getElementById('user'), );
  put(document.getElementById('guild-nav'), );
  put(app, 
    h('div', { class: 'center' }, h('h1', {}, 'Bewerbungs-Dashboard'), h('p', { class: 'muted' }, 'Melde dich mit deinem Discord-Konto an.'), h('a', { class: 'button primary', href: '/login' }, 'Mit Discord anmelden')),
  );
}

function renderHeader() {
  const { user, guilds } = state.me;
  const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null;
  put(document.getElementById('user'), avatar ? h('img', { class: 'avatar', src: avatar, alt: '' }) : null, h('span', {}, user.name), user.isBotAdmin ? h('span', { class: 'badge warn', title: 'Voller Zugriff auf alle Server des Bots' }, 'Bot-Admin') : null, h('a', { class: 'button ghost', href: '/logout' }, 'Abmelden'));
  put(document.getElementById('guild-nav'), ...guilds.map((g) => h('a', { href: `#/g/${g.id}/apps`, class: g.id === state.guildId ? 'active' : '' }, g.name)));
}

async function route() {
  if (!state.me) {
    try {
      state.me = await api('GET', '/api/me');
    } catch {
      return;
    }
  }
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] !== 'g' || !parts[1]) {
    state.guildId = null;
    renderHeader();
    return renderGuildList();
  }
  const [, guildId, tab = 'apps', ...rest] = parts;
  if (state.guildId !== guildId || !state.guild) {
    state.guildId = guildId;
    state.guild = null;
    const guild = await attempt(() => api('GET', `/api/guilds/${guildId}`));
    if (!guild) return put(app, h('p', {}, 'Dieser Server ist nicht verfügbar.'), h('a', { href: '#/' }, 'Zur Übersicht'));
    state.guild = guild;
  }
  renderHeader();
  const tabs = [
    ['apps', 'Bewerbungen'],
    ...(state.guild.isAdmin ? [['types', 'Bewerbungsarten'], ['panels', 'Panels']] : []),
    ['bans', 'Sperren'],
    ['stats', 'Statistik'],
  ];
  const content = h('div');
  put(app, 
    h('h1', {}, state.guild.guild.name),
    h('nav', { class: 'tabs' }, tabs.map(([id, label]) => h('a', { href: `#/g/${guildId}/${id}`, class: id === tab ? 'active' : '' }, label))),
    content,
  );
  const views = { apps: renderApps, types: renderTypes, panels: renderPanels, bans: renderBans, stats: renderStats };
  await (views[tab] ?? renderApps)(content, rest);
}

async function reloadGuild() {
  state.guild = await api('GET', `/api/guilds/${state.guildId}`);
}

function renderGuildList() {
  const { guilds } = state.me;
  if (!guilds.length) {
    return put(app, h('div', { class: 'center' }, h('h1', {}, 'Keine Server'), h('p', { class: 'muted' }, 'Du hast auf keinem Server mit diesem Bot Rechte für Bewerbungen (Staff, „Server verwalten“ oder Manager-Rolle einer Bewerbung).')));
  }
  put(app, 
    h('h1', {}, 'Deine Server'),
    h('div', { class: 'grid' }, guilds.map((g) => h('a', { class: 'card item', href: `#/g/${g.id}/apps` }, g.icon ? h('img', { class: 'avatar', src: g.icon, alt: '' }) : null, h('div', { class: 'grow' }, h('div', { class: 'title' }, g.name), h('div', { class: 'muted small' }, g.isAdmin ? 'Verwaltung' : 'Bewerbungsteam'))))),
  );
}

// ---------- Bewerbungen ----------

async function renderApps(root, [number]) {
  const filters = { status: 'open', type: '', q: '' };
  const listEl = h('div', { class: 'list' });
  const detailEl = h('div');
  const load = async () => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    const list = await attempt(() => api('GET', `/api/guilds/${state.guildId}/applications?${params}`));
    if (!list) return;
    put(listEl, 
      ...(list.length
        ? list.map((r) =>
            h(
              'div',
              { class: `item${r.number === number ? ' active' : ''}`, onclick: () => (location.hash = `#/g/${state.guildId}/apps/${r.number}`) },
              h('div', { class: 'grow' }, h('div', { class: 'title' }, `${r.emoji} ${r.number} · ${r.userTag}`), h('div', { class: 'muted small' }, `${r.typeName} · ${date(r.createdAt)}${r.ai === 'hoch' ? ' · 🔴 KI-Verdacht' : ''}`)),
              statusBadge(r.status, r.statusLabel),
            ),
          )
        : [h('p', { class: 'muted' }, 'Keine Bewerbungen gefunden.')]),
    );
  };
  put(root, 
    h(
      'div',
      { class: 'split' },
      h(
        'div',
        {},
        h(
          'div',
          { class: 'card' },
          select(
            [
              { value: 'open', label: 'Offen' },
              { value: 'all', label: 'Alle' },
              { value: 'ACCEPTED', label: 'Angenommen' },
              { value: 'REJECTED', label: 'Abgelehnt' },
              { value: 'WITHDRAWN', label: 'Zurückgezogen' },
            ],
            'open',
            (v) => ((filters.status = v), load()),
          ),
          h('div', { class: 'gap' }),
          select(state.guild.types.map((t) => ({ value: t.id, label: `${t.emoji} ${t.name}` })), '', (v) => ((filters.type = v), load()), { empty: 'Alle Bewerbungsarten' }),
          h('div', { class: 'gap' }),
          h('input', { placeholder: 'Suchen: Nummer, Name, ID, Roblox …', oninput: (e) => ((filters.q = e.target.value), clearTimeout(load.t), (load.t = setTimeout(load, 300))) }),
        ),
        listEl,
      ),
      detailEl,
    ),
  );
  await load();
  if (number) await renderAppDetail(detailEl, number, load);
  else put(detailEl, h('div', { class: 'card muted' }, 'Wähle links eine Bewerbung aus.'));
}

async function renderAppDetail(root, number, reloadList) {
  const r = await attempt(() => api('GET', `/api/guilds/${state.guildId}/applications/${encodeURIComponent(number)}`));
  if (!r) return put(root, h('div', { class: 'card' }, 'Bewerbung nicht gefunden.'));
  const flagged = new Set(r.aiFlagged);
  const reason = h('textarea', { placeholder: 'Grund (optional, geht per DM an die Person)', maxlength: 1000 });
  const act = async (body) => {
    const updated = await attempt(() => api('POST', `/api/guilds/${state.guildId}/applications/${encodeURIComponent(r.number)}/decide`, body), 'Gespeichert.');
    if (updated) {
      await reloadList();
      await renderAppDetail(root, number, reloadList);
    }
  };
  const minutes = r.durationMs ? `${Math.round(r.durationMs / 60000)} Min.` : '—';
  put(root, 
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'row' }, h('h2', {}, `${r.emoji} ${r.typeName} – ${r.number}`), h('span', { class: 'spacer' }), statusBadge(r.status, r.statusLabel)),
      h('p', {}, h('strong', {}, r.userTag), ` · ${r.userId}`),
      h(
        'div',
        { class: 'fields small' },
        h('div', {}, h('label', {}, 'Eingereicht'), date(r.createdAt)),
        h('div', {}, h('label', {}, 'Dauer'), minutes),
        h('div', {}, h('label', {}, 'Auf dem Server seit'), date(r.joinedAt)),
        h('div', {}, h('label', {}, 'Discord-Konto seit'), date(r.accountCreatedAt)),
        r.roblox ? h('div', {}, h('label', {}, 'Roblox'), h('a', { href: `https://www.roblox.com/users/${r.roblox.id}/profile`, target: '_blank', rel: 'noopener' }, `${r.roblox.name} (${r.roblox.id})`)) : null,
        r.ai ? h('div', {}, h('label', {}, 'KI-Checker'), `Verdacht ${r.ai}`, r.aiReasons.length ? h('div', { class: 'muted' }, r.aiReasons.join(' · ')) : null) : null,
      ),
      r.reason ? h('p', {}, h('strong', {}, 'Grund: '), r.reason) : null,
      r.decidedBy ? h('p', { class: 'muted small' }, `Entschieden ${date(r.decidedAt)} von ${r.decidedBy}`) : null,
      r.messageUrl ? h('p', {}, h('a', { href: r.messageUrl, target: '_blank', rel: 'noopener' }, 'In Discord öffnen ↗')) : null,
    ),
    r.open
      ? h(
          'div',
          { class: 'card' },
          h('h3', {}, 'Entscheiden'),
          reason,
          h(
            'div',
            { class: 'row mt' },
            h('button', { class: 'ok', onclick: () => act({ action: 'accept', reason: reason.value }) }, '✅ Annehmen'),
            h('button', { class: 'bad', onclick: () => act({ action: 'reject', reason: reason.value }) }, '❌ Ablehnen'),
            h('span', { class: 'spacer' }),
            r.nextStatuses.length ? select(r.nextStatuses.map((s) => ({ value: s.id, label: s.label })), '', (v) => v && act({ status: v }), { empty: 'Status ändern …' }) : null,
          ),
        )
      : null,
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Antworten'),
      r.answers.map((a, i) => h('div', { class: 'answer' }, h('div', { class: 'q' }, `${i + 1}. ${flagged.has(a.question) ? '⚠️ ' : ''}${a.question}`), h('div', { class: 'a' }, a.answer || '—'))),
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Verlauf'),
      h('table', {}, r.history.map((e) => h('tr', {}, h('td', {}, date(e.at)), h('td', {}, state.guild.statuses[e.status] ?? e.status), h('td', { class: 'muted' }, e.by ?? 'System'), h('td', {}, e.reason ?? '')))),
      r.previous.length ? [h('h3', { class: 'mt' }, 'Frühere Bewerbungen dieser Person'), r.previous.map((p) => h('div', {}, h('a', { href: `#/g/${state.guildId}/apps/${p.number}` }, `${p.number} ${p.typeName}`), ' – ', p.statusLabel, ` (${date(p.createdAt)})`))] : null,
    ),
    state.guild.isAdmin
      ? h(
          'button',
          {
            class: 'ghost',
            onclick: async () => {
              if (!confirm(`Bewerbung ${r.number} endgültig löschen?`)) return;
              if (await attempt(() => api('DELETE', `/api/guilds/${state.guildId}/applications/${encodeURIComponent(r.number)}`), 'Gelöscht.')) location.hash = `#/g/${state.guildId}/apps`;
            },
          },
          '🗑️ Bewerbung löschen',
        )
      : null,
  );
}

// ---------- Bewerbungsarten ----------

async function renderTypes(root, [typeId]) {
  const types = state.guild.types;
  const panels = state.guild.panels;
  const detail = h('div');
  put(root, 
    h(
      'div',
      { class: 'split' },
      h(
        'div',
        {},
        h('div', { class: 'row mb' }, h('button', { class: 'primary', onclick: () => renderCreateType(detail) }, '+ Neue Bewerbungsart')),
        Object.entries(panels).map(([panelId, panel]) =>
          h(
            'div',
            { class: 'card' },
            h('h3', {}, panel.title, h('span', { class: 'muted small' }, ` (${panelId})`)),
            h(
              'div',
              { class: 'list' },
              types
                .filter((t) => t.panel === panelId)
                .map((t) =>
                  h(
                    'div',
                    { class: `item${t.id === typeId ? ' active' : ''}`, onclick: () => (location.hash = `#/g/${state.guildId}/types/${t.id}`) },
                    h('div', { class: 'grow' }, h('div', { class: 'title' }, `${t.emoji} ${t.name}`), h('div', { class: 'muted small' }, `${t.id} · ${t.numberPrefix}-0001 · ${t.questions.length} Fragen`)),
                    h('span', { class: `badge ${t.enabled ? 'ok' : ''}` }, t.enabled ? 'offen' : 'geschlossen'),
                  ),
                ),
            ),
          ),
        ),
      ),
      detail,
    ),
  );
  const type = types.find((t) => t.id === typeId);
  if (type) renderTypeEditor(detail, structuredClone(type));
  else put(detail, h('div', { class: 'card muted' }, 'Wähle links eine Bewerbungsart oder lege eine neue an.'));
}

function renderCreateType(root) {
  const form = { id: '', name: '', template: 'leer', copyFrom: '', panel: Object.keys(state.guild.panels)[0], prefix: '', emoji: '' };
  put(root, 
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Neue Bewerbungsart'),
      h(
        'div',
        { class: 'fields' },
        field('ID *', h('input', { placeholder: 'z. B. feuerwehr', maxlength: 24, oninput: (e) => (form.id = e.target.value) }), 'a-z, 0-9, _ und -'),
        field('Name', h('input', { placeholder: 'z. B. Feuerwehr-Bewerbung', maxlength: 80, oninput: (e) => (form.name = e.target.value) })),
        field('Vorlage', select(state.guild.templates.map((t) => ({ value: t.value, label: t.name })), 'leer', (v) => (form.template = v))),
        field('… oder kopieren von', select(state.guild.types.map((t) => ({ value: t.id, label: t.name })), '', (v) => (form.copyFrom = v), { empty: '— nicht kopieren —' })),
        field('Panel', select(Object.entries(state.guild.panels).map(([id, p]) => ({ value: id, label: p.title })), form.panel, (v) => (form.panel = v))),
        field('Nummern-Präfix', h('input', { placeholder: 'automatisch', maxlength: 10, oninput: (e) => (form.prefix = e.target.value) }), 'z. B. FW → FW-0001'),
        field('Emoji', h('input', { placeholder: 'aus der Vorlage', maxlength: 60, oninput: (e) => (form.emoji = e.target.value) })),
      ),
      h(
        'div',
        { class: 'row mt' },
        h(
          'button',
          {
            class: 'primary',
            onclick: async () => {
              const body = { ...form, emoji: form.emoji || undefined };
              const type = await attempt(() => api('POST', `/api/guilds/${state.guildId}/types`, body), 'Angelegt.');
              if (!type) return;
              await reloadGuild();
              location.hash = `#/g/${state.guildId}/types/${type.id}`;
            },
          },
          'Anlegen',
        ),
      ),
    ),
  );
}

const ROLE_FIELDS = [
  ['managers', 'Manager (dürfen entscheiden)'],
  ['ping', 'Bei neuen Bewerbungen pingen'],
  ['required', 'Erforderliche Rollen'],
  ['blocked', 'Gesperrte Rollen'],
  ['acceptAdd', 'Bei Annahme geben'],
  ['acceptRemove', 'Bei Annahme nehmen'],
  ['rejectAdd', 'Bei Ablehnung geben'],
  ['rejectRemove', 'Bei Ablehnung nehmen'],
  ['pending', 'Solange offen geben'],
  ['removeOnSubmit', 'Beim Einreichen nehmen'],
];

function renderTypeEditor(root, type) {
  const originalId = type.id;
  let stagesText = type.stages.map((s) => s.label).join('\n');
  const questionsEl = h('div');

  const renderQuestions = () => {
    put(questionsEl, 
      ...type.questions.map((q, index) => {
        const move = (delta) => {
          const target = index + delta;
          [type.questions[index], type.questions[target]] = [type.questions[target], type.questions[index]];
          renderQuestions();
        };
        const extra = [];
        if (q.type === 'TEXT') {
          extra.push(
            h(
              'div',
              { class: 'fields' },
              field('Mindestens Zeichen', h('input', { type: 'number', min: 0, max: 5000, value: q.min ?? '', oninput: (e) => (q.min = e.target.value ? Number(e.target.value) : undefined) })),
              field('Höchstens Zeichen', h('input', { type: 'number', min: 1, max: 5000, value: q.max ?? '', oninput: (e) => (q.max = e.target.value ? Number(e.target.value) : undefined) })),
            ),
          );
        }
        if (q.type === 'CHOICE') {
          extra.push(
            field(
              'Optionen (eine je Zeile, optional „Name | Beschreibung“)',
              h('textarea', {
                value: (q.options ?? []).map((o) => (o.description ? `${o.label} | ${o.description}` : o.label)).join('\n'),
                oninput: (e) =>
                  (q.options = linesToList(e.target.value).map((line) => {
                    const [label, description] = line.split('|').map((p) => p.trim());
                    return description ? { label, description } : { label };
                  })),
              }),
            ),
            checkbox('Mehrfachauswahl', q.multiple, (v) => (q.multiple = v)),
          );
        }
        if (q.type === 'ROLE') {
          extra.push(
            field('Wählbare Rollen (werden bei Annahme vergeben)', rolePicker((q.options ?? []).map((o) => o.roleId), (ids) => (q.options = ids.map((roleId) => ({ roleId }))))),
            checkbox('Mehrfachauswahl', q.multiple, (v) => (q.multiple = v)),
          );
        }
        return h(
          'div',
          { class: 'question' },
          h(
            'div',
            { class: 'row' },
            h('strong', {}, `${index + 1}.`),
            h('span', { class: 'badge' }, state.guild.questionTypes[q.type]),
            h('span', { class: 'spacer' }),
            h('button', { class: 'icon', title: 'Nach oben', disabled: index === 0, onclick: () => move(-1) }, '↑'),
            h('button', { class: 'icon', title: 'Nach unten', disabled: index === type.questions.length - 1, onclick: () => move(1) }, '↓'),
            h('button', { class: 'icon', title: 'Löschen', onclick: () => (type.questions.splice(index, 1), renderQuestions()) }, '🗑️'),
          ),
          field('Frage', h('textarea', { value: q.label ?? '', maxlength: 250, rows: 2, oninput: (e) => (q.label = e.target.value) })),
          field('Zusatztext (optional)', h('input', { value: q.description ?? '', maxlength: 500, oninput: (e) => (q.description = e.target.value) })),
          checkbox('Pflichtfrage', q.required !== false, (v) => (q.required = v)),
          extra,
        );
      }),
      h(
        'div',
        { class: 'row' },
        select(Object.entries(state.guild.questionTypes).map(([value, label]) => ({ value, label: `+ ${label}` })), '', (kind) => {
          if (!kind) return;
          if (type.questions.length >= 50) return toast('Höchstens 50 Fragen.', true);
          type.questions.push({ type: kind, label: '', required: true, ...(kind === 'CHOICE' || kind === 'ROLE' ? { options: [], multiple: false } : {}) });
          renderQuestions();
        }, { empty: '+ Frage hinzufügen …' }),
      ),
    );
  };
  renderQuestions();

  const save = async () => {
    const body = {
      id: type.id,
      name: type.name,
      emoji: type.emoji,
      description: type.description,
      numberPrefix: type.numberPrefix,
      panel: type.panel,
      enabled: type.enabled,
      teamThreads: type.teamThreads,
      onLeave: type.onLeave,
      cooldownMinutes: Number(type.cooldownMinutes),
      timeLimitMinutes: Number(type.timeLimitMinutes),
      stages: linesToList(stagesText),
      messages: type.messages,
      channels: type.channels,
      roles: type.roles,
      questions: type.questions,
    };
    const saved = await attempt(() => api('PUT', `/api/guilds/${state.guildId}/types/${encodeURIComponent(originalId)}`, body), 'Gespeichert. Gepostete Panels werden aktualisiert.');
    if (!saved) return;
    await reloadGuild();
    location.hash = `#/g/${state.guildId}/types/${saved.id}`;
    if (saved.id === originalId) route();
  };

  const vars = '{applicant} {applicationName} {number} {user} {reason} {questionCount} {timeLimit}';
  put(root, 
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'row' }, h('h2', {}, `${type.emoji} ${type.name}`), h('span', { class: 'spacer' }), h('button', { class: 'primary', onclick: save }, '💾 Speichern')),
      h('p', { class: 'muted small' }, 'Änderungen gelten nach dem Speichern sofort, nur auf diesem Server. Wer die Bewerbung gerade ausfüllt, behält die alten Fragen.'),
      h(
        'div',
        { class: 'fields' },
        field('Name', h('input', { value: type.name, maxlength: 80, oninput: (e) => (type.name = e.target.value) })),
        field('ID', h('input', { value: type.id, maxlength: 24, oninput: (e) => (type.id = e.target.value) }), 'Bisherige Bewerbungen und Sperren ziehen mit'),
        field('Nummern-Präfix', h('input', { value: type.numberPrefix, maxlength: 10, oninput: (e) => (type.numberPrefix = e.target.value) }), 'z. B. FW → FW-0001'),
        field('Emoji', h('input', { value: type.emoji, maxlength: 60, oninput: (e) => (type.emoji = e.target.value) })),
        field('Panel', select(Object.entries(state.guild.panels).map(([id, p]) => ({ value: id, label: p.title })), type.panel, (v) => (type.panel = v))),
      ),
      field('Beschreibung (im Panel)', h('textarea', { value: type.description, maxlength: 1000, oninput: (e) => (type.description = e.target.value) })),
      checkbox('Bewerbungen werden angenommen (offen)', type.enabled, (v) => (type.enabled = v)),
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, `Fragen (${type.questions.length})`),
      questionsEl,
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Ablauf'),
      field('Prüfschritte (einer je Zeile)', h('textarea', { value: stagesText, placeholder: 'In Prüfung\nGespräch\nEntscheidung ausstehend', oninput: (e) => (stagesText = e.target.value) }), 'Leer = nur Annehmen/Ablehnen. Im Status-Menü frei wechselbar.'),
      h(
        'div',
        { class: 'fields' },
        field('Wartezeit (Minuten)', h('input', { type: 'number', min: 0, max: 525600, value: type.cooldownMinutes, oninput: (e) => (type.cooldownMinutes = e.target.value) }), '1440 = 1 Tag'),
        field('Zeitlimit zum Ausfüllen (Minuten)', h('input', { type: 'number', min: 5, max: 10080, value: type.timeLimitMinutes, oninput: (e) => (type.timeLimitMinutes = e.target.value) })),
        field(
          'Wenn die Person den Server verlässt',
          select(
            [
              { value: 'WITHDRAW', label: 'Zurückziehen' },
              { value: 'DENY', label: 'Ablehnen' },
              { value: 'NONE', label: 'Nichts tun' },
            ],
            type.onLeave,
            (v) => (type.onLeave = v),
          ),
        ),
      ),
      checkbox('Team-Thread zu jeder Bewerbung', type.teamThreads, (v) => (type.teamThreads = v)),
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Kanäle'),
      h(
        'div',
        { class: 'fields' },
        field('Neue Bewerbungen', channelSelect(type.channels.open, (v) => (type.channels.open = v), `— Kanal des Panels (${channelName(state.guild.panels[type.panel]?.channel)}) —`)),
        field('Kopie angenommener', channelSelect(type.channels.accepted, (v) => (type.channels.accepted = v))),
        field('Kopie abgelehnter', channelSelect(type.channels.rejected, (v) => (type.channels.rejected = v))),
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Rollen'),
      ROLE_FIELDS.map(([key, labelText]) => field(labelText, rolePicker(type.roles[key] ?? [], (ids) => (type.roles[key] = ids)))),
      h(
        'div',
        { class: 'fields' },
        field(
          'Erforderliche Rollen: welche?',
          select(
            [
              { value: 'all', label: 'Alle' },
              { value: 'any', label: 'Mindestens eine' },
            ],
            type.roles.requiredMode,
            (v) => (type.roles.requiredMode = v),
          ),
        ),
        field(
          'Gesperrt, wenn die Person … hat',
          select(
            [
              { value: 'any', label: 'eine der gesperrten Rollen' },
              { value: 'all', label: 'alle gesperrten Rollen' },
            ],
            type.roles.blockedMode,
            (v) => (type.roles.blockedMode = v),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Texte (per Direktnachricht)'),
      h('p', { class: 'muted small' }, `Variablen: ${vars}`),
      [
        ['start', 'Startnachricht'],
        ['finish', 'Nach dem Einreichen'],
        ['accept', 'Bei Annahme'],
        ['reject', 'Bei Ablehnung (Grund wird automatisch angehängt)'],
      ].map(([key, labelText]) => field(labelText, h('textarea', { value: type.messages[key], maxlength: 2000, oninput: (e) => (type.messages[key] = e.target.value) }))),
    ),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'primary', onclick: save }, '💾 Speichern'),
      h('button', { onclick: () => moveType(originalId, -1) }, '↑ im Panel nach oben'),
      h('button', { onclick: () => moveType(originalId, 1) }, '↓ nach unten'),
      h('span', { class: 'spacer' }),
      h(
        'button',
        {
          class: 'bad',
          onclick: async () => {
            if (!confirm(`„${type.name}“ löschen? Bisherige Bewerbungen bleiben gespeichert.`)) return;
            if (!(await attempt(() => api('DELETE', `/api/guilds/${state.guildId}/types/${encodeURIComponent(originalId)}`), 'Gelöscht.'))) return;
            await reloadGuild();
            location.hash = `#/g/${state.guildId}/types`;
          },
        },
        '🗑️ Löschen',
      ),
    ),
  );
}

async function moveType(id, delta) {
  if (!(await attempt(() => api('POST', `/api/guilds/${state.guildId}/types/${encodeURIComponent(id)}/move`, { delta })))) return;
  await reloadGuild();
  route();
}

// ---------- Panels ----------

function renderPanels(root) {
  const created = { id: '', title: '' };
  put(root, 
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Neues Panel'),
      h(
        'div',
        { class: 'fields' },
        field('ID', h('input', { placeholder: 'z. B. fraktionen', maxlength: 24, oninput: (e) => (created.id = e.target.value) })),
        field('Titel', h('input', { placeholder: 'z. B. 🚓 Fraktionen', maxlength: 200, oninput: (e) => (created.title = e.target.value) })),
      ),
      h(
        'button',
        {
          class: 'primary',
          onclick: async () => {
            if (!(await attempt(() => api('POST', `/api/guilds/${state.guildId}/panels`, created), 'Panel angelegt.'))) return;
            await reloadGuild();
            route();
          },
        },
        'Anlegen',
      ),
    ),
    Object.entries(state.guild.panels).map(([id, original]) => {
      const panel = { ...original };
      let postTo = '';
      let moveTo = '';
      const types = state.guild.types.filter((t) => t.panel === id);
      return h(
        'div',
        { class: 'card' },
        h('h2', {}, panel.title, h('span', { class: 'muted small' }, ` (${id})`)),
        h('p', { class: 'muted small' }, types.length ? `Bewerbungsarten: ${types.map((t) => t.name).join(', ')}` : 'Noch keine Bewerbungsarten – ordne sie im Tab „Bewerbungsarten“ zu.'),
        h(
          'div',
          { class: 'fields' },
          field('Titel', h('input', { value: panel.title, maxlength: 200, oninput: (e) => (panel.title = e.target.value) })),
          field('Bild-URL', h('input', { value: panel.image, placeholder: 'https://…', maxlength: 500, oninput: (e) => (panel.image = e.target.value) })),
          field('Text im Auswahlmenü', h('input', { value: panel.placeholder, maxlength: 150, oninput: (e) => (panel.placeholder = e.target.value) })),
          field('Team-Kanal für neue Bewerbungen', channelSelect(panel.channel, (v) => (panel.channel = v))),
        ),
        field('Beschreibung (Markdown)', h('textarea', { value: panel.description, maxlength: 3000, oninput: (e) => (panel.description = e.target.value) })),
        checkbox('Bewerbungsarten mit Beschreibung im Panel auflisten', panel.showList, (v) => (panel.showList = v)),
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: 'primary',
              onclick: async () => {
                if (!(await attempt(() => api('PUT', `/api/guilds/${state.guildId}/panels/${id}`, panel), 'Gespeichert. Gepostete Panels werden aktualisiert.'))) return;
                await reloadGuild();
              },
            },
            '💾 Speichern',
          ),
          h('span', { class: 'spacer' }),
          channelSelect('', (v) => (postTo = v), 'Kanal zum Posten …'),
          h(
            'button',
            {
              onclick: async () => {
                if (!postTo) return toast('Bitte einen Kanal wählen.', true);
                await attempt(() => api('POST', `/api/guilds/${state.guildId}/panels/${id}/post`, { channelId: postTo }), 'Panel gepostet.');
              },
            },
            '📤 Posten',
          ),
        ),
        h(
          'div',
          { class: 'row mt' },
          types.length
            ? select(Object.entries(state.guild.panels).filter(([other]) => other !== id).map(([other, p]) => ({ value: other, label: `Arten verschieben nach: ${p.title}` })), '', (v) => (moveTo = v), { empty: 'Arten verschieben nach …' })
            : null,
          h(
            'button',
            {
              class: 'bad',
              onclick: async () => {
                if (!confirm(`Panel „${panel.title}“ löschen?`)) return;
                if (!(await attempt(() => api('DELETE', `/api/guilds/${state.guildId}/panels/${id}?moveTo=${encodeURIComponent(moveTo)}`), 'Panel gelöscht.'))) return;
                await reloadGuild();
                route();
              },
            },
            '🗑️ Panel löschen',
          ),
        ),
      );
    }),
  );
}

// ---------- Sperren ----------

async function renderBans(root) {
  const bans = await attempt(() => api('GET', `/api/guilds/${state.guildId}/bans`));
  if (!bans) return;
  const form = { discordId: '', roblox: '', scope: '*', reason: '', days: '' };
  const scopeName = (scope) => (scope === '*' ? 'Alle Bewerbungen' : state.guild.types.find((t) => t.id === scope)?.name ?? scope);
  put(root, 
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Neue Sperre'),
      h(
        'div',
        { class: 'fields' },
        field('Discord-ID', h('input', { placeholder: '123456789012345678', oninput: (e) => (form.discordId = e.target.value.trim()) })),
        field('und/oder Roblox-Name', h('input', { maxlength: 20, oninput: (e) => (form.roblox = e.target.value) })),
        field('Bereich', select([{ value: '*', label: 'Alle Bewerbungen' }, ...state.guild.types.map((t) => ({ value: t.id, label: t.name }))], '*', (v) => (form.scope = v))),
        field('Dauer in Tagen', h('input', { type: 'number', min: 1, max: 3650, placeholder: 'leer = unbegrenzt', oninput: (e) => (form.days = e.target.value) })),
      ),
      field('Grund (sieht die Person)', h('input', { maxlength: 500, oninput: (e) => (form.reason = e.target.value) })),
      h(
        'button',
        {
          class: 'bad',
          
          onclick: async () => {
            if (await attempt(() => api('POST', `/api/guilds/${state.guildId}/bans`, { ...form, days: form.days ? Number(form.days) : null }), 'Sperre angelegt.')) renderBans(root);
          },
        },
        '🚫 Sperren',
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Sperren'),
      bans.length
        ? h(
            'table',
            {},
            h('tr', {}, h('th', {}, 'ID'), h('th', {}, 'Person'), h('th', {}, 'Bereich'), h('th', {}, 'Grund'), h('th', {}, 'Bis'), h('th', {})),
            bans.map((b) =>
              h(
                'tr',
                { class: b.active ? '' : 'muted' },
                h('td', {}, b.id),
                h('td', {}, [b.discordId, b.robloxName && `Roblox ${b.robloxName}`].filter(Boolean).join(' · ')),
                h('td', {}, b.scopes.map(scopeName).join(', ')),
                h('td', {}, b.reason),
                h('td', {}, b.liftedAt ? 'aufgehoben' : b.expiresAt ? date(b.expiresAt) : 'unbegrenzt'),
                h('td', {}, b.active ? h('button', { onclick: async () => (await attempt(() => api('DELETE', `/api/guilds/${state.guildId}/bans/${b.id}`), 'Aufgehoben.')) && renderBans(root) }, 'Aufheben') : null),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Keine Sperren.'),
    ),
  );
}

// ---------- Statistik ----------

async function renderStats(root) {
  let days = 30;
  let type = '';
  const out = h('div');
  const load = async () => {
    const stats = await attempt(() => api('GET', `/api/guilds/${state.guildId}/stats?days=${days}&type=${encodeURIComponent(type)}`));
    if (!stats) return;
    // Erwähnungen <@id> lesbar machen; Code-Blöcke als <pre>
    const clean = (text) => text.replace(/<@(\d+)>/g, '@$1').replace(/\*\*/g, '');
    put(out, 
      h('p', { class: 'muted' }, clean(stats.description ?? '')),
      h(
        'div',
        { class: 'grid' },
        (stats.fields ?? []).map((f) =>
          h('div', { class: f.inline ? 'card' : 'card full' }, h('h3', {}, f.name), f.value.startsWith('```') ? h('pre', {}, f.value.replace(/```/g, '').trim()) : h('div', { class: 'pre' }, clean(f.value).replace(/`/g, ''))),
        ),
      ),
    );
  };
  put(root, 
    h(
      'div',
      { class: 'row card' },
      select(
        [7, 30, 90, 365].map((d) => ({ value: String(d), label: `Letzte ${d} Tage` })),
        '30',
        (v) => ((days = Number(v)), load()),
      ),
      select(state.guild.types.map((t) => ({ value: t.id, label: t.name })), '', (v) => ((type = v), load()), { empty: 'Alle Bewerbungsarten' }),
    ),
    out,
  );
  await load();
}

window.addEventListener('hashchange', route);
route();
