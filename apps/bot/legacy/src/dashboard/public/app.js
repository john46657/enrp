// Dashboard-Oberfläche: Routing, API, Formularfelder und Speicherleiste. Die Seiten selbst stehen in pages.js.
'use strict';

const state = { me: null, guild: null, draft: null, changes: new Map(), pages: [] };

// ---------- Hilfen ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'html') el.innerHTML = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// Wie el.replaceChildren, überspringt aber null/false/undefined.
const setChildren = (el, ...children) => el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Dashboard': '1', ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('Nicht angemeldet');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

function toast(text, error = false) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: `toast${error ? ' error' : ''}` }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

const getPath = (obj, path) => path.split('.').reduce((o, key) => (Array.isArray(o) ? o.find((e) => e.id === key) : o?.[key]), obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, key) => (Array.isArray(o) ? o.find((e) => e.id === key) : o[key]), obj);
  target[last] = value;
}
const guildIconNode = (g) => h('div', { class: 'guild-icon' }, g.icon ? h('img', { src: g.icon.startsWith('http') ? g.icon : `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128`, alt: '' }) : g.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase());

// ---------- Änderungen ----------

// Merkt sich einen geänderten Pfad. Gesendet wird beim Speichern der aktuelle Wert aus dem Entwurf.
function markDirty(path) {
  for (const key of state.changes.keys()) if (path === key || path.startsWith(`${key}.`)) return updateSavebar();
  for (const key of [...state.changes.keys()]) if (key.startsWith(`${path}.`)) state.changes.delete(key);
  state.changes.set(path, true);
  updateSavebar();
}
const bindPath = (path) => ({
  get: () => getPath(state.draft, path),
  set: (value) => {
    setPath(state.draft, path, value);
    markDirty(path);
  },
});
// Feld eines Listeneintrags; markiert die ganze Liste als geändert.
const bindItem = (listPath, item, key) => ({
  get: () => item[key],
  set: (value) => {
    if (value === undefined) delete item[key];
    else item[key] = value;
    markDirty(listPath);
  },
});

async function saveChanges() {
  const changes = [...state.changes.keys()].map((path) => ({ path, value: getPath(state.draft, path) }));
  try {
    const result = await api(`/api/guilds/${state.guild.guild.id}/settings`, { method: 'PUT', body: { changes } });
    state.guild.config = result.config;
    state.draft = structuredClone(result.config);
    state.changes.clear();
    toast('✅ Gespeichert');
    render();
  } catch (err) {
    toast(err.message, true);
  }
}
function discardChanges() {
  state.draft = structuredClone(state.guild.config);
  state.changes.clear();
  render();
}
function updateSavebar() {
  document.querySelector('.savebar')?.remove();
  if (!state.changes.size) return;
  document.body.append(
    h(
      'div',
      { class: 'savebar' },
      h('span', { class: 'pulse' }),
      h('span', {}, 'Ungespeicherte Änderungen'),
      h('button', { class: 'btn ghost small', onclick: discardChanges }, 'Verwerfen'),
      h('button', { class: 'btn primary small', onclick: saveChanges }, 'Speichern'),
    ),
  );
}
window.addEventListener('beforeunload', (e) => {
  if (state.changes.size) e.preventDefault();
});

// ---------- Formularfelder ----------

const ui = {
  field({ label, help, wide }, control) {
    return h('div', { class: `field${wide ? ' wide' : ''}` }, label && h('label', {}, label), control, help && h('div', { class: 'help', html: help }));
  },
  toggle(b, label) {
    const input = h('input', { type: 'checkbox', onchange: (e) => b.set(e.target.checked) });
    input.checked = Boolean(b.get());
    return h('label', { class: 'toggle' }, input, h('span', { class: 'switch' }), h('span', {}, label));
  },
  text(b, { placeholder, max, type = 'text' } = {}) {
    return h('input', { type, value: b.get() ?? '', placeholder, maxlength: max, oninput: (e) => b.set(e.target.value) });
  },
  textarea(b, { placeholder, max, rows } = {}) {
    const el = h('textarea', { placeholder, maxlength: max, rows, oninput: (e) => b.set(e.target.value) });
    el.value = b.get() ?? '';
    return el;
  },
  number(b, { min = 0, max, step = 1 } = {}) {
    return h('input', {
      type: 'number',
      value: b.get() ?? 0,
      min,
      max,
      step,
      oninput: (e) => {
        if (e.target.value === '') return;
        const n = Math.min(max ?? Infinity, Math.max(min, Number(e.target.value)));
        b.set(Number.isFinite(n) ? n : min);
      },
    });
  },
  select(b, options) {
    const el = h('select', { onchange: (e) => b.set(e.target.value) }, options.map(([value, label]) => h('option', { value }, label)));
    el.value = b.get() ?? options[0]?.[0] ?? '';
    return el;
  },
  // kind: text (Text-/Ankündigungskanäle), voice, category
  channel(b, { kind = 'text', empty = '— Kein Kanal —' } = {}) {
    const types = { text: [0, 5], voice: [2], category: [4] }[kind];
    const channels = state.guild.channels.filter((c) => types.includes(c.type));
    return ui.select(b, [['', empty], ...channels.map((c) => [c.id, kind === 'category' ? c.name : `${kind === 'voice' ? '🔊' : '#'} ${c.name}`])]);
  },
  role(b, { empty = '— Keine Rolle —' } = {}) {
    return ui.select(b, [['', empty], ...state.guild.roles.filter((r) => !r.managed).map((r) => [r.id, `@${r.name}`])]);
  },
  roles(b) {
    const wrap = h('div', { class: 'multi' });
    const draw = () => {
      const selected = b.get() ?? [];
      const pills = selected.map((id) => {
        const role = state.guild.roles.find((r) => r.id === id);
        return h(
          'span',
          { class: 'pill' },
          h('span', { class: 'swatch', style: `background:${role?.color && role.color !== '#000000' ? role.color : '#8b90a0'}` }),
          role ? role.name : `unbekannt (${id})`,
          h('button', { title: 'Entfernen', onclick: () => (b.set(selected.filter((x) => x !== id)), draw()) }, '×'),
        );
      });
      const add = h(
        'select',
        { onchange: (e) => e.target.value && (b.set([...selected, e.target.value]), draw()) },
        h('option', { value: '' }, 'Rolle hinzufügen …'),
        state.guild.roles.filter((r) => !r.managed && !selected.includes(r.id)).map((r) => h('option', { value: r.id }, `@${r.name}`)),
      );
      setChildren(wrap, selected.length ? h('div', { class: 'pills' }, pills) : null, add);
    };
    draw();
    return wrap;
  },
  // Zeitzone aus der Liste des Browsers (IANA-Namen wie Europe/Berlin).
  timezone(b) {
    const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['Europe/Berlin'];
    const current = b.get() || 'Europe/Berlin';
    const now = new Date();
    const label = (zone) => {
      const time = now.toLocaleTimeString('de-DE', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
      return `${zone.replace(/_/g, ' ')} (${time})`;
    };
    return ui.select(b, (zones.includes(current) ? zones : [current, ...zones]).map((z) => [z, label(z)]));
  },
  // Liste von Texten, eine Zeile je Eintrag (z. B. erlaubte Domains).
  lines(b, { placeholder } = {}) {
    const el = h('textarea', {
      placeholder,
      oninput: (e) =>
        b.set(
          e.target.value
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
    });
    el.value = (b.get() ?? []).join('\n');
    return el;
  },
};

// Feldbeschreibung aus pages.js → Element. { t: 'toggle', p: 'pfad', label, help, wide, …Optionen }
function renderField(spec, bind = bindPath(spec.p)) {
  if (spec.t === 'toggle') return ui.field({ help: spec.help, wide: spec.wide ?? true }, ui.toggle(bind, spec.label));
  const control = spec.t === 'select' ? ui.select(bind, spec.options) : ui[spec.t](bind, spec);
  return ui.field(spec, control);
}

function card(title, desc, body, { actions, single, id } = {}) {
  return h(
    'section',
    { class: 'card', id },
    h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, title), desc && h('p', { html: desc })), actions),
    h('div', { class: `card-body${single ? ' single' : ''}` }, body),
  );
}

async function runAction(name, body, success) {
  try {
    await api(`/api/guilds/${state.guild.guild.id}/actions/${name}`, { method: 'POST', body: body ?? {} });
    toast(success ?? '✅ Erledigt');
  } catch (err) {
    toast(err.message, true);
  }
}
const live = (name) => api(`/api/guilds/${state.guild.guild.id}/live/${name}`);

// ---------- Seiten ----------

function page(definition) {
  state.pages.push(definition);
}

function renderSidebar(current) {
  const g = state.guild.guild;
  const groups = [];
  for (const p of state.pages.filter(available)) {
    let group = groups.find((x) => x.name === (p.group ?? ''));
    if (!group) groups.push((group = { name: p.group ?? '', pages: [] }));
    group.pages.push(p);
  }
  return h(
    'aside',
    { class: 'sidebar' },
    h('div', { class: 'brand' }, h('img', { src: state.me.bot.avatar, alt: '' }), state.me.bot.brand),
    h('a', { href: '#/', class: 'muted small' }, '← Alle Server'),
    h('div', { class: 'guild-head' }, guildIconNode(g), h('div', {}, h('b', {}, g.name), h('div', { class: 'muted small' }, `${g.memberCount} Mitglieder`))),
    groups.map((group) => [
      group.name && h('div', { class: 'nav-group' }, group.name),
      h(
        'nav',
        { class: 'nav' },
        group.pages.map((p) =>
          h(
            'a',
            { href: `#/g/${g.id}/${p.id}`, class: p.id === current ? 'active' : '' },
            h('span', {}, p.icon),
            p.title,
            p.enabledPath && h('span', { class: `dot${getPath(state.draft, p.enabledPath) ? ' on' : ''}` }),
          ),
        ),
      ),
    ]),
  );
}

const available = (p) => !p.requires || p.requires in state.guild.config;

function renderPage(p) {
  const nodes = [h('h1', {}, p.title), p.desc && h('p', { class: 'lead', html: p.desc })];
  if (p.enabledPath) {
    const on = Boolean(getPath(state.draft, p.enabledPath));
    nodes.push(
      h(
        'div',
        { class: `banner${on ? ' on' : ''}` },
        h('div', {}, h('b', {}, `${p.title} ${on ? 'aktiv' : 'deaktiviert'}`), h('span', {}, on ? p.onText ?? 'Das Modul ist eingeschaltet.' : p.offText ?? 'Das Modul ist ausgeschaltet.')),
        h(
          'button',
          {
            class: `btn ${on ? 'ghost' : 'danger'}`,
            onclick: () => {
              bindPath(p.enabledPath).set(!on);
              render();
            },
          },
          on ? 'Deaktivieren' : 'Aktivieren',
        ),
      ),
    );
  }
  const sections = (typeof p.sections === 'function' ? p.sections() : p.sections).filter(Boolean);
  if (sections.length > 2) {
    nodes.push(
      h(
        'div',
        { class: 'chips' },
        sections.map((s, i) => h('button', { class: 'chip', onclick: () => document.getElementById(`s-${i}`)?.scrollIntoView({ behavior: 'smooth' }) }, s.title)),
      ),
    );
  }
  sections.forEach((s, i) => {
    const body = s.render ? s.render() : s.fields.filter(Boolean).map((f) => renderField(f));
    nodes.push(card(s.title, s.desc, body, { actions: s.actions?.(), single: s.single ?? Boolean(s.render), id: `s-${i}` }));
  });
  return nodes;
}

function renderGuild(pageId) {
  const p = state.pages.find((x) => x.id === pageId && available(x)) ?? state.pages[0];
  const sidebar = renderSidebar(p.id);
  const content = h('div', { class: 'content' }, renderPage(p));
  const app = document.getElementById('app');
  app.replaceChildren(
    h(
      'div',
      { class: 'layout' },
      sidebar,
      h(
        'main',
        { class: 'main' },
        h(
          'div',
          { class: 'topbar' },
          h('div', {}, h('button', { class: 'btn ghost small menu-toggle', onclick: () => sidebar.classList.toggle('open') }, '☰'), ' ', h('span', { class: 'crumbs' }, 'Server / ', h('b', {}, state.guild.guild.name))),
          userBox(),
        ),
        content,
      ),
    ),
  );
  document.title = `${p.title} · ${state.guild.guild.name}`;
  updateSavebar();
}

function userBox() {
  const u = state.me.user;
  const avatar = u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : 'https://cdn.discordapp.com/embed/avatars/0.png';
  return h(
    'div',
    { class: 'user' },
    h('img', { class: 'avatar', src: avatar, alt: '' }),
    h('span', {}, u.globalName || u.username),
    u.isBotAdmin && h('span', { class: 'badge yellow', title: 'Voller Zugriff auf alle Server des Bots' }, 'Bot-Admin'),
    h('button', { class: 'btn ghost small', onclick: async () => (await api('/logout', { method: 'POST' }), (location.href = '/')) }, 'Abmelden'),
  );
}

function renderServers() {
  const withBot = state.me.guilds.filter((g) => g.botIn);
  const without = state.me.guilds.filter((g) => !g.botIn);
  const search = h('input', { type: 'text', placeholder: 'Server suchen …', oninput: () => draw() });
  const list = h('div');
  const serverCard = (g) =>
    h(
      'div',
      { class: `server${g.botIn ? '' : ' invite'}` },
      guildIconNode(g),
      h('h3', {}, g.name),
      h('div', { class: 'pills' }, h('span', { class: `badge ${g.botIn ? 'green' : ''}` }, g.botIn ? '● Aktiv' : 'Nicht eingeladen'), g.owner && h('span', { class: 'badge yellow' }, 'Besitzer')),
      g.botIn ? h('a', { class: 'btn primary', href: `#/g/${g.id}` }, 'Verwalten ›') : h('a', { class: 'btn', href: g.invite, target: '_blank', rel: 'noopener' }, '+ Bot einladen'),
    );
  const draw = () => {
    const q = search.value.toLowerCase();
    const match = (g) => g.name.toLowerCase().includes(q);
    setChildren(
      list,
      h('div', { class: 'section-title' }, `Mit ${state.me.bot.name}`, h('span', { class: 'badge' }, withBot.filter(match).length)),
      withBot.filter(match).length ? h('div', { class: 'server-grid' }, withBot.filter(match).map(serverCard)) : h('p', { class: 'muted' }, 'Keine Server.'),
      without.length > 0 && h('div', { class: 'section-title' }, 'Bot hinzufügen', h('span', { class: 'badge' }, without.filter(match).length)),
      without.length > 0 && h('div', { class: 'server-grid' }, without.filter(match).map(serverCard)),
    );
  };
  draw();
  document.getElementById('app').replaceChildren(
    h(
      'div',
      { class: 'servers' },
      h(
        'div',
        { class: 'servers-head' },
        h('div', {}, h('h1', {}, 'Deine Server'), h('p', { class: 'lead' }, 'Wähle einen Server, um ihn zu konfigurieren.')),
        userBox(),
      ),
      h('div', { class: 'pills', style: 'margin-bottom:16px' }, h('span', { class: 'badge' }, `${state.me.guilds.length} mit Verwaltungsrechten`), h('span', { class: 'badge green' }, `${withBot.length} mit Bot`)),
      search,
      h('div', { style: 'height:24px' }),
      list,
    ),
  );
  document.title = `${state.me.bot.brand} Dashboard`;
}

// ---------- Admin-Bereich (nur Bot-Admins) ----------

// Fester Knopf unten links, nur für Bot-Admins (BOT_ADMINS in der .env des Bots).
function adminButton() {
  document.querySelector('.admin-fab')?.remove();
  if (!state.me?.user?.isBotAdmin) return;
  const active = location.hash.startsWith('#/admin');
  document.body.append(h('a', { class: `admin-fab${active ? ' active' : ''}`, href: '#/admin', title: 'Admin-Bereich: alle Server des Bots' }, h('span', {}, '🛡️'), 'Admin'));
}

const duration = (seconds) => {
  const d = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return d ? `${d} T ${hours} Std` : hours ? `${hours} Std ${minutes} Min` : `${minutes} Min`;
};

// Gemeinsamer Rahmen der Admin-Seiten mit Reitern.
function adminFrame(tab, ...content) {
  const tabs = [
    ['', '🖥️ Server'],
    ['system', '📊 System'],
    ['fehler', '⚠️ Fehler'],
    ['audit', '📝 Audit-Log'],
    ['gesperrt', '⛔ Gesperrt'],
    ['backup', '💾 Backup'],
    ['sitzungen', '🟢 Angemeldet'],
    ['verlauf', '🕒 Anmeldeverlauf'],
  ];
  document.getElementById('app').replaceChildren(
    h(
      'div',
      { class: 'servers' },
      h(
        'div',
        { class: 'servers-head' },
        h('div', {}, h('h1', {}, '🛡️ Admin-Bereich'), h('p', { class: 'lead' }, 'Als Bot-Admin hast du auf jedem Server des Bots vollen Zugriff – auch ohne dort Mitglied zu sein.')),
        userBox(),
      ),
      h('div', { class: 'chips admin-tabs' }, tabs.map(([id, label]) => h('a', { class: `chip${id === tab ? ' active' : ''}`, href: `#/admin${id ? `/${id}` : ''}` }, label))),
      content,
      h('div', { class: 'admin-bottom-space' }), // Platz für den Admin-Knopf unten links
    ),
  );
  document.title = `Admin · ${state.me.bot.brand} Dashboard`;
}

const dateTime = (ms) => (ms ? new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
function ago(ms) {
  if (!ms) return '—';
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `vor ${hours} Std`;
  return `vor ${Math.round(hours / 24)} Tagen`;
}
const avatarUrl = (u) => (u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : 'https://cdn.discordapp.com/embed/avatars/0.png');

// Discord-Konto: Avatar, Anzeigename, @Name und ID (Klick kopiert die ID).
const discordCell = (u) =>
  h(
    'div',
    { class: 'person' },
    h('img', { class: 'avatar', src: avatarUrl(u), alt: '' }),
    h(
      'div',
      {},
      h('b', {}, u.globalName || u.username),
      h('div', { class: 'muted small' }, `@${u.username} · `, h('code', { title: 'Klicken zum Kopieren', onclick: () => navigator.clipboard?.writeText(u.id).then(() => toast('ID kopiert')) }, u.id)),
    ),
  );
const robloxCell = (r) =>
  r
    ? h(
        'div',
        {},
        h('a', { href: `https://www.roblox.com/users/${r.id}/profile`, target: '_blank', rel: 'noopener' }, r.name),
        h('div', { class: 'muted small' }, r.source === 'discord' ? 'im Discord-Profil verknüpft' : 'aus einer Bewerbung', ' · ', h('code', {}, r.id)),
      )
    : h('span', { class: 'muted small' }, 'nicht verknüpft');

async function renderAdminSessions() {
  adminFrame('sitzungen', h('p', { class: 'muted' }, 'Lädt …'));
  let data;
  try {
    data = await api('/api/admin/sessions');
  } catch (err) {
    return adminFrame('sitzungen', h('p', {}, err.message));
  }
  const online = data.sessions.filter((x) => x.online).length;
  const end = async (session) => {
    if (!confirm(`Sitzung von ${session.user.globalName || session.user.username} beenden? Die Person muss sich neu anmelden.`)) return;
    try {
      await api(`/api/admin/sessions/${session.id}`, { method: 'DELETE' });
      toast('✅ Sitzung beendet');
      renderAdminSessions();
    } catch (err) {
      toast(err.message, true);
    }
  };
  adminFrame(
    'sitzungen',
    h(
      'div',
      { class: 'stats-grid' },
      h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Angemeldet'), h('div', { class: 'value' }, data.sessions.length)),
      h('div', { class: 'stat' }, h('div', { class: 'label' }, `Online (letzte ${data.onlineMinutes} Min)`), h('div', { class: 'value' }, online)),
    ),
    data.sessions.length
      ? h(
          'div',
          { class: 'card table-card' },
          h(
            'table',
            {},
            h('tr', {}, h('th', {}, 'Discord'), h('th', {}, 'Roblox'), h('th', {}, 'Angemeldet seit'), h('th', {}, 'Zuletzt aktiv'), h('th', {})),
            data.sessions.map((x) =>
              h(
                'tr',
                {},
                h('td', {}, discordCell(x.user)),
                h('td', {}, robloxCell(x.roblox)),
                h('td', {}, dateTime(x.loginAt)),
                h('td', {}, h('span', { class: `badge ${x.online ? 'green' : ''}` }, x.online ? '● online' : ago(x.lastSeen))),
                h('td', {}, x.current ? h('span', { class: 'muted small' }, 'du') : h('button', { class: 'btn ghost small', onclick: () => end(x) }, 'Beenden')),
              ),
            ),
          ),
        )
      : h('div', { class: 'empty' }, 'Gerade ist niemand angemeldet.'),
  );
}

async function renderAdminHistory() {
  adminFrame('verlauf', h('p', { class: 'muted' }, 'Lädt …'));
  let data;
  try {
    data = await api('/api/admin/logins?limit=500');
  } catch (err) {
    return adminFrame('verlauf', h('p', {}, err.message));
  }
  const LABEL = { login: ['Anmeldung', 'green'], logout: ['Abmeldung', ''], ended: ['Beendet', 'red'] };
  const search = h('input', { type: 'text', placeholder: 'Name, Discord-ID oder Roblox-Name suchen …', oninput: () => draw() });
  const list = h('div');
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = data.events.filter((e) => !q || [e.user.username, e.user.globalName, e.user.id, e.roblox?.name].some((v) => String(v ?? '').toLowerCase().includes(q)));
    setChildren(
      list,
      shown.length
        ? h(
            'div',
            { class: 'card table-card' },
            h(
              'table',
              {},
              h('tr', {}, h('th', {}, 'Zeit'), h('th', {}, 'Was'), h('th', {}, 'Discord'), h('th', {}, 'Roblox')),
              shown.map((e) => {
                const [label, color] = LABEL[e.type] ?? [e.type, ''];
                return h(
                  'tr',
                  {},
                  h('td', {}, h('b', {}, dateTime(e.at)), h('div', { class: 'muted small' }, ago(e.at))),
                  h('td', {}, h('span', { class: `badge ${color}` }, label), e.by && h('div', { class: 'muted small' }, `von ${e.by.username}`)),
                  h('td', {}, discordCell(e.user)),
                  h('td', {}, robloxCell(e.roblox)),
                );
              }),
            ),
          )
        : h('div', { class: 'empty' }, q ? 'Nichts gefunden.' : 'Noch keine Anmeldungen aufgezeichnet.'),
    );
  };
  draw();
  adminFrame('verlauf', search, h('div', { class: 'spacer-24' }), list, h('p', { class: 'muted small' }, 'Gespeichert werden die letzten 1000 An- und Abmeldungen.'));
}

// ---------- System ----------

const bytes = (n) => {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0).replace('.', ',')} ${units[i]}`;
};
const adminStat = (label, value, hint) => h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), hint && h('div', { class: 'muted small' }, hint));

async function loadAdmin(tab, url) {
  adminFrame(tab, h('p', { class: 'muted' }, 'Lädt …'));
  try {
    return await api(url);
  } catch (err) {
    adminFrame(tab, h('p', {}, err.message));
    return null;
  }
}

async function renderAdminSystem() {
  const s = await loadAdmin('system', '/api/admin/status');
  if (!s) return;
  const usedHost = s.host.memory.total - s.host.memory.free;
  const row = (label, value) => h('tr', {}, h('th', {}, label), h('td', {}, value));
  adminFrame(
    'system',
    h(
      'div',
      { class: 'stats-grid' },
      adminStat('Laufzeit', duration(s.process.uptime), `seit ${dateTime(s.process.startedAt)}`),
      adminStat('Bot-Ping', s.bot.ping === null ? '—' : `${s.bot.ping} ms`),
      adminStat('Arbeitsspeicher', bytes(s.process.memory.rss), `Heap ${bytes(s.process.memory.heapUsed)} von ${bytes(s.process.memory.heapTotal)}`),
      adminStat('Datenbank', bytes(s.db.bytes), `${s.db.sections} Bereiche in db.json`),
      adminStat('Server', s.bot.guilds.toLocaleString('de-DE')),
      adminStat('Fehler', s.errors.total, s.errors.lastAt ? `zuletzt ${ago(s.errors.lastAt)}` : 'keine aufgezeichnet'),
    ),
    h(
      'div',
      { class: 'card table-card' },
      h(
        'table',
        {},
        row('Bot', h('span', {}, s.bot.name ?? '—', ' · ', h('code', {}, s.bot.id ?? '—'))),
        row('Version (Git-Commit)', s.version.commit ? h('code', {}, s.version.commit) : h('span', { class: 'muted' }, 'unbekannt')),
        row('Node.js / discord.js', `${s.process.node} / ${s.version.discordJs}`),
        row('System', `${s.host.platform} · ${s.host.cpus} CPU-Kerne`),
        row('CPU-Last (1 / 5 / 15 Min)', s.host.load.join(' / ')),
        row('Speicher des Hosts', `${bytes(usedHost)} von ${bytes(s.host.memory.total)} belegt`),
        row('Prozess-ID', String(s.process.pid)),
      ),
    ),
    h('div', { class: 'spacer-24' }),
    h('button', { class: 'btn ghost', onclick: () => renderAdminSystem() }, '↻ Aktualisieren'),
  );
}

// ---------- Fehler-Log ----------

async function renderAdminErrors() {
  const data = await loadAdmin('fehler', '/api/admin/errors?limit=300');
  if (!data) return;
  const clear = async () => {
    if (!confirm('Alle aufgezeichneten Fehler löschen?')) return;
    try {
      await api('/api/admin/errors', { method: 'DELETE' });
      toast('✅ Fehler-Log geleert');
      renderAdminErrors();
    } catch (err) {
      toast(err.message, true);
    }
  };
  const search = h('input', { type: 'text', placeholder: 'Fehler durchsuchen …', oninput: () => draw() });
  const list = h('div');
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = data.errors.filter((e) => !q || e.text.toLowerCase().includes(q));
    setChildren(
      list,
      shown.length
        ? shown.map((e) =>
            h(
              'details',
              { class: 'card error-entry' },
              h(
                'summary',
                {},
                h('b', {}, dateTime(e.at)),
                ' ',
                h('span', { class: 'muted small' }, ago(e.at)),
                e.label && h('span', { class: 'badge red' }, e.label),
                e.count > 1 && h('span', { class: 'badge yellow' }, `${e.count}×`),
                h('div', { class: 'error-first' }, e.text.split('\n')[0]),
              ),
              h('pre', { class: 'error-text' }, e.text),
            ),
          )
        : h('div', { class: 'empty' }, q ? 'Nichts gefunden.' : '🎉 Keine Fehler aufgezeichnet.'),
    );
  };
  draw();
  adminFrame(
    'fehler',
    h('div', { class: 'admin-toolbar' }, search, h('button', { class: 'btn ghost', onclick: () => renderAdminErrors() }, '↻'), data.errors.length ? h('button', { class: 'btn danger', onclick: clear }, 'Leeren') : null),
    h('div', { class: 'spacer-24' }),
    list,
    h('p', { class: 'muted small' }, 'Alles, was der Bot als Fehler in die Konsole schreibt. Gespeichert werden die letzten 300, gleiche Fehler direkt hintereinander werden zusammengefasst.'),
  );
}

// ---------- Audit-Log ----------

const AUDIT_LABEL = {
  'settings.change': ['Einstellungen', ''],
  'settings.reset': ['Zurückgesetzt', 'red'],
  action: ['Aktion', ''],
  'guild.leave': ['Server verlassen', 'red'],
  'guild.block': ['Server gesperrt', 'red'],
  'guild.unblock': ['Entsperrt', 'green'],
  'session.end': ['Sitzung beendet', 'yellow'],
  'errors.clear': ['Fehler-Log geleert', ''],
  'backup.download': ['Backup geladen', ''],
  'backup.restore': ['Backup eingespielt', 'red'],
};

function auditDetails(e) {
  if (e.type === 'settings.change')
    return h(
      'div',
      { class: 'audit-changes' },
      e.changes.map((c) => h('div', {}, h('code', {}, c.path), ': ', h('span', { class: 'muted' }, c.before ?? '—'), ' → ', h('b', {}, c.after ?? '—'))),
    );
  const d = e.details ?? {};
  if (e.type === 'action') return h('div', {}, h('code', {}, d.name), d.body && d.body !== '{}' ? h('div', { class: 'muted small' }, d.body) : null);
  if (e.type === 'settings.reset') return h('span', { class: 'muted small' }, `${d.changed ?? 0} Einstellungen verworfen`);
  if (e.type === 'session.end') return h('span', { class: 'muted small' }, `von ${d.user?.username ?? '?'}`);
  if (e.type === 'backup.restore') return h('span', { class: 'muted small' }, `${d.sections} Bereiche · vorher gesichert als ${d.safety}`);
  if (d.reason) return h('span', { class: 'muted small' }, `Grund: ${d.reason}`);
  return null;
}

async function renderAdminAudit() {
  const data = await loadAdmin('audit', '/api/admin/audit?limit=1000');
  if (!data) return;
  const search = h('input', { type: 'text', placeholder: 'Person, Server, ID oder Einstellung suchen …', oninput: () => draw() });
  const onlyAdmins = h('input', { type: 'checkbox', onchange: () => draw() });
  const list = h('div');
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = data.events.filter(
      (e) =>
        (!onlyAdmins.checked || e.actor.botAdmin) &&
        (!q || [e.actor.username, e.actor.id, e.guild?.name, e.guild?.id, e.type, ...e.changes.map((c) => c.path), e.details?.name].some((v) => String(v ?? '').toLowerCase().includes(q))),
    );
    setChildren(
      list,
      shown.length
        ? h(
            'div',
            { class: 'card table-card' },
            h(
              'table',
              {},
              h('tr', {}, h('th', {}, 'Zeit'), h('th', {}, 'Wer'), h('th', {}, 'Server'), h('th', {}, 'Was')),
              shown.map((e) => {
                const [label, color] = AUDIT_LABEL[e.type] ?? [e.type, ''];
                return h(
                  'tr',
                  {},
                  h('td', {}, h('b', {}, dateTime(e.at)), h('div', { class: 'muted small' }, ago(e.at))),
                  h(
                    'td',
                    {},
                    h('b', {}, e.actor.username),
                    h('div', {}, e.actor.botAdmin && h('span', { class: 'badge yellow' }, 'Bot-Admin'), e.actor.member === false && h('span', { class: 'badge red', title: 'War auf diesem Server kein Mitglied' }, 'fremder Server')),
                  ),
                  h('td', {}, e.guild ? h('div', {}, e.guild.name ?? '—', h('div', { class: 'muted small' }, h('code', {}, e.guild.id))) : h('span', { class: 'muted small' }, 'Bot')),
                  h('td', {}, h('span', { class: `badge ${color}` }, label), auditDetails(e)),
                );
              }),
            ),
          )
        : h('div', { class: 'empty' }, q || onlyAdmins.checked ? 'Nichts gefunden.' : 'Noch keine Änderungen aufgezeichnet.'),
    );
  };
  draw();
  adminFrame(
    'audit',
    h('div', { class: 'admin-toolbar' }, search, h('label', { class: 'check' }, onlyAdmins, ' nur Bot-Admins')),
    h('div', { class: 'spacer-24' }),
    list,
    h('p', { class: 'muted small' }, 'Alle Änderungen im Dashboard (Einstellungen mit vorher und nachher, Aktionen) und alle Admin-Aktionen. Gespeichert werden die letzten 1000.'),
  );
}

// ---------- Gesperrte Server ----------

async function renderAdminBlocked() {
  const data = await loadAdmin('gesperrt', '/api/admin/blocked');
  if (!data) return;
  const id = h('input', { type: 'text', placeholder: 'Server-ID', inputmode: 'numeric' });
  const reason = h('input', { type: 'text', placeholder: 'Grund (optional)' });
  const add = async () => {
    try {
      const r = await api('/api/admin/blocked', { method: 'POST', body: { id: id.value.trim(), reason: reason.value } });
      toast(r.left ? '✅ Gesperrt – der Bot hat den Server verlassen' : '✅ Gesperrt');
      renderAdminBlocked();
    } catch (err) {
      toast(err.message, true);
    }
  };
  const remove = async (b) => {
    if (!confirm(`„${b.name ?? b.id}“ entsperren? Der Bot kann danach wieder eingeladen werden.`)) return;
    try {
      await api(`/api/admin/blocked/${b.id}`, { method: 'DELETE' });
      toast('✅ Entsperrt');
      renderAdminBlocked();
    } catch (err) {
      toast(err.message, true);
    }
  };
  adminFrame(
    'gesperrt',
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Server sperren')),
      h(
        'div',
        { class: 'card-body' },
        h('p', { class: 'muted small' }, 'Wird der Bot auf einen gesperrten Server eingeladen, verlässt er ihn sofort wieder. Ist er gerade drauf, verlässt er ihn jetzt.'),
        h('div', { class: 'admin-toolbar' }, id, reason, h('button', { class: 'btn danger', onclick: add }, 'Sperren')),
      ),
    ),
    h('div', { class: 'spacer-24' }),
    data.blocked.length
      ? h(
          'div',
          { class: 'card table-card' },
          h(
            'table',
            {},
            h('tr', {}, h('th', {}, 'Server'), h('th', {}, 'Grund'), h('th', {}, 'Gesperrt'), h('th', {})),
            data.blocked.map((b) =>
              h(
                'tr',
                {},
                h('td', {}, h('b', {}, b.name ?? 'unbekannt'), h('div', { class: 'muted small' }, h('code', {}, b.id))),
                h('td', {}, b.reason || h('span', { class: 'muted' }, '—')),
                h('td', {}, dateTime(b.at), h('div', { class: 'muted small' }, `von ${b.by?.username ?? '?'}`)),
                h('td', {}, h('button', { class: 'btn ghost small', onclick: () => remove(b) }, 'Entsperren')),
              ),
            ),
          ),
        )
      : h('div', { class: 'empty' }, 'Kein Server gesperrt.'),
  );
}

// ---------- Backup ----------

function renderAdminBackup() {
  const file = h('input', { type: 'file', accept: '.json,application/json' });
  const restore = async () => {
    const f = file.files[0];
    if (!f) return toast('Bitte zuerst eine Backup-Datei auswählen.', true);
    let backup;
    try {
      backup = JSON.parse(await f.text());
    } catch {
      return toast('Die Datei ist kein gültiges JSON.', true);
    }
    if (!confirm(`Backup „${f.name}“ einspielen? ALLE aktuellen Daten (Einstellungen, Tickets, Bewerbungen, Level …) werden ersetzt. Der aktuelle Stand wird vorher als Datei gesichert.`)) return;
    try {
      const r = await api('/api/admin/backup', { method: 'POST', body: { backup } });
      toast(`✅ Eingespielt (${r.sections} Bereiche). Starte den Bot jetzt neu.`);
      file.value = '';
    } catch (err) {
      toast(err.message, true);
    }
  };
  adminFrame(
    'backup',
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, '⬇️ Backup herunterladen')),
      h(
        'div',
        { class: 'card-body' },
        h('p', { class: 'muted small' }, 'Die komplette Datenbank (data/db.json) aller Server als Datei. Angemeldete Dashboard-Sitzungen sind nicht enthalten. Die Datei enthält persönliche Daten – sicher aufbewahren.'),
        h('div', {}, h('a', { class: 'btn primary', href: '/api/admin/backup', download: '' }, 'Backup herunterladen')),
      ),
    ),
    h('div', { class: 'spacer-24' }),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, '⬆️ Backup einspielen')),
      h(
        'div',
        { class: 'card-body' },
        h('p', { class: 'muted small' }, 'Ersetzt alle Daten durch das Backup. Der aktuelle Stand wird vorher im Datenordner als db.json.vor-wiederherstellung-… gesichert. Starte den Bot danach neu, damit Panels und Erinnerungen den neuen Stand übernehmen.'),
        h('div', { class: 'admin-toolbar' }, file, h('button', { class: 'btn danger', onclick: restore }, 'Einspielen')),
      ),
    ),
  );
}

async function leaveGuild(g) {
  const name = g.name;
  if (!confirm(`Bot von „${name}“ entfernen?`)) return;
  const blockIt = confirm(`„${name}“ zusätzlich sperren?\n\nOK = sperren (der Bot verlässt den Server auch nach jeder neuen Einladung sofort)\nAbbrechen = nur verlassen`);
  const reason = blockIt ? (prompt('Grund für die Sperre (optional):') ?? '') : '';
  try {
    await api(`/api/admin/guilds/${g.id}/leave`, { method: 'POST', body: { block: blockIt, reason } });
    toast(blockIt ? `✅ „${name}“ verlassen und gesperrt` : `✅ „${name}“ verlassen`);
    renderAdmin('');
  } catch (err) {
    toast(err.message, true);
  }
}

async function renderAdmin(tab) {
  if (tab === 'sitzungen') return renderAdminSessions();
  if (tab === 'verlauf') return renderAdminHistory();
  if (tab === 'system') return renderAdminSystem();
  if (tab === 'fehler') return renderAdminErrors();
  if (tab === 'audit') return renderAdminAudit();
  if (tab === 'gesperrt') return renderAdminBlocked();
  if (tab === 'backup') return renderAdminBackup();
  const app = document.getElementById('app');
  let data;
  try {
    data = await api('/api/admin/guilds');
  } catch (err) {
    app.replaceChildren(h('div', { class: 'center' }, h('div', {}, h('p', {}, err.message), h('a', { href: '#/' }, '← Zurück zur Server-Auswahl'))));
    return;
  }
  const search = h('input', { type: 'text', placeholder: 'Server, ID oder Besitzer-ID suchen …', oninput: () => draw() });
  const list = h('div');
  const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
  const serverCard = (g) =>
    h(
      'div',
      { class: 'server' },
      guildIconNode(g),
      h('h3', {}, g.name),
      h('div', { class: 'muted small' }, `${g.memberCount.toLocaleString('de-DE')} Mitglieder · seit ${new Date(g.joinedAt).toLocaleDateString('de-DE')}`),
      h(
        'div',
        { class: 'pills' },
        h('span', { class: `badge ${g.member ? 'green' : 'yellow'}`, title: g.member ? 'Du hast hier selbst „Server verwalten“' : 'Zugriff nur über Bot-Admin' }, g.member ? 'Eigene Rechte' : 'Nur Admin-Zugriff'),
        g.changed ? h('span', { class: 'badge' }, `${g.changed} Einstellungen`) : null,
      ),
      h('div', { class: 'muted small' }, h('code', {}, g.id)),
      h('a', { class: 'btn primary', href: `#/g/${g.id}` }, 'Verwalten ›'),
      h('button', { class: 'btn ghost small', onclick: () => leaveGuild(g) }, 'Server verlassen …'),
    );
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = data.guilds.filter((g) => !q || g.name.toLowerCase().includes(q) || g.id.includes(q) || g.ownerId === q);
    setChildren(
      list,
      h('div', { class: 'section-title' }, 'Alle Server des Bots', h('span', { class: 'badge' }, shown.length)),
      shown.length ? h('div', { class: 'server-grid' }, shown.map(serverCard)) : h('p', { class: 'muted' }, 'Keine Server gefunden.'),
    );
  };
  draw();
  adminFrame(
    '',
    h(
      'div',
      { class: 'stats-grid' },
      stat('Server', data.totals.guilds.toLocaleString('de-DE')),
      stat('Mitglieder gesamt', data.totals.members.toLocaleString('de-DE')),
      stat('Bot-Ping', `${data.bot.ping} ms`),
      stat('Laufzeit', duration(data.bot.uptime)),
    ),
    search,
    h('div', { class: 'spacer-24' }),
    list,
  );
}

// ---------- Routing ----------

let lastGuildId = null;
async function render() {
  const [, kind, guildId, pageId] = location.hash.split('/');
  adminButton();
  if (kind === 'admin') {
    if (state.changes.size && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
    state.changes.clear();
    lastGuildId = null;
    updateSavebar();
    return renderAdmin(guildId);
  }
  if (kind !== 'g') {
    if (state.changes.size && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
    state.changes.clear();
    lastGuildId = null;
    updateSavebar();
    return renderServers();
  }
  if (guildId !== lastGuildId) {
    if (state.changes.size && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
    state.changes.clear();
    try {
      state.guild = await api(`/api/guilds/${guildId}`);
    } catch (err) {
      document.getElementById('app').replaceChildren(h('div', { class: 'center' }, h('div', {}, h('p', {}, err.message), h('a', { href: '#/' }, '← Zurück zur Server-Auswahl'))));
      return;
    }
    state.draft = structuredClone(state.guild.config);
    lastGuildId = guildId;
  }
  const scroll = window.scrollY;
  renderGuild(pageId);
  window.scrollTo(0, scroll);
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});
window.addEventListener('load', async () => {
  try {
    state.me = await api('/api/me');
  } catch {
    return;
  }
  render();
});

window.Dash = { h, setChildren, ui, api, live, toast, page, card, renderField, bindPath, bindItem, markDirty, getPath, render, runAction, state };
