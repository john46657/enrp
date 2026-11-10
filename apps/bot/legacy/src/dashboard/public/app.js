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

// ---------- Routing ----------

let lastGuildId = null;
async function render() {
  const [, kind, guildId, pageId] = location.hash.split('/');
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
