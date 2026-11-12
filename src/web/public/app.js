// Web-Dashboard für Bewerbungen und Panels. Ohne Framework; alle Texte werden per textContent gesetzt (kein HTML aus Daten).
'use strict';

const QUESTION_TYPES = { TEXT: 'Freitext', CHOICE: 'Auswahl', ROLE: 'Rollen-Auswahl', ROBLOX: 'Roblox-Benutzer' };
const MESSAGE_FIELDS = { start: 'Startnachricht (DM)', finish: 'Nach dem Einreichen', accept: 'Bei Annahme', reject: 'Bei Ablehnung' };
const app = document.getElementById('app');
let me = null;
let data = null; // Übersicht des aktuellen Servers

// ---------- Hilfen ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : String(child));
  return el;
}

function toast(text, error = false) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.className = `show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.className = ''), error ? 6000 : 2500);
}

async function api(path, method = 'GET', body) {
  const res = await fetch(`/api/${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? { 'X-Dashboard': '1' } : { 'Content-Type': 'application/json', 'X-Dashboard': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) {
    me = null;
    renderLogin();
    throw new Error(json.error || 'Bitte melde dich an.');
  }
  if (!res.ok) throw new Error(json.error || `Fehler ${res.status}`);
  return json;
}

const go = (hash) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};

const avatar = (url, name) => (url ? h('img', { src: url, alt: '' }) : h('div', { class: 'placeholder' }, (name || '?').slice(0, 1)));
const plusButton = (label, onclick, attrs = {}) => h('button', { class: 'btn primary', onclick, ...attrs }, h('span', { class: 'plus' }, '+'), label);

function emptyState(title, text, buttonLabel, onclick) {
  const svg = new DOMParser().parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>',
    'image/svg+xml',
  ).documentElement;
  return h(
    'div',
    { class: 'empty' },
    document.importNode(svg, true),
    h('div', {}, h('h2', {}, title), h('p', {}, text), buttonLabel ? h('button', { class: 'btn', onclick }, '↗ ', buttonLabel) : null),
  );
}

// ---------- Rahmen ----------

function renderLogin() {
  app.replaceChildren(
    h(
      'div',
      { class: 'center' },
      h('h1', {}, 'Bewerbungs-Dashboard'),
      h('p', { class: 'hint' }, 'Melde dich mit Discord an. Du siehst alle Server, auf denen der Bot ist und du „Server verwalten“ hast.'),
      h('a', { class: 'btn primary', href: '/login' }, 'Mit Discord anmelden'),
    ),
  );
}

function renderGuilds() {
  app.replaceChildren(
    h(
      'div',
      { class: 'center' },
      h('h1', {}, 'Server wählen'),
      me.guilds.length
        ? h('div', { class: 'guilds' }, me.guilds.map((g) => h('a', { href: `#/g/${g.id}/apps` }, avatar(g.icon, g.name), g.name)))
        : h('p', { class: 'hint' }, 'Auf keinem Server mit dem Bot hast du „Server verwalten“.'),
      h('p', {}, h('a', { class: 'back', href: '/logout' }, 'Abmelden')),
    ),
  );
}

function layout(section, content) {
  const g = data.guild;
  return h(
    'div',
    { class: 'layout' },
    h(
      'nav',
      { class: 'sidebar' },
      h('div', { class: 'guild' }, avatar(g.icon, g.name), h('span', {}, g.name)),
      h('a', { class: `nav${section === 'apps' ? ' active' : ''}`, href: `#/g/${g.id}/apps` }, '📋 Bewerbungen'),
      h('a', { class: `nav${section === 'panels' ? ' active' : ''}`, href: `#/g/${g.id}/panels` }, '🗂️ Panels'),
      h('div', { class: 'spacer' }),
      me.guilds.length > 1 ? h('a', { class: 'nav', href: '#/' }, '⇄ Server wechseln') : null,
      h('div', { class: 'user' }, me.user.avatar ? h('img', { src: me.user.avatar, alt: '' }) : null, h('span', {}, me.user.name)),
      h('a', { class: 'nav', href: '/logout' }, '↩ Abmelden'),
    ),
    h('main', {}, content),
  );
}

// ---------- Bewerbungen ----------

function renderApps(query = '') {
  const gid = data.guild.id;
  const list = data.types.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()));
  const grid = h('div', { class: 'grid' });
  const fill = (items) =>
    grid.replaceChildren(
      ...items.map((t) =>
        h(
          'div',
          { class: 'card', onclick: () => go(`#/g/${gid}/apps/${t.id}`) },
          h('div', { class: 'title' }, h('span', { class: 'emoji' }, t.emoji), t.name),
          h(
            'div',
            {},
            !t.questions.length ? h('span', { class: 'badge warn' }, 'keine Fragen') : h('span', { class: `badge ${t.enabled ? 'on' : 'off'}` }, t.enabled ? 'offen' : 'geschlossen'),
            ' ',
            h('span', { class: 'badge' }, t.workflow === 'police' ? 'mehrstufig' : 'einfach'),
          ),
          h('div', { class: 'meta' }, `${t.questions.length} Fragen · Nummer ${t.numberPrefix}-0001${t.openCount ? ` · ${t.openCount} offen` : ''}`),
          t.description ? h('div', { class: 'meta' }, t.description) : null,
        ),
      ),
    );
  fill(list);
  const search = h('input', {
    type: 'search',
    placeholder: 'Bewerbungen suchen …',
    value: query,
    oninput: (e) => fill(data.types.filter((t) => t.name.toLowerCase().includes(e.target.value.toLowerCase()))),
  });
  const content = [
    h(
      'div',
      { class: 'head' },
      h('h1', {}, 'Bewerbungen: ', h('span', { class: 'count' }, data.types.length)),
      h('div', { class: 'search' }, search),
      h('div', { class: 'actions' }, plusButton('Neue Bewerbung', newAppDialog)),
    ),
    data.types.length ? grid : emptyState('Noch keine Bewerbungen', 'Lege deine erste Bewerbung an und füge danach die Fragen hinzu.', 'Bewerbung erstellen', newAppDialog),
  ];
  app.replaceChildren(layout('apps', content));
}

function newAppDialog() {
  const name = h('input', { required: true, maxLength: 80, placeholder: 'z. B. Polizei-Bewerbung' });
  const emoji = h('input', { maxLength: 64, placeholder: '📝' });
  const dialog = h(
    'dialog',
    {},
    h(
      'form',
      {
        method: 'dialog',
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            const result = await api(`g/${data.guild.id}/types`, 'POST', { name: name.value, emoji: emoji.value });
            data = result;
            dialog.close();
            toast('Bewerbung angelegt – füge jetzt Fragen hinzu.');
            go(`#/g/${data.guild.id}/apps/${result.id}`);
          } catch (err) {
            toast(err.message, true);
          }
        },
      },
      h('h2', {}, 'Neue Bewerbung'),
      h('div', { class: 'row' }, h('label', { class: 'field' }, 'Name', name), h('label', { class: 'field' }, 'Emoji', emoji)),
      h('div', { class: 'toolbar' }, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Abbrechen'), h('button', { class: 'btn primary' }, 'Erstellen')),
    ),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  name.focus();
}

function questionEditor(draft) {
  const box = h('div');
  const render = () => {
    box.replaceChildren(
      ...draft.questions.map((q, i) => {
        const set = (key, value, rerender = false) => {
          q[key] = value;
          if (rerender) render();
        };
        const top = h(
          'div',
          { class: 'top' },
          h('span', { class: 'num' }, `${i + 1}.`),
          h(
            'select',
            {
              onchange: (e) => {
                set('type', e.target.value);
                if ((q.type === 'CHOICE' || q.type === 'ROLE') && !Array.isArray(q.options)) q.options = [];
                if (q.type === 'ROLE') q.options = q.options.filter((o) => o.roleId);
                render();
              },
            },
            Object.entries(QUESTION_TYPES).map(([value, label]) => h('option', { value, selected: q.type === value }, label)),
          ),
          h('input', { value: q.label ?? '', maxLength: 250, placeholder: 'Frage, z. B. Warum möchtest du zu uns?', oninput: (e) => set('label', e.target.value) }),
          h(
            'div',
            { class: 'tools' },
            h('button', { type: 'button', class: 'icon-btn', title: 'Nach oben', disabled: i === 0, onclick: () => (draft.questions.splice(i - 1, 0, ...draft.questions.splice(i, 1)), render()) }, '↑'),
            h('button', { type: 'button', class: 'icon-btn', title: 'Nach unten', disabled: i === draft.questions.length - 1, onclick: () => (draft.questions.splice(i + 1, 0, ...draft.questions.splice(i, 1)), render()) }, '↓'),
            h('button', { type: 'button', class: 'icon-btn', title: 'Entfernen', onclick: () => (draft.questions.splice(i, 1), render()) }, '🗑'),
          ),
        );
        const sub = h(
          'div',
          { class: 'sub' },
          h('input', { value: q.description ?? '', maxLength: 500, placeholder: 'Hinweis unter der Frage (optional)', oninput: (e) => set('description', e.target.value) }),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: q.required !== false, onchange: (e) => set('required', e.target.checked) }), 'Pflichtfrage'),
        );
        if (q.type === 'TEXT') {
          sub.append(
            h('label', { class: 'field' }, 'Mindestens Zeichen', h('input', { type: 'number', min: 0, max: 5000, value: q.min ?? 0, oninput: (e) => set('min', Number(e.target.value)) })),
            h('label', { class: 'field' }, 'Höchstens Zeichen', h('input', { type: 'number', min: 1, max: 5000, value: q.max ?? 1000, oninput: (e) => set('max', Number(e.target.value)) })),
          );
        }
        const extra = [];
        if (q.type === 'CHOICE') {
          extra.push(
            h('textarea', {
              placeholder: 'Antworten, eine pro Zeile (max. 25)\nTäglich\nMehrmals pro Woche\nSelten',
              value: (q.options ?? []).map((o) => o.label).join('\n'),
              oninput: (e) => set('options', e.target.value.split('\n').map((label) => ({ label: label.trim() })).filter((o) => o.label)),
            }),
          );
        }
        if (q.type === 'ROLE') {
          const chosen = new Set((q.options ?? []).map((o) => o.roleId));
          extra.push(
            h('p', { class: 'hint' }, 'Rollen, aus denen gewählt werden kann. Die gewählten Rollen gibt es bei Annahme.'),
            h(
              'div',
              { class: 'roles' },
              data.roles.map((r) =>
                h(
                  'label',
                  { class: 'check' },
                  h('input', {
                    type: 'checkbox',
                    checked: chosen.has(r.id),
                    onchange: (e) => {
                      if (e.target.checked) chosen.add(r.id);
                      else chosen.delete(r.id);
                      q.options = data.roles.filter((x) => chosen.has(x.id)).map((x) => ({ label: x.name.slice(0, 100), roleId: x.id }));
                    },
                  }),
                  h('span', {}, r.name),
                ),
              ),
            ),
          );
        }
        if (q.type === 'CHOICE' || q.type === 'ROLE') {
          extra.push(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: Boolean(q.multiple), onchange: (e) => set('multiple', e.target.checked) }), 'Mehrere Antworten erlaubt'));
        }
        return h('div', { class: 'q' }, top, sub, extra);
      }),
      h(
        'div',
        { class: 'toolbar' },
        plusButton('Frage hinzufügen', () => {
          draft.questions.push({ type: 'TEXT', label: '', required: true, min: 0, max: 1000 });
          render();
          const inputs = box.querySelectorAll('.q .top input');
          inputs[inputs.length - 1]?.focus();
        }, { type: 'button', disabled: draft.questions.length >= 50 }),
        h('span', { class: 'hint' }, `${draft.questions.length}/50 Fragen`),
      ),
    );
  };
  render();
  return box;
}

function renderAppEditor(typeId) {
  const gid = data.guild.id;
  const type = data.types.find((t) => t.id === typeId);
  if (!type) return go(`#/g/${gid}/apps`);
  const draft = structuredClone(type);
  const field = (label, el, hint) => h('label', { class: 'field' }, label, el, hint ? h('span', { class: 'hint' }, hint) : null);
  const bind = (key, attrs = {}) => h('input', { value: draft[key] ?? '', oninput: (e) => (draft[key] = e.target.value), ...attrs });

  const save = async (button) => {
    button.disabled = true;
    try {
      const questions = draft.questions.map((q) => ({ ...q, label: (q.label ?? '').trim() }));
      data = await api(`g/${gid}/types/${typeId}`, 'PATCH', {
        name: draft.name,
        emoji: draft.emoji,
        description: draft.description,
        numberPrefix: draft.numberPrefix,
        workflow: draft.workflow,
        enabled: draft.enabled,
        questions,
        messages: draft.messages,
      });
      toast('Gespeichert ✓');
      renderAppEditor(typeId);
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  };
  const remove = async () => {
    if (!confirm(`„${type.name}“ wirklich löschen? Alte Bewerbungen dafür bleiben in Discord lesbar.`)) return;
    try {
      data = await api(`g/${gid}/types/${typeId}`, 'DELETE');
      toast('Gelöscht');
      go(`#/g/${gid}/apps`);
    } catch (err) {
      toast(err.message, true);
    }
  };

  const inPanels = data.panels.filter((p) => p.types.includes(typeId)).map((p) => p.name);
  const saveButton = h('button', { class: 'btn primary', onclick: (e) => save(e.currentTarget) }, 'Speichern');
  const content = [
    h('a', { class: 'back', href: `#/g/${gid}/apps` }, '← Alle Bewerbungen'),
    h('div', { class: 'head' }, h('h1', {}, `${type.emoji} ${type.name}`), h('div', { class: 'actions' }, saveButton)),
    !type.editable ? h('p', { class: 'hint' }, 'Diese Bewerbung steht fest in der config.json und kann hier nicht geändert werden.') : null,
    h(
      'section',
      { class: 'section' },
      h('h2', {}, 'Allgemein'),
      h(
        'div',
        { class: 'row' },
        field('Name', bind('name', { maxLength: 80 })),
        field('Emoji', bind('emoji', { maxLength: 64 })),
        field('Kürzel der Nummer', bind('numberPrefix', { maxLength: 6, oninput: (e) => (draft.numberPrefix = e.target.value.toUpperCase()) }), `z. B. ${draft.numberPrefix}-0001`),
        field(
          'Ablauf',
          h(
            'select',
            { onchange: (e) => (draft.workflow = e.target.value) },
            h('option', { value: 'simple', selected: draft.workflow !== 'police' }, 'Einfach (offen → angenommen/abgelehnt)'),
            h('option', { value: 'police', selected: draft.workflow === 'police' }, 'Mehrstufig (Prüfung → Gespräch → Entscheidung)'),
          ),
        ),
      ),
      h('div', { class: 'row mt' }, field('Beschreibung (im Panel)', h('textarea', { maxLength: 500, value: draft.description ?? '', oninput: (e) => (draft.description = e.target.value) }))),
      h(
        'div',
        { class: 'toolbar' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: draft.enabled, onchange: (e) => (draft.enabled = e.target.checked) }), 'Bewerbungen annehmen (offen)'),
        h('span', { class: 'hint' }, inPanels.length ? `In Panel: ${inPanels.join(', ')}` : 'In keinem Panel – unter „Panels“ hinzufügen.'),
      ),
    ),
    h('section', { class: 'section' }, h('h2', {}, 'Fragen'), questionEditor(draft)),
    h(
      'section',
      { class: 'section' },
      h('h2', {}, 'Texte der Direktnachrichten'),
      h('p', { class: 'hint' }, 'Leer = Standardtext. Variablen: {applicant} {applicationName} {number} {user} (Entscheider) {reason} {questionCount} {timeLimit}'),
      h(
        'div',
        { class: 'row' },
        Object.entries(MESSAGE_FIELDS).map(([key, label]) =>
          field(label, h('textarea', { maxLength: 1500, placeholder: data.defaultMessages[key] ?? '', value: draft.messages[key] ?? '', oninput: (e) => (draft.messages[key] = e.target.value) })),
        ),
      ),
    ),
    h('p', { class: 'hint' }, 'Rollen, Kanäle, Wartezeit und Zeitlimit stellst du in Discord mit /einstellungen bewerbung ein.'),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn danger', onclick: remove }, 'Bewerbung löschen'), h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: (e) => save(e.currentTarget) }, 'Speichern')),
  ];
  app.replaceChildren(layout('apps', content));
}

// ---------- Panels ----------

function renderPanels() {
  const gid = data.guild.id;
  const head = h(
    'div',
    { class: 'head' },
    h('h1', {}, 'Panels: ', h('span', { class: 'count' }, data.panels.length)),
    h('div', { class: 'actions' }, plusButton('Neues Panel', () => go(`#/g/${gid}/panels/new`), { disabled: !data.types.length })),
  );
  let body;
  if (!data.types.length) {
    body = emptyState(
      'Keine Bewerbungen gefunden',
      'Du brauchst mindestens eine Bewerbung, um ein Panel zu erstellen. Komm zurück, sobald du eine angelegt hast.',
      'Bewerbung erstellen',
      () => (go(`#/g/${gid}/apps`), setTimeout(newAppDialog, 50)),
    );
  } else if (!data.panels.length) {
    body = emptyState('Noch keine Panels', 'Ein Panel ist die Nachricht in Discord, über die man sich bewirbt. Lege eins an und poste es in einen Kanal.', 'Panel erstellen', () => go(`#/g/${gid}/panels/new`));
  } else {
    body = h(
      'div',
      { class: 'grid' },
      data.panels.map((p) =>
        h(
          'div',
          { class: 'card', onclick: () => go(`#/g/${gid}/panels/${p.id}`) },
          h('div', { class: 'title' }, '🗂️ ', p.name),
          h('div', { class: 'meta' }, p.types.map((id) => data.types.find((t) => t.id === id)).filter(Boolean).map((t) => `${t.emoji} ${t.name}`).join(' · ') || 'Keine Bewerbungen'),
          h('div', {}, h('span', { class: `badge ${p.posts.length ? 'on' : ''}` }, p.posts.length ? `in ${p.posts.length} Kanal/Kanälen gepostet` : 'noch nicht gepostet')),
        ),
      ),
    );
  }
  app.replaceChildren(layout('panels', [head, body]));
}

function renderPanelEditor(panelId) {
  const gid = data.guild.id;
  const isNew = panelId === 'new';
  const panel = isNew ? { name: '', title: '', description: '', image: '', types: data.types.map((t) => t.id).slice(0, 25), posts: [] } : data.panels.find((p) => p.id === panelId);
  if (!panel || !data.types.length) return go(`#/g/${gid}/panels`);
  const draft = structuredClone(panel);
  const field = (label, el) => h('label', { class: 'field' }, label, el);
  const bind = (key, attrs = {}) => h('input', { value: draft[key] ?? '', oninput: (e) => (draft[key] = e.target.value), ...attrs });
  const chosen = new Set(draft.types);

  const save = async (button) => {
    button.disabled = true;
    const body = { name: draft.name, title: draft.title, description: draft.description, image: draft.image, types: data.types.map((t) => t.id).filter((id) => chosen.has(id)) };
    try {
      const result = await api(isNew ? `g/${gid}/panels` : `g/${gid}/panels/${panelId}`, isNew ? 'POST' : 'PATCH', body);
      data = result;
      toast(isNew ? 'Panel angelegt – jetzt in einen Kanal posten.' : 'Gespeichert ✓ – gepostete Panels werden aktualisiert.');
      if (isNew) go(`#/g/${gid}/panels/${result.id}`);
      else renderPanelEditor(panelId);
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  };

  const channel = h('select', {}, h('option', { value: '' }, 'Kanal wählen …'), data.channels.map((c) => h('option', { value: c.id }, `# ${c.name}`)));
  const post = async (button) => {
    if (!channel.value) return toast('Bitte einen Kanal wählen.', true);
    button.disabled = true;
    try {
      data = await api(`g/${gid}/panels/${panelId}/post`, 'POST', { channelId: channel.value });
      toast('Panel gepostet ✓');
      renderPanelEditor(panelId);
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  };
  const remove = async () => {
    if (!confirm(`Panel „${panel.name}“ löschen? Gepostete Nachrichten werden aus Discord entfernt.`)) return;
    try {
      data = await api(`g/${gid}/panels/${panelId}`, 'DELETE');
      toast('Gelöscht');
      go(`#/g/${gid}/panels`);
    } catch (err) {
      toast(err.message, true);
    }
  };

  const content = [
    h('a', { class: 'back', href: `#/g/${gid}/panels` }, '← Alle Panels'),
    h('div', { class: 'head' }, h('h1', {}, isNew ? 'Neues Panel' : `🗂️ ${panel.name}`), h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: (e) => save(e.currentTarget) }, isNew ? 'Erstellen' : 'Speichern'))),
    h(
      'section',
      { class: 'section' },
      h('h2', {}, 'Aussehen'),
      h('div', { class: 'row' }, field('Name (nur für dich)', bind('name', { maxLength: 80, placeholder: 'z. B. Polizei' })), field('Überschrift im Panel', bind('title', { maxLength: 200, placeholder: 'leer = Name' }))),
      h('div', { class: 'row mt' }, field('Text im Panel', h('textarea', { maxLength: 2000, value: draft.description, oninput: (e) => (draft.description = e.target.value) }))),
      h('div', { class: 'row mt' }, field('Bild-URL (optional)', bind('image', { maxLength: 500, placeholder: 'https://…' }))),
    ),
    h(
      'section',
      { class: 'section' },
      h('h2', {}, 'Bewerbungen im Panel'),
      h(
        'div',
        { class: 'roles' },
        data.types.map((t) =>
          h(
            'label',
            { class: 'check' },
            h('input', { type: 'checkbox', checked: chosen.has(t.id), onchange: (e) => (e.target.checked ? chosen.add(t.id) : chosen.delete(t.id)) }),
            `${t.emoji} ${t.name}${t.questions.length ? '' : ' (keine Fragen)'}`,
          ),
        ),
      ),
      h('p', { class: 'hint' }, 'Bewerbungen ohne Fragen erscheinen erst, wenn sie Fragen haben.'),
    ),
    !isNew
      ? h(
          'section',
          { class: 'section' },
          h('h2', {}, 'In Discord posten'),
          h('div', { class: 'toolbar flush' }, channel, h('button', { class: 'btn primary', onclick: (e) => post(e.currentTarget) }, 'Posten')),
          panel.posts.length
            ? h('ul', { class: 'posts' }, panel.posts.map((p) => h('li', {}, h('a', { href: `https://discord.com/channels/${gid}/${p.channelId}/${p.messageId}`, target: '_blank', rel: 'noopener' }, `# ${data.channels.find((c) => c.id === p.channelId)?.name ?? p.channelId}`))))
            : h('p', { class: 'hint' }, 'Noch nirgends gepostet.'),
          h('p', { class: 'hint' }, 'Gepostete Panels aktualisieren sich automatisch, wenn du hier etwas änderst.'),
        )
      : null,
    !isNew ? h('div', { class: 'toolbar' }, h('button', { class: 'btn danger', onclick: remove }, 'Panel löschen')) : null,
  ];
  app.replaceChildren(layout('panels', content));
}

// ---------- Navigation ----------

async function route() {
  try {
    if (!me) me = await api('me');
  } catch {
    return renderLogin();
  }
  const [, gid, section = 'apps', id] = location.hash.replace(/^#\/?/, '').split('/');
  if (!gid) {
    if (me.guilds.length === 1) return go(`#/g/${me.guilds[0].id}/apps`);
    return renderGuilds();
  }
  try {
    if (data?.guild.id !== gid || !id) data = await api(`g/${gid}`);
  } catch (err) {
    toast(err.message, true);
    return renderGuilds();
  }
  if (section === 'panels') return id ? renderPanelEditor(id) : renderPanels();
  return id ? renderAppEditor(id) : renderApps();
}

window.addEventListener('hashchange', route);
route();
