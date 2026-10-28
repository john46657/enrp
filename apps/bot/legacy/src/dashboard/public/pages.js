// Seiten des Dashboards. Jede Seite beschreibt ihre Bereiche und Felder; Pfade entsprechen der config.json.
(() => {
'use strict';
const { h, setChildren, ui, page, renderField, bindPath, bindItem, markDirty, getPath, render, runAction, live, state } = window.Dash;

const DAYS = [
  ['mo', 'Mo'],
  ['di', 'Di'],
  ['mi', 'Mi'],
  ['do', 'Do'],
  ['fr', 'Fr'],
  ['sa', 'Sa'],
  ['so', 'So'],
];
const LEAVE = [
  ['nothing', 'Nichts tun'],
  ['notify', 'Nur Hinweis im Ticket senden'],
  ['close', 'Hinweis senden und schließen'],
];
// Zeiten in der Zeitzone des Servers anzeigen.
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('de-DE', { timeZone: state.draft?.timezone || undefined, dateStyle: 'medium', timeStyle: 'short' }) : '—');
const channelName = (id) => state.guild.channels.find((c) => c.id === id)?.name;
const roleName = (id) => state.guild.roles.find((r) => r.id === id)?.name;

// Aufklappbarer Listeneintrag mit Entfernen-Knopf.
function listItem({ title, subtitle, badges = [], open, onToggle, onRemove }, body) {
  return h(
    'div',
    { class: 'item' },
    h(
      'div',
      { class: 'item-head', onclick: onToggle },
      h('div', { class: 'grow' }, h('b', {}, title), subtitle && h('div', { class: 'muted small' }, subtitle)),
      badges,
      onRemove && h('button', { class: 'btn ghost small', onclick: (e) => (e.stopPropagation(), onRemove()) }, 'Entfernen'),
      h('span', { class: 'muted' }, open ? '▴' : '▾'),
    ),
    open && h('div', { class: 'item-body' }, body),
  );
}
const openItems = new Set();
const toggleOpen = (key) => () => {
  openItems.has(key) ? openItems.delete(key) : openItems.add(key);
  render();
};

// Live-Daten nachladen und in einen Platzhalter zeichnen.
function liveBlock(name, draw) {
  const box = h('div', { class: 'muted' }, 'Lädt …');
  live(name)
    .then((data) => setChildren(box, draw(data)))
    .catch((err) => box.replaceChildren(h('span', {}, err.message)));
  return box;
}

// ---------- Übersicht ----------

page({
  id: 'overview',
  title: 'Übersicht',
  icon: '🏠',
  desc: 'Der aktuelle Stand dieses Servers auf einen Blick.',
  sections: () => [
    {
      title: 'Zahlen',
      render: () =>
        liveBlock('overview', (d) =>
          h(
            'div',
            { class: 'stats-grid' },
            [
              ['Offene Tickets', d.openTickets],
              ['Verwarnungen', d.warnings],
              ['Abwesend', d.absences],
              ['Statistik-Kanäle', d.statChannels],
            ].map(([label, value]) => h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value))),
          ),
        ),
    },
    {
      title: 'Module',
      render: () =>
        h(
          'div',
          { class: 'stats-grid' },
          state.pages
            .filter((p) => p.enabledPath && (!p.requires || p.requires in state.guild.config))
            .map((p) =>
              h(
                'a',
                { class: 'stat', href: `#/g/${state.guild.guild.id}/${p.id}` },
                h('div', { class: 'label' }, `${p.icon} ${p.title}`),
                h('span', { class: `badge ${getPath(state.draft, p.enabledPath) ? 'green' : ''}` }, getPath(state.draft, p.enabledPath) ? 'Aktiv' : 'Aus'),
              ),
            ),
        ),
    },
  ],
});

// ---------- Einstellungen ----------

page({
  id: 'settings',
  title: 'Einstellungen',
  icon: '⚙️',
  desc: 'Kanäle und Rollen, die mehrere Module nutzen.',
  sections: [
    {
      title: 'Kanäle',
      fields: [
        { t: 'channel', p: 'channels.welcome', label: 'Willkommen' },
        { t: 'channel', p: 'channels.modLog', label: 'Mod-Log' },
        { t: 'channel', p: 'channels.ticketLog', label: 'Ticket-Log' },
        { t: 'channel', p: 'channels.levelUp', label: 'Level-Up', empty: '— Im selben Kanal —' },
      ],
    },
    {
      title: 'Rollen',
      fields: [
        { t: 'role', p: 'roles.autoRole', label: 'Auto-Rolle', help: 'Bekommt jedes neue Mitglied.' },
        { t: 'role', p: 'roles.support', label: 'Support', help: 'Standard-Team für Tickets.' },
        { t: 'role', p: 'roles.staff', label: 'Staff', help: 'Darf Tickets freigeben, alle Bewerbungen entscheiden usw.' },
      ],
    },
    {
      title: 'Zeitzone',
      desc: 'Gilt für den Giveaway-Wochenplan, Abwesenheits-Daten, Ticket-Transkripte, die Bewerbungsstatistik und alle Zeiten hier im Dashboard. Zeitstempel in Discord-Nachrichten zeigt Discord sowieso in der Zeitzone des jeweiligen Mitglieds.',
      fields: [{ t: 'timezone', p: 'timezone', label: 'Zeitzone des Servers' }],
    },
    {
      title: 'FiveM',
      fields: [
        { t: 'text', p: 'fivem.address', label: 'Server-Adresse', placeholder: '123.45.67.89:30120' },
        { t: 'text', p: 'fivem.connectUrl', label: 'Verbinden-Link', placeholder: 'https://cfx.re/join/abc123' },
      ],
    },
    {
      title: 'Zurücksetzen',
      desc: 'Verwirft alle Änderungen dieses Servers (Dashboard und /einstellungen) und verwendet wieder die config.json.',
      render: () =>
        h(
          'button',
          {
            class: 'btn danger',
            onclick: async () => {
              if (!confirm('Wirklich alle Einstellungen dieses Servers zurücksetzen?')) return;
              await Dash.api(`/api/guilds/${state.guild.guild.id}/reset`, { method: 'POST' });
              location.reload();
            },
          },
          'Alles zurücksetzen',
        ),
    },
  ],
});

// ---------- Community ----------

page({
  id: 'welcome',
  group: 'Community',
  title: 'Willkommen',
  icon: '👋',
  desc: 'Nachricht für neue Mitglieder im Willkommens-Kanal (unter Einstellungen).',
  sections: [
    {
      title: 'Nachricht',
      fields: [
        { t: 'textarea', p: 'welcome.message', label: 'Text', wide: true, max: 1500, help: 'Platzhalter: <code>{user}</code> <code>{name}</code> <code>{server}</code> <code>{count}</code>' },
        { t: 'role', p: 'roles.autoRole', label: 'Auto-Rolle' },
        { t: 'channel', p: 'channels.welcome', label: 'Kanal' },
      ],
    },
  ],
});

page({
  id: 'leveling',
  group: 'Community',
  title: 'Leveling',
  icon: '📈',
  enabledPath: 'leveling.enabled',
  desc: 'XP für Nachrichten, Level-Ups und Rollen-Belohnungen.',
  sections: () => [
    {
      title: 'XP',
      fields: [
        { t: 'number', p: 'leveling.cooldownSeconds', label: 'Cooldown (Sekunden)', max: 3600 },
        { t: 'number', p: 'leveling.xpMin', label: 'XP mindestens', max: 1000 },
        { t: 'number', p: 'leveling.xpMax', label: 'XP höchstens', max: 1000 },
        { t: 'channel', p: 'channels.levelUp', label: 'Level-Up-Kanal', empty: '— Im selben Kanal —' },
      ],
    },
    {
      title: 'Rollen-Belohnungen',
      render: () => {
        const rewards = state.draft.leveling.roleRewards;
        const level = h('input', { type: 'number', min: 1, max: 500, placeholder: 'Level' });
        let role = '';
        return h(
          'div',
          {},
          Object.keys(rewards).length
            ? h(
                'table',
                {},
                h('tr', {}, h('th', {}, 'Level'), h('th', {}, 'Rolle'), h('th', {})),
                Object.entries(rewards)
                  .sort(([a], [b]) => a - b)
                  .map(([lvl, id]) =>
                    h(
                      'tr',
                      {},
                      h('td', {}, lvl),
                      h('td', {}, `@${roleName(id) ?? id}`),
                      h('td', {}, h('button', { class: 'btn ghost small', onclick: () => (delete rewards[lvl], markDirty('leveling.roleRewards'), render()) }, 'Entfernen')),
                    ),
                  ),
              )
            : h('div', { class: 'empty' }, 'Noch keine Belohnungen.'),
          h(
            'div',
            { class: 'card-body', style: 'padding:16px 0 0' },
            level,
            ui.role({ get: () => role, set: (v) => (role = v) }),
            h(
              'button',
              {
                class: 'btn',
                onclick: () => {
                  if (!level.value || !role) return Dash.toast('Level und Rolle wählen', true);
                  rewards[level.value] = role;
                  markDirty('leveling.roleRewards');
                  render();
                },
              },
              'Hinzufügen',
            ),
          ),
        );
      },
    },
  ],
});

const STAT_TYPES = {
  members: ['Mitglieder', '👥 Mitglieder: {count}'],
  humans: ['Menschen', '🧑 Menschen: {count}'],
  bots: ['Bots', '🤖 Bots: {count}'],
  boosts: ['Boosts', '💎 Boosts: {count}'],
  channels: ['Kanäle', '💬 Kanäle: {count}'],
  roles: ['Rollen', '🏷️ Rollen: {count}'],
  tickets: ['Offene Tickets', '🎫 Tickets: {count}'],
};
page({
  id: 'stats',
  group: 'Community',
  title: 'Server-Statistiken',
  icon: '📊',
  requires: 'stats',
  enabledPath: 'stats.enabled',
  offText: 'Es werden keine Kanäle angelegt oder umbenannt. Bereits angelegte Kanäle bleiben unverändert bestehen.',
  desc: 'Gesperrte Sprachkanäle, deren Name einen Zählerstand zeigt, z. B. „👥 Mitglieder: 1.284“.',
  sections: () => [
    {
      title: 'Einstellungen',
      fields: [{ t: 'channel', kind: 'category', p: 'stats.categoryId', label: 'Kategorie für die Statistik-Kanäle', empty: '— Keine (ganz oben) —', help: 'Hier legt der Bot neue Kanäle an. Bereits angelegte bleiben, wo sie sind.' }],
    },
    {
      title: 'Statistiken',
      desc: 'Jede Statistik ist ein gesperrter Sprachkanal. <code>{count}</code> wird durch die Zahl ersetzt; der Name ändert sich höchstens alle 5 Minuten (Discord-Limit). Entfernen löscht den Kanal.',
      actions: () => h('button', { class: 'btn small', onclick: () => runAction('stats-update', {}, 'Statistiken werden aktualisiert') }, 'Jetzt aktualisieren'),
      render: () => {
        const counters = state.draft.stats.counters;
        const free = Object.keys(STAT_TYPES).filter((t) => !counters.some((c) => c.type === t));
        let type = free[0];
        return h(
          'div',
          {},
          counters.length
            ? counters.map((c, i) =>
                h(
                  'div',
                  { class: 'item' },
                  h(
                    'div',
                    { class: 'item-head' },
                    h('b', { style: 'min-width:140px' }, STAT_TYPES[c.type]?.[0] ?? c.type),
                    h('div', { class: 'grow' }, ui.text(bindItem('stats.counters', c, 'name'), { max: 90 })),
                    i > 0 && h('button', { class: 'btn ghost small', title: 'Nach oben', onclick: () => (counters.splice(i - 1, 0, counters.splice(i, 1)[0]), markDirty('stats.counters'), render()) }, '↑'),
                    h('button', { class: 'btn ghost small', onclick: () => (counters.splice(i, 1), markDirty('stats.counters'), render()) }, 'Entfernen'),
                  ),
                ),
              )
            : h('div', { class: 'empty' }, 'Noch keine Statistik.'),
          free.length &&
            h(
              'div',
              { class: 'card-body', style: 'padding:16px 0 0' },
              ui.select({ get: () => type, set: (v) => (type = v) }, free.map((t) => [t, STAT_TYPES[t][0]])),
              h('button', { class: 'btn', onclick: () => (counters.push({ type, name: STAT_TYPES[type][1] }), markDirty('stats.counters'), render()) }, 'Hinzufügen'),
            ),
        );
      },
    },
  ],
});

// ---------- Giveaways ----------

function templateEditor(t, i) {
  const list = state.draft.giveaways.templates;
  const b = (key) => bindItem('giveaways.templates', t, key);
  const open = openItems.has(`tpl-${i}`);
  t.bonus ??= [];
  t.weekly ??= { enabled: false, day: 'fr', time: '18:00' };
  return listItem(
    {
      title: t.name || 'Neue Vorlage',
      subtitle: `${t.prize || '—'} · ${t.duration} · ${t.winners} Gewinner${t.weekly.enabled ? ` · jeden ${t.weekly.day} ${t.weekly.time}` : ''}`,
      open,
      onToggle: toggleOpen(`tpl-${i}`),
      onRemove: () => confirm('Vorlage entfernen?') && (list.splice(i, 1), markDirty('giveaways.templates'), render()),
      badges: [h('button', { class: 'btn small', onclick: (e) => (e.stopPropagation(), runAction('giveaway-template-start', { templateId: t.id }, 'Giveaway gestartet')) }, 'Jetzt starten')],
    },
    open && [
      ui.field({ label: 'Name (für /giveaway vorlage)' }, ui.text(b('name'), { max: 100 })),
      ui.field({ label: 'Preis' }, ui.text(b('prize'), { max: 200 })),
      ui.field({ label: 'Beschreibung (optional)', wide: true }, ui.textarea(b('description'), { max: 1000 })),
      ui.field({ label: 'Dauer', help: 'z. B. 30m, 2h, 1d, 1d12h, 1w' }, ui.text(b('duration'), { max: 20 })),
      ui.field({ label: 'Anzahl Gewinner' }, ui.number(b('winners'), { min: 1, max: 20 })),
      ui.field({ label: 'Kanal' }, ui.channel(b('channel'), { empty: '— Standard-Kanal —' })),
      ui.field({ label: 'Bild (optional)' }, ui.text(b('image'), { placeholder: 'https://…' })),
      h('h3', { class: 'field wide' }, 'Teilnahmebedingungen'),
      ui.field({ label: 'Pflicht-Rollen', help: 'Leer = alle dürfen teilnehmen.' }, ui.roles(b('requiredRoles'))),
      ui.field({ label: 'Gesperrte Rollen' }, ui.roles(b('blockedRoles'))),
      ui.field({ label: 'Bei mehreren Pflicht-Rollen' }, ui.select({ get: () => (t.requireAll ? 'all' : 'any'), set: (v) => b('requireAll').set(v === 'all') }, [['any', 'Eine davon reicht'], ['all', 'Alle nötig']])),
      ui.field({ label: 'Mind. Tage auf dem Server' }, ui.number(b('minServerDays'), { max: 3650 })),
      ui.field({ label: 'Mind. Account-Alter (Tage)', help: 'Schützt vor Zweitaccounts.' }, ui.number(b('minAccountDays'), { max: 3650 })),
      h(
        'div',
        { class: 'field wide' },
        h('label', {}, 'Bonus-Lose (Rolle · zusätzliche Lose, 1–10)'),
        [0, 1, 2].map((k) =>
          h(
            'div',
            { class: 'card-body', style: 'padding:0 0 8px' },
            ui.role({ get: () => t.bonus[k]?.role ?? '', set: (v) => ((t.bonus[k] = { role: v, entries: t.bonus[k]?.entries ?? 1 }), (t.bonus = t.bonus.filter((x) => x?.role)), markDirty('giveaways.templates')) }, { empty: '— Keine Bonus-Rolle —' }),
            ui.number({ get: () => t.bonus[k]?.entries ?? 1, set: (v) => t.bonus[k] && ((t.bonus[k].entries = v), markDirty('giveaways.templates')) }, { min: 1, max: 10 }),
          ),
        ),
      ),
      h('h3', { class: 'field wide' }, 'Automatisch wiederholen'),
      ui.field({ wide: true }, ui.toggle(bindItem('giveaways.templates', t.weekly, 'enabled'), `Wöchentlich automatisch starten (${state.draft.timezone})`)),
      ui.field({ label: 'Tag' }, ui.select(bindItem('giveaways.templates', t.weekly, 'day'), DAYS)),
      ui.field({ label: 'Uhrzeit' }, h('input', { type: 'time', value: t.weekly.time, onchange: (e) => bindItem('giveaways.templates', t.weekly, 'time').set(e.target.value) })),
    ],
  );
}

page({
  id: 'giveaways',
  group: 'Community',
  title: 'Giveaways',
  icon: '🎁',
  requires: 'giveaways',
  enabledPath: 'giveaways.enabled',
  offText: 'Neue Giveaways sind gesperrt. Laufende Giveaways laufen normal zu Ende.',
  desc: 'Verlosungen mit Teilnahme-Button, Bedingungen, Bonus-Losen und automatischer Ziehung. Gestartet wird mit <code>/giveaway start</code> oder aus einer Vorlage.',
  sections: () => [
    {
      title: 'Statistik',
      render: () =>
        liveBlock('giveaways', ({ stats }) =>
          h(
            'div',
            { class: 'stats-grid' },
            [
              ['Giveaways', stats.total],
              ['Laufend', stats.running],
              ['Teilnahmen gesamt', stats.entries],
              ['Ø Teilnehmer', stats.average ?? '—'],
              ['Gewinner', stats.winners],
              ['Einlösequote', stats.claimRate === null ? '—' : `${stats.claimRate} %`],
            ].map(([label, value]) => h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value))),
          ),
        ),
    },
    {
      title: 'Giveaways',
      render: () => {
        const filters = [['active', 'Laufend'], ['ended', 'Beendet'], ['cancelled', 'Abgebrochen'], ['all', 'Alle']];
        let filter = 'active';
        const box = h('div');
        const act = (name, messageId, msg) => runAction(name, { messageId }, msg).then(render);
        const draw = (list) => {
          const shown = list.filter((g) => filter === 'all' || (filter === 'active' ? !g.ended : filter === 'cancelled' ? g.cancelled : g.ended && !g.cancelled));
          setChildren(
            box,
            h('div', { class: 'chips' }, filters.map(([id, label]) => h('button', { class: 'chip', style: id === filter ? 'border-color:var(--accent);color:#8fb6ff' : '', onclick: () => ((filter = id), draw(list)) }, label))),
            shown.length
              ? h(
                  'table',
                  {},
                  h('tr', {}, h('th', {}, 'Preis'), h('th', {}, 'Kanal'), h('th', {}, 'Teilnehmer'), h('th', {}, 'Ende'), h('th', {}, 'Gewinner'), h('th', {})),
                  shown.map((g) =>
                    h(
                      'tr',
                      {},
                      h('td', {}, g.prize),
                      h('td', {}, `#${g.channel ?? '?'}`),
                      h('td', {}, g.entries),
                      h('td', {}, fmtTime(g.endsAt)),
                      h('td', {}, g.cancelled ? 'abgebrochen' : g.winners.length ? `${g.winners.length} (${g.winners.filter((id) => g.claims?.[id]?.claimed).length} eingelöst)` : '—'),
                      h(
                        'td',
                        { style: 'white-space:nowrap' },
                        !g.ended && h('button', { class: 'btn ghost small', onclick: () => act('giveaway-end', g.messageId, 'Beendet') }, 'Beenden'),
                        !g.ended && h('button', { class: 'btn ghost small', onclick: () => confirm('Ohne Gewinner abbrechen?') && act('giveaway-cancel', g.messageId, 'Abgebrochen') }, 'Abbrechen'),
                        g.ended && !g.cancelled && h('button', { class: 'btn ghost small', onclick: () => act('giveaway-reroll', g.messageId, 'Neu gezogen') }, 'Neu ziehen'),
                      ),
                    ),
                  ),
                )
              : h('div', { class: 'empty' }, 'Keine Giveaways in dieser Ansicht.'),
          );
        };
        live('giveaways').then(({ list }) => draw(list)).catch((err) => setChildren(box, err.message));
        return box;
      },
    },
    {
      title: 'Vorlagen',
      desc: 'Starten mit <code>/giveaway vorlage name</code>, hier mit „Jetzt starten“ (nach dem Speichern) oder automatisch jede Woche (Zeitzone des Servers, unter Einstellungen).',
      actions: () =>
        h(
          'button',
          {
            class: 'btn primary small',
            onclick: () => {
              const list = state.draft.giveaways.templates;
              list.push({ id: `t${Date.now().toString(36)}`, name: `Vorlage ${list.length + 1}`, prize: '', description: '', duration: '1d', winners: 1, channel: '', image: '', requiredRoles: [], requireAll: false, blockedRoles: [], minServerDays: 0, minAccountDays: 0, bonus: [], weekly: { enabled: false, day: 'fr', time: '18:00' } });
              openItems.add(`tpl-${list.length - 1}`);
              markDirty('giveaways.templates');
              render();
            },
          },
          '+ Neue Vorlage',
        ),
      render: () => (state.draft.giveaways.templates.length ? h('div', {}, state.draft.giveaways.templates.map(templateEditor)) : h('div', { class: 'empty' }, 'Noch keine Vorlagen erstellt.')),
    },
    {
      title: 'Verwaltung & Kanäle',
      fields: [
        { t: 'roles', p: 'giveaways.managerRoles', label: 'Giveaway-Manager-Rollen', help: 'Dürfen /giveaway nutzen. Admins dürfen immer.' },
        { t: 'channel', p: 'giveaways.defaultChannel', label: 'Standard-Kanal' },
        { t: 'channel', p: 'giveaways.logChannel', label: 'Log-Kanal (optional)', empty: '— Keiner —' },
      ],
    },
    {
      title: 'Ankündigung',
      fields: [
        { t: 'select', p: 'giveaways.ping', label: 'Ping beim Start', options: [['none', 'Niemand'], ['role', 'Bestimmte Rolle'], ['here', '@here'], ['everyone', '@everyone']] },
        { t: 'role', p: 'giveaways.pingRole', label: 'Ping-Rolle', help: 'Nur bei „Bestimmte Rolle“.' },
      ],
    },
    {
      title: 'Aussehen',
      fields: [
        { t: 'text', p: 'giveaways.color', label: 'Standard-Farbe', max: 7, placeholder: '#2F7BFF' },
        { t: 'text', p: 'giveaways.image', label: 'Standard-Bild (optional)', placeholder: 'https://…' },
        { t: 'text', p: 'giveaways.buttonEmoji', label: 'Emoji des Teilnehmen-Buttons', max: 60, help: 'Unicode-Emoji oder eigenes Emoji als &lt;:name:id&gt;' },
        { t: 'text', p: 'giveaways.buttonLabel', label: 'Text des Teilnehmen-Buttons', max: 80 },
        { t: 'toggle', p: 'giveaways.showCount', label: 'Teilnehmerzahl im Giveaway anzeigen' },
      ],
    },
    {
      title: 'Gewinner',
      fields: [
        { t: 'select', p: 'giveaways.notify', label: 'Gewinner benachrichtigen', options: [['channel_dm', 'Ping im Kanal und DM'], ['channel', 'Nur Ping im Kanal'], ['dm', 'Nur DM']] },
        { t: 'textarea', p: 'giveaways.winnerMessage', label: 'Gewinner-Nachricht (DM)', wide: true, help: '<code>{user}</code> <code>{username}</code> <code>{prize}</code> <code>{server}</code> <code>{giveaway}</code>' },
        { t: 'role', p: 'giveaways.winnerRole', label: 'Gewinner-Rolle', help: 'Die Rolle des Bots muss darüber stehen.' },
        { t: 'number', p: 'giveaways.winnerRoleDays', label: 'Rolle wieder entfernen nach (Tagen)', max: 365, help: '0 = Rolle bleibt dauerhaft.' },
        { t: 'toggle', p: 'giveaways.claim.enabled', label: 'Einlösefrist: Gewinner müssen per Button bestätigen, sonst wird neu gezogen' },
        { t: 'number', p: 'giveaways.claim.hours', label: 'Frist (Stunden)', min: 1, max: 720 },
        {
          t: 'select',
          p: 'giveaways.winnerTicket',
          label: 'Ticket für Gewinner',
          options: [['', '— Kein Ticket —'], ...state.draft.tickets.types.map((x) => [x.id, `${x.emoji} ${x.label}`])],
          help: 'Öffnet beim Einlösen ein Ticket zur Preisübergabe (nur mit Einlösefrist).',
        },
      ],
    },
    {
      title: 'Blacklist',
      desc: 'Ausgeschlossene können nicht teilnehmen und werden nie gezogen.',
      fields: [
        { t: 'roles', p: 'giveaways.blacklist.roles', label: 'Ausgeschlossene Rollen' },
        { t: 'lines', p: 'giveaways.blacklist.users', label: 'Ausgeschlossene Mitglieder (User-IDs)', placeholder: 'Eine ID pro Zeile', help: 'Einfacher in Discord mit <code>/giveaway blacklist add</code>.' },
      ],
    },
  ],
});

// ---------- Vorschläge ----------

function suggestionCategoryEditor(c, i) {
  const list = state.draft.suggestions.categories;
  const b = (key) => bindItem('suggestions.categories', c, key);
  const open = openItems.has(`sug-${i}`);
  c.fields ??= [];
  return listItem(
    {
      title: `${c.emoji || '💡'} ${c.name}`,
      subtitle: c.description,
      badges: [c.enabled === false ? h('span', { class: 'badge red' }, 'Aus') : h('span', { class: 'badge green' }, 'Aktiv')],
      open,
      onToggle: toggleOpen(`sug-${i}`),
      onRemove: () => confirm(`Kategorie „${c.name}“ entfernen?`) && (list.splice(i, 1), markDirty('suggestions.categories'), render()),
    },
    open && [
      ui.field({ label: 'Name' }, ui.text(b('name'), { max: 100 })),
      ui.field({ label: 'Emoji' }, ui.text(b('emoji'), { max: 60 })),
      ui.field({ label: 'Beschreibung', wide: true }, ui.text(b('description'), { max: 100 })),
      ui.field({ wide: true }, ui.toggle({ get: () => c.enabled !== false, set: (v) => b('enabled').set(v) }, 'Kategorie aktiv')),
      h('h3', { class: 'field wide' }, `Formular (${c.fields.length}/5 Felder)`),
      h(
        'div',
        { class: 'field wide' },
        c.fields.map((f, k) =>
          h(
            'div',
            { class: 'item' },
            h(
              'div',
              { class: 'item-body', style: 'padding-top:14px' },
              ui.field({ label: `Feld ${k + 1}` }, ui.text(bindItem('suggestions.categories', f, 'label'), { max: 45 })),
              ui.field({ label: 'Art' }, ui.select(bindItem('suggestions.categories', f, 'style'), [['short', 'Einzeiliger Text'], ['paragraph', 'Mehrzeiliger Text']])),
              ui.field({ label: 'Max. Länge' }, ui.number(bindItem('suggestions.categories', f, 'maxLength'), { min: 1, max: 4000 })),
              ui.field({}, ui.toggle({ get: () => f.required !== false, set: (v) => bindItem('suggestions.categories', f, 'required').set(v) }, 'Pflichtfeld')),
              ui.field({}, h('button', { class: 'btn ghost small', onclick: () => (c.fields.splice(k, 1), markDirty('suggestions.categories'), render()) }, 'Feld entfernen')),
            ),
          ),
        ),
        c.fields.length < 5 && h('button', { class: 'btn small', onclick: () => (c.fields.push({ label: 'Frage', style: 'short', required: true, maxLength: 500 }), markDirty('suggestions.categories'), render()) }, '+ Feld hinzufügen'),
      ),
    ],
  );
}

const SUG_STATUS = { open: ['Offen', ''], progress: ['In Bearbeitung', 'yellow'], accepted: ['Angenommen', 'green'], done: ['Fertig', 'green'], denied: ['Abgelehnt', 'red'] };
page({
  id: 'suggestions',
  group: 'Community',
  title: 'Vorschläge',
  icon: '💡',
  requires: 'suggestions',
  enabledPath: 'suggestions.enabled',
  offText: 'Der Befehl /vorschlag ist aktuell nicht nutzbar.',
  desc: 'Mitglieder reichen mit <code>/vorschlag</code> Ideen ein, die Community stimmt ab und das Team entscheidet.',
  sections: () => [
    {
      title: 'Kategorien',
      desc: 'Beim Einreichen wählt das Mitglied eine Kategorie und füllt danach das Formular aus. Gibt es nur eine aktive Kategorie, öffnet sich das Formular direkt.',
      actions: () =>
        h(
          'button',
          {
            class: 'btn primary small',
            onclick: () => {
              const list = state.draft.suggestions.categories;
              if (list.length >= 4) return Dash.toast('Höchstens 4 Kategorien.', true);
              list.push({ id: `k${Date.now().toString(36)}`, name: 'Neue Kategorie', emoji: '💡', description: '', enabled: true, fields: [{ label: 'Titel', style: 'short', required: true, maxLength: 100 }, { label: 'Beschreibung', style: 'paragraph', required: true, maxLength: 1500 }] });
              openItems.add(`sug-${list.length - 1}`);
              markDirty('suggestions.categories');
              render();
            },
          },
          `+ Neue Kategorie (${state.draft.suggestions.categories.length}/4)`,
        ),
      render: () => (state.draft.suggestions.categories.length ? h('div', {}, state.draft.suggestions.categories.map(suggestionCategoryEditor)) : h('div', { class: 'empty' }, 'Noch keine Kategorie – lege mindestens eine an.')),
    },
    {
      title: 'Kanäle und Rollen',
      fields: [
        { t: 'channel', p: 'suggestions.channel', label: 'Kanal für Vorschläge' },
        { t: 'roles', p: 'suggestions.teamRoles', label: 'Team-Rollen', help: 'Dürfen annehmen, ablehnen und Stimmen zurücksetzen. Admins dürfen immer.' },
        { t: 'toggle', p: 'suggestions.threads', label: 'Für jeden Vorschlag einen Diskussions-Thread erstellen' },
      ],
    },
    {
      title: 'Gründe',
      fields: [
        { t: 'toggle', p: 'suggestions.requireAcceptReason', label: 'Beim Annehmen muss ein Grund angegeben werden' },
        { t: 'toggle', p: 'suggestions.requireDenyReason', label: 'Beim Ablehnen muss ein Grund angegeben werden' },
      ],
    },
    {
      title: 'Nach der Annahme',
      fields: [
        { t: 'toggle', p: 'suggestions.dmOnAccept', label: 'Einreicher per DM benachrichtigen' },
        { t: 'channel', p: 'suggestions.acceptedChannel', label: 'Angenommene Vorschläge zusätzlich posten in', empty: '— Nicht separat loggen —' },
      ],
    },
    {
      title: 'In Bearbeitung',
      fields: [{ t: 'toggle', p: 'suggestions.inProgress', label: 'Team kann Vorschläge auf „In Bearbeitung“ setzen (danach nur noch „Fertiggestellt“)' }],
    },
    {
      title: 'Letzte Vorschläge',
      render: () =>
        liveBlock('suggestions', (list) =>
          list.length
            ? h(
                'table',
                {},
                h('tr', {}, h('th', {}, '#'), h('th', {}, 'Kategorie'), h('th', {}, 'Titel'), h('th', {}, 'Stimmen'), h('th', {}, 'Status'), h('th', {}, 'Datum')),
                list.map((s) => {
                  const [label, color] = SUG_STATUS[s.status] ?? [s.status, ''];
                  return h('tr', {}, h('td', {}, s.number), h('td', {}, s.category), h('td', {}, s.title.slice(0, 80)), h('td', {}, `👍 ${s.up} · 👎 ${s.down}`), h('td', {}, h('span', { class: `badge ${color}` }, label)), h('td', {}, fmtTime(s.createdAt)));
                }),
              )
            : h('div', { class: 'empty' }, 'Noch keine Vorschläge.'),
        ),
    },
  ],
});

// ---------- Zählen ----------

page({
  id: 'counting',
  group: 'Community',
  title: 'Zählen',
  icon: '🔢',
  requires: 'counting',
  enabledPath: 'counting.enabled',
  offText: 'Im Zähl-Kanal reagiert der Bot nicht.',
  desc: 'Mitglieder zählen in einem Kanal 1, 2, 3 … hoch. Richtige Zahlen bekommen ✅. Nachrichten ohne Zahl am Anfang werden ignoriert.',
  sections: () => [
    {
      title: 'Einstellungen',
      fields: [
        { t: 'channel', p: 'counting.channel', label: 'Zähl-Kanal', help: 'Tipp: Slow-Modus im Kanal einschalten.' },
        { t: 'toggle', p: 'counting.resetOnFail', label: 'Falsche Zahl setzt auf 1 zurück', help: 'Aus = falsche Zahlen werden nur gelöscht, der Stand bleibt.' },
        { t: 'toggle', p: 'counting.allowTwice', label: 'Dieselbe Person darf zweimal hintereinander zählen' },
      ],
    },
    {
      title: 'Stand',
      render: () => {
        const input = h('input', { type: 'number', min: 0, placeholder: 'Zahl' });
        return h(
          'div',
          {},
          liveBlock('counting', (d) =>
            h(
              'div',
              { class: 'card-body', style: 'padding:0' },
              h('div', {}, `Aktuell: `, h('b', {}, d.current), ` · Nächste Zahl: `, h('b', {}, d.current + 1), ` · Rekord: `, h('b', {}, d.record), d.recordAt ? ` (${fmtTime(d.recordAt)})` : '', ` · Zurückgesetzt: ${d.resets}×`),
            ),
          ),
          h(
            'div',
            { class: 'card-body', style: 'padding:16px 0 0' },
            input,
            h('button', { class: 'btn small', onclick: () => input.value !== '' && confirm(`Stand auf ${input.value} setzen?`) && runAction('counting-set', { number: Number(input.value) }, 'Stand gesetzt').then(render) }, 'Stand setzen'),
          ),
        );
      },
    },
    {
      title: 'Beste Zähler',
      render: () =>
        liveBlock('counting', ({ top }) =>
          top.length
            ? h('table', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Mitglied'), h('th', {}, 'Richtig'), h('th', {}, 'Fehler')), top.map((t, i) => h('tr', {}, h('td', {}, i + 1), h('td', {}, t.user), h('td', {}, t.count), h('td', {}, t.fails))))
            : h('div', { class: 'empty' }, 'Noch hat niemand gezählt.'),
        ),
    },
  ],
});

// ---------- Tickets ----------

function ticketTypeEditor(t, index) {
  const list = state.draft.tickets.types;
  const g = state.draft.tickets;
  const b = (key) => bindItem('tickets.types', t, key);
  // Überschreibbare Regel: an = eigener Wert, aus = allgemeine Einstellung.
  const override = (key, label, makeDefault, editor) => {
    const own = t[key] !== undefined;
    return [
      ui.field(
        { wide: true },
        ui.toggle({ get: () => own, set: (v) => (b(key).set(v ? structuredClone(makeDefault()) : undefined), render()) }, `${label}: eigene Einstellung für diese Kategorie`),
      ),
      own && editor(),
    ];
  };
  const open = openItems.has(`type-${index}`);
  return listItem(
    {
      title: `${t.emoji} ${t.label}`,
      subtitle: t.description,
      badges: [t.enabled === false ? h('span', { class: 'badge red' }, 'Aus') : h('span', { class: 'badge green' }, 'Aktiv')],
      open,
      onToggle: toggleOpen(`type-${index}`),
      onRemove: () => {
        if (!confirm(`Kategorie „${t.label}“ entfernen?`)) return;
        list.splice(index, 1);
        markDirty('tickets.types');
        render();
      },
    },
    open && [
      ui.field({ label: 'Name' }, ui.text(b('label'), { max: 80 })),
      ui.field({ label: 'Emoji' }, ui.text(b('emoji'), { max: 60 })),
      ui.field({ label: 'Prefix (für den Kanalnamen)' }, ui.text(b('prefix'), { max: 30 })),
      ui.field({ label: 'Beschreibung', wide: true, help: 'Wird im Panel angezeigt.' }, ui.textarea(b('description'), { max: 500 })),
      ui.field({ label: 'Discord-Kategorie' }, ui.channel(b('categoryId'), { kind: 'category', empty: '— Allgemeine Ticket-Kategorie —' })),
      ui.field({ label: 'Auslastung (0 = ausblenden)' }, ui.number(b('capacity'), { max: 1000 })),
      ui.field({ label: 'Support-Rollen', wide: true, help: 'Leer = allgemeine Support-Rolle.' }, ui.roles(b('roles'))),
      ui.field({ wide: true }, ui.toggle({ get: () => t.enabled !== false, set: (v) => b('enabled').set(v) }, 'Kategorie aktiv')),
      ui.field({ wide: true }, ui.toggle({ get: () => t.allowClaim !== false, set: (v) => b('allowClaim').set(v) }, 'Claimen erlauben')),
      ui.field({ wide: true }, ui.toggle({ get: () => t.allowOnBehalf !== false, set: (v) => b('allowOnBehalf').set(v) }, 'Im Auftrag erlauben (/ticket fuer)')),
      h('h3', { class: 'field wide' }, 'Eröffnungs-Embed'),
      ui.field({ label: 'Titel', help: 'Leer = Standard' }, ui.text(bindItem('tickets.types', (t.openEmbed ??= {}), 'title'), { max: 200 })),
      ui.field({ label: 'Bild-URL' }, ui.text(bindItem('tickets.types', t.openEmbed, 'image'), { placeholder: 'https://…' })),
      ui.field(
        { label: 'Text', wide: true, help: 'Platzhalter: <code>{user}</code> <code>{username}</code> <code>{category}</code> <code>{emoji}</code> <code>{number}</code>' },
        ui.textarea(bindItem('tickets.types', t.openEmbed, 'description'), { max: 1500 }),
      ),
      h('h3', { class: 'field wide' }, 'Schließen-Formular (max. 5 Felder)'),
      h('div', { class: 'field wide' }, closeFormEditor(t)),
      h('h3', { class: 'field wide' }, 'Schließen & Automationen'),
      override('onlyTeamCanClose', 'Schließen einschränken', () => true, () =>
        ui.field({ wide: true, help: 'Der Ersteller kann um Schließung bitten, ein Teammitglied stimmt zu.' }, ui.toggle(b('onlyTeamCanClose'), 'Nur Support darf schließen')),
      ),
      override('autoClose', 'Auto-Close', () => g.autoClose, () => [
        ui.field({ wide: true }, ui.toggle(bindItem('tickets.types', t.autoClose, 'enabled'), 'Auto-Close bei Inaktivität')),
        ui.field({ label: 'Schließen nach (Stunden ohne Nachricht)' }, ui.number(bindItem('tickets.types', t.autoClose, 'afterHours'), { min: 1, max: 2160 })),
      ]),
      override('autoTeamAlert', 'Erinnerung', () => g.autoTeamAlert, () => [
        ui.field({ wide: true }, ui.toggle(bindItem('tickets.types', t.autoTeamAlert, 'enabled'), 'Erinnerung, falls noch niemand geantwortet hat')),
        ui.field({ label: 'Erinnern nach (Minuten)' }, ui.number(bindItem('tickets.types', t.autoTeamAlert, 'afterMinutes'), { min: 1, max: 10080 })),
        ui.field({ label: 'Erinnerungsnachricht', wide: true, help: 'Leer = Standard. Platzhalter: <code>{user}</code> <code>{since}</code>' }, ui.textarea(bindItem('tickets.types', t.autoTeamAlert, 'message'), { max: 500 })),
      ]),
      override('onCreatorLeave', 'Verlassen des Erstellers', () => g.onCreatorLeave, () => [
        ui.field({ label: 'Aktion' }, ui.select(b('onCreatorLeave'), LEAVE)),
        ui.field({ label: 'Nachricht / Grund', wide: true, help: 'Platzhalter: <code>{user}</code> <code>{username}</code>' }, ui.textarea({ get: () => t.leaveMessage ?? g.leaveMessage, set: (v) => b('leaveMessage').set(v) }, { max: 500 })),
      ]),
    ],
  );
}

function closeFormEditor(t) {
  const form = (t.closeForm ??= []);
  const fb = (field, key) => bindItem('tickets.types', field, key);
  return h(
    'div',
    {},
    form.map((field, i) =>
      h(
        'div',
        { class: 'item' },
        h(
          'div',
          { class: 'item-body', style: 'padding-top:14px' },
          ui.field({ label: `Feld ${i + 1}` }, ui.text(fb(field, 'label'), { max: 45, placeholder: 'Frage / Label' })),
          ui.field({ label: 'Art' }, ui.select(fb(field, 'style'), [['short', 'Einzeiliger Text'], ['paragraph', 'Mehrzeiliger Text']])),
          ui.field({ label: 'Platzhalter' }, ui.text(fb(field, 'placeholder'), { max: 100 })),
          ui.field({ label: 'Max. Länge' }, ui.number(fb(field, 'maxLength'), { min: 1, max: 4000 })),
          ui.field({}, ui.toggle({ get: () => field.required !== false, set: (v) => fb(field, 'required').set(v) }, 'Pflichtfeld')),
          ui.field({}, h('button', { class: 'btn ghost small', onclick: () => (form.splice(i, 1), markDirty('tickets.types'), render()) }, 'Feld entfernen')),
        ),
      ),
    ),
    form.length < 5 &&
      h('button', { class: 'btn small', onclick: () => (form.push({ label: '', style: 'short', placeholder: '', maxLength: 500, required: true }), markDirty('tickets.types'), render()) }, `+ Feld hinzufügen (${form.length}/5)`),
  );
}

function periodsEditor() {
  const periods = state.draft.tickets.openingHours.periods;
  return h(
    'div',
    {},
    periods.map((p, i) =>
      h(
        'div',
        { class: 'item' },
        h(
          'div',
          { class: 'item-head' },
          h(
            'div',
            { class: 'pills grow' },
            DAYS.map(([day, label]) =>
              h(
                'button',
                {
                  class: `chip${p.days.includes(day) ? ' active' : ''}`,
                  style: p.days.includes(day) ? 'border-color:var(--accent);color:#8fb6ff' : '',
                  onclick: () => {
                    p.days = p.days.includes(day) ? p.days.filter((d) => d !== day) : DAYS.map(([d]) => d).filter((d) => d === day || p.days.includes(d));
                    markDirty('tickets.openingHours.periods');
                    render();
                  },
                },
                label,
              ),
            ),
          ),
          h('input', { type: 'time', value: p.from, style: 'width:120px', onchange: (e) => ((p.from = e.target.value), markDirty('tickets.openingHours.periods')) }),
          '–',
          h('input', { type: 'text', value: p.to, style: 'width:90px', placeholder: '24:00', onchange: (e) => ((p.to = e.target.value), markDirty('tickets.openingHours.periods')) }),
          h('button', { class: 'btn ghost small', onclick: () => (periods.splice(i, 1), markDirty('tickets.openingHours.periods'), render()) }, 'Entfernen'),
        ),
      ),
    ),
    h('button', { class: 'btn small', onclick: () => (periods.push({ days: ['mo', 'di', 'mi', 'do', 'fr'], from: '15:00', to: '23:00' }), markDirty('tickets.openingHours.periods'), render()) }, '+ Zeitraum'),
  );
}

page({
  id: 'tickets',
  group: 'Support',
  title: 'Tickets',
  icon: '🎫',
  desc: 'Panel, Kategorien, Öffnungszeiten und Automationen. Das Panel postest du mit <code>/ticket panel</code>.',
  sections: () => [
    {
      title: 'Kategorien',
      desc: 'Jede Kategorie erscheint im Auswahlmenü des Panels. Aufklappen für alle Einstellungen.',
      actions: () =>
        h(
          'button',
          {
            class: 'btn primary small',
            onclick: () => {
              const name = prompt('Name der neuen Kategorie:');
              if (!name) return;
              const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `kategorie-${Date.now()}`;
              if (state.draft.tickets.types.some((t) => t.id === id)) return Dash.toast('Diese Kategorie gibt es schon.', true);
              state.draft.tickets.types.push({ id, prefix: id, label: name, emoji: '🎫', capacity: 0, roles: [], description: 'Beschreibung', enabled: true, allowClaim: true, allowOnBehalf: true, openEmbed: { title: '', description: '', image: '' }, closeForm: [] });
              openItems.add(`type-${state.draft.tickets.types.length - 1}`);
              markDirty('tickets.types');
              render();
            },
          },
          '+ Neue Kategorie',
        ),
      render: () => h('div', {}, state.draft.tickets.types.map(ticketTypeEditor), h('p', { class: 'help' }, 'Hinweis: In den Slash-Befehlen (/ticket fuer, /einstellungen) stehen nur die Kategorien aus der config.json zur Auswahl.')),
    },
    {
      title: 'Allgemein',
      fields: [
        { t: 'channel', kind: 'category', p: 'tickets.categoryId', label: 'Discord-Kategorie für Tickets' },
        { t: 'channel', p: 'channels.ticketLog', label: 'Ticket-Log' },
        { t: 'number', p: 'tickets.maxOpenPerUser', label: 'Offene Tickets pro Nutzer (0 = kein Limit)', max: 50 },
        { t: 'text', p: 'tickets.channelName', label: 'Kanalname', help: '<code>%PREFIX%</code> <code>%USERNAME%</code> <code>%USER_ID%</code> <code>%USER_NICK_NAME%</code> <code>%DISPLAY_NAME%</code> <code>%EMOTE%</code> <code>%TICKET_NUMBER%</code> <code>%CASEID%</code>' },
        { t: 'toggle', p: 'tickets.pingTeam', label: 'Team beim Öffnen markieren' },
        { t: 'toggle', p: 'tickets.onlyTeamCanClose', label: 'Nur das Team darf schließen (Ersteller stellt eine Schließungs-Anfrage)' },
        { t: 'toggle', p: 'tickets.creatorCanAddUsers', label: 'Ersteller darf Personen anfragen (/ticket hinzufuegen)' },
        { t: 'toggle', p: 'tickets.logging.activities', label: 'Aktivitäten im Ticket-Log protokollieren' },
        { t: 'toggle', p: 'tickets.logging.transcripts', label: 'Transkript beim Schließen speichern (Log + DM)' },
        { t: 'toggle', p: 'tickets.claimCategory.enabled', label: 'Übernommene Tickets in eine eigene Kategorie verschieben' },
        { t: 'channel', kind: 'category', p: 'tickets.claimCategory.categoryId', label: 'Claim-Kategorie' },
      ],
    },
    {
      title: 'Panel',
      actions: () => h('button', { class: 'btn small', onclick: () => runAction('ticket-panels-refresh', {}, 'Panels aktualisiert') }, 'Panels neu zeichnen'),
      fields: [
        { t: 'text', p: 'tickets.panel.title', label: 'Titel', max: 200 },
        { t: 'text', p: 'tickets.panel.placeholder', label: 'Text im Auswahlmenü', max: 150 },
        { t: 'textarea', p: 'tickets.panel.description', label: 'Beschreibung', wide: true, max: 1500 },
        { t: 'text', p: 'tickets.panel.image', label: 'Banner (Bild-URL)', placeholder: 'https://…' },
        { t: 'text', p: 'tickets.panel.footer', label: 'Fußzeile', max: 200 },
        { t: 'toggle', p: 'tickets.panel.showLoad', label: 'Auslastung im Panel anzeigen' },
      ],
    },
    {
      title: 'Öffnungszeiten',
      desc: 'Außerhalb bekommt jedes neue Ticket einen Hinweis, wann das Team wieder da ist; Erinnerungen und Auto-Close pausieren.',
      render: () =>
        h(
          'div',
          { class: 'card-body', style: 'padding:0' },
          renderField({ t: 'toggle', p: 'tickets.openingHours.enabled', label: 'Öffnungszeiten verwenden' }),
          renderField({ t: 'timezone', p: 'tickets.openingHours.timezone', label: 'Zeitzone der Öffnungszeiten' }),
          h('div', { class: 'field wide' }, periodsEditor()),
        ),
    },
    {
      title: 'Automationen (allgemein)',
      desc: 'Gelten für alle Kategorien ohne eigene Einstellung.',
      fields: [
        { t: 'toggle', p: 'tickets.autoClose.enabled', label: 'Auto-Close bei Inaktivität' },
        { t: 'number', p: 'tickets.autoClose.afterHours', label: 'Schließen nach (Stunden ohne Nachricht)', min: 1, max: 2160 },
        { t: 'toggle', p: 'tickets.autoTeamAlert.enabled', label: 'Team erinnern, falls noch niemand geantwortet hat' },
        { t: 'number', p: 'tickets.autoTeamAlert.afterMinutes', label: 'Erinnern nach (Minuten)', min: 1, max: 10080 },
        { t: 'textarea', p: 'tickets.autoTeamAlert.message', label: 'Erinnerungsnachricht', wide: true, max: 500, help: 'Leer = Standard. <code>{user}</code> <code>{since}</code>' },
        { t: 'toggle', p: 'tickets.autoUnclaim.enabled', label: 'Automatisch freigeben, wenn der Bearbeiter inaktiv ist' },
        { t: 'number', p: 'tickets.autoUnclaim.afterHours', label: 'Freigeben nach (Stunden)', min: 1, max: 720 },
        { t: 'select', p: 'tickets.onCreatorLeave', label: 'Wenn der Ersteller den Server verlässt', options: LEAVE },
        { t: 'textarea', p: 'tickets.leaveMessage', label: 'Nachricht / Grund', wide: true, max: 500, help: '<code>{user}</code> <code>{username}</code>' },
      ],
    },
    {
      title: 'Offene Tickets',
      render: () =>
        liveBlock('tickets', (list) =>
          list.length
            ? h(
                'table',
                {},
                h('tr', {}, h('th', {}, '#'), h('th', {}, 'Kanal'), h('th', {}, 'Kategorie'), h('th', {}, 'Bearbeiter'), h('th', {}, 'Geöffnet')),
                list.map((t) => h('tr', {}, h('td', {}, t.number), h('td', {}, `#${t.channel ?? t.channelId}`), h('td', {}, t.type), h('td', {}, t.claimedBy ? '✅' : '—'), h('td', {}, fmtTime(t.openedAt)))),
              )
            : h('div', { class: 'empty' }, 'Keine offenen Tickets.'),
        ),
    },
  ],
});

// ---------- Moderation ----------

const WARN_ROLES = (path) => ({
  title: 'Warn-Rollen',
  desc: 'Der Bot hält die Rolle passend zur Anzahl aktiver Verwarnungen. Die Bot-Rolle muss über diesen Rollen stehen.',
  render: () => {
    const roles = getPath(state.draft, path);
    return h(
      'div',
      { class: 'card-body', style: 'padding:0' },
      [0, 1, 2, 3, 4].map((i) =>
        ui.field({ label: `Warn ${i + 1}` }, ui.role({ get: () => roles[i] ?? '', set: (v) => ((roles[i] = v), markDirty(path)) }, { empty: '— keine Rolle —' })),
      ),
    );
  },
});
const warnExpiry = (base) => [
  { t: 'toggle', p: `${base}.expire.enabled`, label: 'Verwarnungen laufen automatisch ab' },
  { t: 'number', p: `${base}.expire.days`, label: 'Standard-Ablauf nach (Tagen)', min: 1, max: 3650, help: 'Mit der Option <code>ablauf</code> beim Verwarnen je Verwarnung anders (0 = nie).' },
  { t: 'toggle', p: `${base}.dmOnExpire`, label: 'Mitglied per DM informieren, wenn eine Verwarnung abgelaufen ist' },
];

page({
  id: 'moderation',
  group: 'Moderation',
  title: 'Moderation',
  icon: '🛡️',
  requires: 'moderation',
  enabledPath: 'moderation.enabled',
  offText: 'Moderationsbefehle, Auto-Mod und Honeypot sind abgeschaltet.',
  desc: 'Berechtigungen, Verwarnungen, Meldungen, Honeypot und Auto-Mod.',
  sections: () => [
    {
      title: 'Berechtigungen',
      desc: 'Mitglieder mit diesen Rollen dürfen die Aktion ausführen. Admins und Mitglieder mit dem passenden Discord-Recht dürfen immer.',
      fields: [
        { t: 'roles', p: 'moderation.permissions.timeout', label: 'Timeout' },
        { t: 'roles', p: 'moderation.permissions.warn', label: 'Verwarnen' },
        { t: 'roles', p: 'moderation.permissions.kick', label: 'Kicken' },
        { t: 'roles', p: 'moderation.permissions.ban', label: 'Bannen' },
        { t: 'roles', p: 'moderation.permissions.viewLogs', label: 'Verwarnungen ansehen' },
      ],
    },
    {
      title: 'Allgemeines',
      fields: [
        { t: 'roles', p: 'moderation.ignoredRoles', label: 'Ignorierte Rollen', help: 'Können nicht bestraft werden.' },
        { t: 'toggle', p: 'moderation.dmOnAction', label: 'Nutzer bei Mod-Aktionen per DM benachrichtigen' },
        { t: 'toggle', p: 'moderation.logEnabled', label: 'Mod-Aktionen loggen' },
        { t: 'channel', p: 'channels.modLog', label: 'Mod-Log-Kanal' },
      ],
    },
    {
      title: 'Limit an Verwarnungen',
      fields: [
        { t: 'toggle', p: 'moderation.warnings.limit.enabled', label: 'Aktion ausführen, wenn ein Nutzer das Limit erreicht' },
        { t: 'number', p: 'moderation.warnings.limit.count', label: 'Anzahl aktiver Verwarnungen', min: 1, max: 50 },
        { t: 'select', p: 'moderation.warnings.limit.action', label: 'Aktion', options: [['ban', 'Bannen'], ['kick', 'Kicken'], ['timeout', 'Timeout']] },
        { t: 'number', p: 'moderation.warnings.limit.timeoutMinutes', label: 'Timeout-Dauer (Minuten)', min: 1, max: 40320 },
      ],
    },
    { title: 'Ablauf von Verwarnungen', fields: warnExpiry('moderation.warnings') },
    WARN_ROLES('moderation.warnings.roles'),
    {
      title: 'Öffentliche Verwarnung',
      desc: 'Postet jede Verwarnung zusätzlich in einen Kanal. Leer = aus.',
      fields: [{ t: 'channel', p: 'moderation.warnings.publicChannel', label: 'Kanal', empty: '— Nicht öffentlich posten —' }],
    },
    {
      title: 'Report-System',
      desc: 'Mitglieder melden andere mit <code>/melden</code>.',
      fields: [
        { t: 'toggle', p: 'moderation.report.enabled', label: 'Nutzer dürfen andere Nutzer melden' },
        { t: 'channel', p: 'moderation.report.channel', label: 'Kanal für Meldungen' },
        { t: 'roles', p: 'moderation.report.pingRoles', label: 'Bei Meldungen markieren' },
      ],
    },
    {
      title: 'Honeypot',
      desc: 'Köderkanal gegen Scam-Konten: Wer dort schreibt, wird automatisch entfernt. Teammitglieder, Besitzer und ignorierte Rollen sind ausgenommen.',
      fields: [
        { t: 'toggle', p: 'moderation.honeypot.enabled', label: 'Köderkanal aktivieren' },
        { t: 'channel', p: 'moderation.honeypot.channel', label: 'Köderkanal' },
        { t: 'select', p: 'moderation.honeypot.action', label: 'Aktion', options: [['kick', 'Kicken'], ['ban', 'Bannen'], ['timeout', 'Timeout (24 Std.)']] },
        { t: 'select', p: 'moderation.honeypot.deleteMessages', label: 'Nachrichten löschen', options: [['hour', 'Letzte Stunde (alle Kanäle)'], ['day', 'Letzte 24 Stunden'], ['none', 'Nur die Köder-Nachricht']] },
        { t: 'toggle', p: 'moderation.honeypot.dm', label: 'Nutzer vorher per DM informieren' },
        { t: 'text', p: 'moderation.honeypot.dmTitle', label: 'DM-Titel', placeholder: 'Du wurdest entfernt' },
        { t: 'textarea', p: 'moderation.honeypot.dmText', label: 'DM-Text', wide: true, help: 'Leer = Standardtext. <code>{user}</code> <code>{server}</code> <code>{action}</code> <code>{invite}</code>' },
        { t: 'toggle', p: 'moderation.honeypot.invite', label: 'Einmaligen Einladungslink in der Kick-Nachricht mitschicken' },
        { t: 'text', p: 'moderation.honeypot.warnTitle', label: 'Warn-Hinweis: Titel' },
        { t: 'textarea', p: 'moderation.honeypot.warnText', label: 'Warn-Hinweis: Text', wide: true },
      ],
      actions: () => h('button', { class: 'btn small', onclick: () => runAction('honeypot-notice', {}, 'Hinweis gepostet') }, 'Hinweis posten'),
    },
    {
      title: 'Auto-Mod-Regeln',
      desc: 'Admins, Mitglieder mit „Nachrichten verwalten“ und die ignorierten Rollen sind ausgenommen.',
      fields: [
        { t: 'roles', p: 'moderation.automod.ignoredRoles', label: 'Ignorierte Rollen (Whitelist)', wide: true },
        { t: 'toggle', p: 'moderation.automod.hoisting.enabled', label: 'Anti-Hoisting: Sonderzeichen am Namensanfang entfernen' },
        { t: 'toggle', p: 'moderation.automod.invites.enabled', label: 'Anti-Invite: Discord-Einladungen löschen' },
        { t: 'toggle', p: 'moderation.automod.links.enabled', label: 'Anti-Link: externe Links löschen' },
        { t: 'lines', p: 'moderation.automod.links.allowed', label: 'Erlaubte Domains', placeholder: 'tenor.com', help: 'Eine Domain pro Zeile.' },
        { t: 'toggle', p: 'moderation.automod.spam.enabled', label: 'Anti-Spam: Nachrichten-Flood löschen' },
        { t: 'number', p: 'moderation.automod.spam.messages', label: 'Nachrichten', min: 2, max: 50 },
        { t: 'number', p: 'moderation.automod.spam.seconds', label: 'in Sekunden', min: 1, max: 120 },
        { t: 'toggle', p: 'moderation.automod.caps.enabled', label: 'Anti-Caps' },
        { t: 'number', p: 'moderation.automod.caps.percent', label: 'Anteil Großbuchstaben (%)', min: 10, max: 100 },
        { t: 'number', p: 'moderation.automod.caps.minLength', label: 'Ab Buchstaben', min: 1, max: 200 },
        { t: 'toggle', p: 'moderation.automod.ping.enabled', label: 'Anti-Ping: Pings geschützter Rollen löschen' },
        { t: 'roles', p: 'moderation.automod.ping.roles', label: 'Geschützte Rollen', wide: true },
      ],
    },
  ],
});

// Laufbahn-Editor für den Rang-Aufstieg.
function careerTrackEditor(t, i) {
  const list = state.draft.team.careers.tracks;
  const b = (key) => bindItem('team.careers.tracks', t, key);
  const open = openItems.has(`track-${i}`);
  return listItem(
    {
      title: t.name,
      subtitle: [`@${roleName(t.baseRole) ?? '—'}`, ...t.stages.map((s) => `@${roleName(s.role) ?? '—'}`)].join(' → '),
      badges: [h('span', { class: 'badge' }, t.mode === 'approval' ? 'Freigabe' : 'Automatisch')],
      open,
      onToggle: toggleOpen(`track-${i}`),
      onRemove: () => confirm(`Laufbahn „${t.name}“ entfernen?`) && (list.splice(i, 1), markDirty('team.careers.tracks'), render()),
    },
    open && [
      ui.field({ label: 'Name' }, ui.text(b('name'), { max: 60 })),
      ui.field({ label: 'Hauptrolle (Basis-Rang)', help: 'Der unterste Rang. Hier starten alle.' }, ui.role(b('baseRole'), { empty: '— Rolle wählen —' })),
      ui.field({ label: 'Modus' }, ui.select(b('mode'), [['auto', 'Automatisch befördern'], ['approval', 'Zur Freigabe vorschlagen']])),
      ui.field({ label: 'Kanal für Vorschläge', help: 'Nur bei Freigabe. Leer = Log-Kanal der Teamverwaltung.' }, ui.channel(b('approvalChannel'), { empty: '— Log-Kanal —' })),
      ui.field({ label: 'Freigeben dürfen', wide: true, help: 'Admins dürfen immer.' }, ui.roles(b('approverRoles'))),
      h('h3', { class: 'field wide' }, 'Stufen (von unten nach oben)'),
      h(
        'div',
        { class: 'field wide' },
        t.stages.map((stage, k) => {
          const sb = (key) => bindItem('team.careers.tracks', stage, key);
          return h(
            'div',
            { class: 'item' },
            h(
              'div',
              { class: 'item-body', style: 'padding-top:14px' },
              ui.field({ label: `Stufe ${k + 1}` }, ui.role(sb('role'), { empty: '— Rolle wählen —' })),
              ui.field({ label: 'Mind. Tage im vorherigen Rang' }, ui.number(sb('minDays'), { max: 3650 })),
              ui.field({ label: 'Bearbeitete Tickets' }, ui.number(sb('tickets'), { max: 100000 })),
              ui.field({ label: 'Moderations-Aktionen' }, ui.number(sb('modActions'), { max: 100000 })),
              ui.field({}, h('button', { class: 'btn ghost small', onclick: () => (t.stages.splice(k, 1), markDirty('team.careers.tracks'), render()) }, 'Stufe entfernen')),
            ),
          );
        }),
        t.stages.length < 10 && h('button', { class: 'btn small', onclick: () => (t.stages.push({ role: '', minDays: 14, tickets: 10, modActions: 0 }), markDirty('team.careers.tracks'), render()) }, '+ Stufe hinzufügen'),
      ),
    ],
  );
}

// ---------- Teamverwaltung ----------

const TEAM_PERMS = [
  ['absence', 'Sich abwesend melden', '/abwesend und /zurueck'],
  ['warn', 'Team verwarnen', '/team verwarnen, verwarnungen, verwarnung-entfernen'],
  ['rank', 'Up-/Downrank', '/team rang'],
  ['calendarView', 'Kalender ansehen', '/meeting liste'],
  ['calendarCreate', 'Kalender-Einträge erstellen', 'Termine anlegen und absagen'],
  ['attendanceView', 'Anwesenheitsstatistik ansehen', 'Anwesenheit aller im Team-Kalender'],
];
page({
  id: 'team',
  group: 'Moderation',
  title: 'Teamverwaltung',
  icon: '👥',
  requires: 'team',
  enabledPath: 'team.enabled',
  offText: 'Die Team-Befehle antworten mit einem Hinweis, solange das Modul deaktiviert ist.',
  desc: 'Team & Rechte, Rang-Änderungen, Team-Verwarnungen, Live-Teamliste und Abwesenheit.',
  sections: () => [
    {
      title: 'Team & Rechte',
      desc: 'Wer eine dieser Rollen hat, zählt als Teammitglied und darf, was angehakt ist. Admins dürfen immer.',
      render: () => {
        const roles = state.draft.team.roles;
        let add = '';
        return h(
          'div',
          {},
          roles.length
            ? roles.map((r, i) =>
                h(
                  'div',
                  { class: 'item' },
                  h('div', { class: 'item-head' }, h('b', { class: 'grow' }, `@${roleName(r.id) ?? r.id}`), h('button', { class: 'btn ghost small', onclick: () => (roles.splice(i, 1), markDirty('team.roles'), render()) }, 'Entfernen')),
                  h(
                    'div',
                    { class: 'item-body' },
                    TEAM_PERMS.map(([perm, label, help]) =>
                      ui.field(
                        { help },
                        ui.toggle(
                          {
                            get: () => r.perms.includes(perm),
                            set: (v) => {
                              r.perms = v ? [...r.perms, perm] : r.perms.filter((p) => p !== perm);
                              markDirty('team.roles');
                            },
                          },
                          label,
                        ),
                      ),
                    ),
                  ),
                ),
              )
            : h('div', { class: 'empty' }, 'Noch keine Team-Rolle festgelegt.'),
          h(
            'div',
            { class: 'card-body', style: 'padding:16px 0 0' },
            ui.role({ get: () => add, set: (v) => (add = v) }, { empty: '— Rolle wählen —' }),
            h(
              'button',
              { class: 'btn', onclick: () => add && !roles.some((r) => r.id === add) && (roles.push({ id: add, perms: TEAM_PERMS.map(([p]) => p) }), markDirty('team.roles'), render()) },
              'Rolle zum Team hinzufügen',
            ),
          ),
        );
      },
    },
    {
      title: 'Benachrichtigung & Protokoll',
      fields: [
        { t: 'toggle', p: 'team.dmNotify', label: 'Mitglied per DM über Rang-Änderung oder Team-Verwarnung informieren' },
        { t: 'channel', p: 'team.logChannel', label: 'Log-Kanal', empty: '— Kein Log-Kanal —' },
      ],
    },
    {
      title: 'Team-Verwarnungen',
      fields: [
        { t: 'toggle', p: 'team.warnings.enabled', label: 'Team-Verwarnungen über /team verwarnen erlauben' },
        ...warnExpiry('team.warnings'),
        { t: 'channel', p: 'team.warnings.publicChannel', label: 'Öffentlich posten in', empty: '— Nicht öffentlich posten —' },
      ],
    },
    WARN_ROLES('team.warnings.roles'),
    {
      title: 'Rang-Änderungen (/team rang)',
      fields: [
        { t: 'toggle', p: 'team.rank.reasonRequired', label: 'Beim Befehl muss ein Grund angegeben werden' },
        { t: 'channel', p: 'team.rank.announceChannel', label: 'Öffentliche Rang-Ankündigung', empty: '— Nicht ankündigen —' },
        { t: 'text', p: 'team.rank.announceTitle', label: 'Titel', max: 200 },
        { t: 'textarea', p: 'team.rank.announceText', label: 'Text', wide: true, help: '<code>{user}</code> <code>{username}</code> <code>{oldrole}</code> <code>{newrole}</code> <code>{server}</code>' },
      ],
    },
    {
      title: 'Uprank-Angebot',
      desc: 'Upranks werden erst als Angebot gepostet; nur das Mitglied kann annehmen oder ablehnen. Rückstufungen sind nicht betroffen.',
      fields: [
        { t: 'toggle', p: 'team.rank.offer.enabled', label: 'Uprank nur nach Annehmen durch das Mitglied' },
        { t: 'channel', p: 'team.rank.offer.channel', label: 'Kanal für Angebote', empty: '— Kanal der Rang-Ankündigung —' },
        { t: 'number', p: 'team.rank.offer.hours', label: 'Frist (Stunden)', min: 1, max: 720 },
      ],
    },
    {
      title: 'Live-Teamliste',
      desc: 'Eine Nachricht, die automatisch aktuell gehalten wird: Mitglieder unter ihrer Rolle (🌴 = abwesend).',
      actions: () => h('button', { class: 'btn small', onclick: () => runAction('team-lists-update', {}, 'Listen werden aktualisiert') }, 'Jetzt aktualisieren'),
      fields: [
        { t: 'toggle', p: 'team.teamList.enabled', label: 'Live-Teamliste posten' },
        { t: 'channel', p: 'team.teamList.channel', label: 'Kanal' },
        { t: 'roles', p: 'team.teamList.roles', label: 'Rollen in der Teamliste (in dieser Reihenfolge)', wide: true },
      ],
    },
    {
      title: 'Abwesenheit',
      desc: 'Teammitglieder melden sich mit <code>/abwesend</code> ab und mit <code>/zurueck</code> zurück.',
      fields: [
        { t: 'toggle', p: 'team.absence.enabled', label: 'Abwesenheitsliste und /abwesend, /zurueck aktivieren' },
        { t: 'channel', p: 'team.absence.channel', label: 'Kanal für die Liste' },
        { t: 'role', p: 'team.absence.role', label: 'Rolle während der Abwesenheit' },
      ],
    },
    {
      title: 'Rang-Aufstieg',
      desc: 'Der Bot prüft alle 10 Minuten, wer die Voraussetzungen für den nächsten Rang einer Laufbahn erfüllt, und befördert automatisch oder schlägt die Beförderung zur Freigabe vor. Gezählt wird ab dem letzten Rangwechsel: bearbeitete (übernommene und geschlossene) Tickets, Moderations-Aktionen und Tage im Rang.',
      actions: () => h('button', { class: 'btn small', onclick: () => runAction('careers-check', {}, 'Geprüft').then(render) }, 'Jetzt prüfen'),
      fields: [
        { t: 'toggle', p: 'team.careers.enabled', label: 'Rang-Aufstieg aktivieren' },
        { t: 'toggle', p: 'team.careers.skipAbsent', label: 'Abwesende (Abwesenheitsliste) nicht befördern' },
        { t: 'toggle', p: 'team.careers.countExisting', label: 'Beim ersten Erfassen vorhandene Daten mitzählen', help: 'Gilt nur für Mitglieder, die der Bot zum ersten Mal in einer Laufbahn sieht. Sonst beginnt die Zählung mit der Aktivierung.' },
        { t: 'toggle', p: 'team.careers.dm', label: 'Befördertes Mitglied per DM informieren' },
      ],
    },
    {
      title: 'Laufbahnen',
      desc: 'Eine Laufbahn ist eine Abfolge fester Ränge: die Hauptrolle als Basis und darüber die Stufen.',
      actions: () =>
        h(
          'button',
          {
            class: 'btn primary small',
            onclick: () => {
              const list = state.draft.team.careers.tracks;
              if (list.length >= 4) return Dash.toast('Höchstens 4 Laufbahnen.', true);
              list.push({ id: `l${Date.now().toString(36)}`, name: 'Support', baseRole: '', mode: 'auto', approvalChannel: '', approverRoles: [], stages: [] });
              openItems.add(`track-${list.length - 1}`);
              markDirty('team.careers.tracks');
              render();
            },
          },
          `+ Laufbahn (${state.draft.team.careers.tracks.length}/4)`,
        ),
      render: () => (state.draft.team.careers.tracks.length ? h('div', {}, state.draft.team.careers.tracks.map(careerTrackEditor)) : h('div', { class: 'empty' }, 'Noch keine Laufbahn – lege die erste an.')),
    },
    {
      title: 'Öffentliche Ankündigung der Beförderungen',
      desc: 'Gehört nur zum Rang-Aufstieg. Unabhängig von der Rang-Ankündigung für <code>/team rang</code>.',
      fields: [
        { t: 'toggle', p: 'team.careers.announce.enabled', label: 'Beförderungen durch den Rang-Aufstieg öffentlich ankündigen' },
        { t: 'channel', p: 'team.careers.announce.channel', label: 'Kanal' },
        { t: 'text', p: 'team.careers.announce.title', label: 'Titel', max: 200 },
        { t: 'text', p: 'team.careers.announce.color', label: 'Farbe', max: 7 },
        { t: 'textarea', p: 'team.careers.announce.text', label: 'Text', wide: true, help: '<code>{user}</code> <code>{username}</code> <code>{oldrole}</code> <code>{newrole}</code> <code>{laufbahn}</code> <code>{server}</code>' },
        { t: 'toggle', p: 'team.careers.announce.ping', label: 'Befördertes Mitglied per Ping benachrichtigen' },
        { t: 'toggle', p: 'team.careers.announce.showStats', label: 'Geleistetes anzeigen (Tickets, Mod-Aktionen, Tage im Rang)' },
      ],
    },
    {
      title: 'Fortschritt',
      desc: 'Zahlen seit dem letzten Rangwechsel.',
      render: () =>
        liveBlock('careers', ({ progress }) =>
          progress.length
            ? h(
                'table',
                {},
                h('tr', {}, h('th', {}, 'Mitglied'), h('th', {}, 'Laufbahn'), h('th', {}, 'Rang'), h('th', {}, 'Nächster Rang'), h('th', {}, 'Fortschritt')),
                progress.map((p) =>
                  h(
                    'tr',
                    {},
                    h('td', {}, p.user),
                    h('td', {}, p.track),
                    h('td', {}, p.stage ?? '—'),
                    h('td', {}, p.next ?? 'höchste Stufe', p.pending && h('span', { class: 'badge yellow', style: 'margin-left:6px' }, 'Vorschlag offen')),
                    h('td', { class: 'small' }, p.checks.map((c) => `${c.label} ${c.have}/${c.need}`).join(' · ') || '—'),
                  ),
                ),
              )
            : h('div', { class: 'empty' }, state.draft.team.careers.enabled ? 'Noch niemand erfasst – „Jetzt prüfen“ klicken.' : 'Aktiviere den Rang-Aufstieg, um den Fortschritt zu sehen.'),
        ),
    },
    {
      title: 'Verlauf',
      desc: 'Die letzten 15 Beförderungen und Vorschläge.',
      render: () =>
        liveBlock('careers', ({ history }) =>
          history.length
            ? h(
                'table',
                {},
                h('tr', {}, h('th', {}, 'Zeit'), h('th', {}, 'Mitglied'), h('th', {}, 'Laufbahn'), h('th', {}, 'Art'), h('th', {}, 'Neuer Rang')),
                history.map((e) =>
                  h('tr', {}, h('td', {}, fmtTime(e.at)), h('td', {}, e.user), h('td', {}, e.track), h('td', {}, { auto: 'automatisch', approved: 'freigegeben', suggested: 'vorgeschlagen', denied: 'abgelehnt' }[e.mode] ?? e.mode), h('td', {}, e.to ? `@${roleName(e.to) ?? e.to}` : '—')),
                ),
              )
            : h('div', { class: 'empty' }, 'Noch keine Beförderungen oder Vorschläge.'),
        ),
    },
    {
      title: 'Meetings & Team-Kalender',
      desc: 'Termine mit Zu-/Absage und Erinnerung. Hat ein Meeting einen Sprachkanal, erfasst der Bot die Anwesenheit (zu Beginn, nach 10 Minuten und zur Hälfte). Wer Termine sehen oder anlegen darf, legst du oben unter „Team &amp; Rechte“ fest.',
      fields: [
        { t: 'toggle', p: 'team.meetings.enabled', label: 'Meetings und Team-Kalender aktivieren' },
        { t: 'channel', p: 'team.meetings.channel', label: 'Ankündigungskanal' },
        { t: 'number', p: 'team.meetings.reminderMinutes', label: 'Erinnerung vorher (Minuten, 0 = aus)', max: 1440 },
      ],
    },
    {
      title: 'Kalender',
      render: () => {
        const form = { title: '', date: '', time: '', duration: 60, description: '', roles: [], voiceChannelId: '' };
        const bind = (key) => ({ get: () => form[key], set: (v) => (form[key] = v) });
        const act = (name, body, msg) => runAction(name, body, msg).then(render);
        return h(
          'div',
          {},
          liveBlock('meetings', ({ list }) =>
            list.length
              ? h(
                  'table',
                  {},
                  h('tr', {}, h('th', {}, 'Termin'), h('th', {}, 'Beginn'), h('th', {}, 'Zusagen'), h('th', {}, 'Anwesend'), h('th', {})),
                  list.map((m) =>
                    h(
                      'tr',
                      {},
                      h('td', {}, m.cancelled ? h('s', {}, m.title) : m.title, m.voice && h('div', { class: 'muted small' }, `🔊 ${m.voice}`)),
                      h('td', {}, fmtTime(m.start), h('div', { class: 'muted small' }, `${m.duration} Min.`)),
                      h('td', {}, `✅ ${m.yes} · ❔ ${m.maybe} · ❌ ${m.no}`),
                      h('td', {}, m.voice ? m.present : '—'),
                      h('td', {}, !m.cancelled && m.start + m.duration * 60000 > Date.now() && h('button', { class: 'btn ghost small', onclick: () => confirm(`„${m.title}“ absagen?`) && act('meeting-cancel', { id: m.id }, 'Abgesagt') }, 'Absagen')),
                    ),
                  ),
                )
              : h('div', { class: 'empty' }, 'Noch keine Termine.'),
          ),
          h('h3', {}, 'Neuer Termin'),
          h(
            'div',
            { class: 'card-body', style: 'padding:0' },
            ui.field({ label: 'Titel' }, ui.text(bind('title'), { max: 150 })),
            ui.field({ label: `Datum (TT.MM.JJJJ)` }, ui.text(bind('date'), { placeholder: '31.12.2026', max: 10 })),
            ui.field({ label: `Uhrzeit (${state.draft.timezone})` }, h('input', { type: 'time', oninput: (e) => (form.time = e.target.value) })),
            ui.field({ label: 'Dauer (Minuten)' }, ui.number(bind('duration'), { min: 5, max: 1440 })),
            ui.field({ label: 'Sprachkanal (Anwesenheit)' }, ui.channel(bind('voiceChannelId'), { kind: 'voice', empty: '— Ohne —' })),
            ui.field({ label: 'Einladen' }, ui.roles(bind('roles'))),
            ui.field({ label: 'Beschreibung', wide: true }, ui.textarea(bind('description'), { max: 1000 })),
            ui.field({}, h('button', { class: 'btn primary', onclick: () => act('meeting-create', form, 'Meeting angelegt und angekündigt') }, 'Termin anlegen')),
          ),
        );
      },
    },
    {
      title: 'Anwesenheitsstatistik',
      desc: 'Letzte 90 Tage. „Anwesend“ zählt nur Meetings mit Sprachkanal.',
      render: () =>
        liveBlock('meetings', ({ stats }) =>
          stats.length
            ? h(
                'table',
                {},
                h('tr', {}, h('th', {}, 'Mitglied'), h('th', {}, 'Anwesend'), h('th', {}, 'Zusagen'), h('th', {}, 'Vielleicht'), h('th', {}, 'Absagen')),
                stats.sort((a, b) => b.present - a.present).map((s) => h('tr', {}, h('td', {}, s.user), h('td', {}, s.present), h('td', {}, s.yes), h('td', {}, s.maybe), h('td', {}, s.no))),
              )
            : h('div', { class: 'empty' }, 'Noch keine Daten.'),
        ),
    },
    {
      title: 'Aktuell abwesend',
      render: () =>
        liveBlock('absences', (list) =>
          list.length
            ? h(
                'table',
                {},
                h('tr', {}, h('th', {}, 'Mitglied'), h('th', {}, 'Bis'), h('th', {}, 'Grund'), h('th', {})),
                list.map((a) =>
                  h('tr', {}, h('td', {}, a.userId), h('td', {}, fmtTime(a.until)), h('td', {}, a.reason || '—'), h('td', {}, h('button', { class: 'btn ghost small', onclick: () => runAction('absence-end', { userId: a.userId }, 'Abwesenheit beendet').then(render) }, 'Beenden'))),
                ),
              )
            : h('div', { class: 'empty' }, 'Aktuell ist niemand abwesend.'),
        ),
    },
  ],
});

// ---------- Server-Sicherheit ----------

page({
  id: 'security',
  group: 'Moderation',
  title: 'Server-Sicherheit',
  icon: '🔒',
  requires: 'security',
  enabledPath: 'security.enabled',
  offText: 'Keine der folgenden Maßnahmen greift, solange das Modul deaktiviert ist.',
  desc: 'Verify-System, Scam-Bilder-Schutz, Mindest-Account-Alter und Anti-Raid-Meldungen.',
  sections: [
    {
      title: 'Verify-System',
      desc: 'Neue Mitglieder bekommen nach einem Klick die Verify-Rolle. Die eigentliche Kanal-Sperre richtest du über Discords Berechtigungen ein; der Bot vergibt nur die Rolle.',
      actions: () => h('button', { class: 'btn small', onclick: () => runAction('verify-post', {}, 'Verify-Nachricht gepostet') }, 'Nachricht posten'),
      fields: [
        { t: 'toggle', p: 'security.verify.enabled', label: 'Verify-System aktivieren' },
        { t: 'channel', p: 'security.verify.channel', label: 'Verify-Kanal' },
        { t: 'role', p: 'security.verify.role', label: 'Rolle nach dem Verifizieren' },
        { t: 'role', p: 'security.verify.removeRole', label: 'Rolle entfernen (optional)', empty: '— Keine —', help: 'z. B. „Unverifiziert“' },
        { t: 'text', p: 'security.verify.title', label: 'Titel', max: 200 },
        { t: 'text', p: 'security.verify.button', label: 'Button-Text', max: 80 },
        { t: 'textarea', p: 'security.verify.text', label: 'Text', wide: true, max: 2000 },
      ],
    },
    {
      title: 'Scam-Bilder-Schutz',
      desc: 'Erkennt bekannte Betrugsbilder (z. B. gefälschte Casino-/Krypto-„Werbung“) per Bild-Vergleich und entfernt sie – gemeldete und selbst erkannte, wenn dasselbe Bild kurz hintereinander von mehreren Mitgliedern gepostet wird. Melden per Rechtsklick auf die Nachricht → Apps → „Als Scam-Bild melden“. Admins und „Nachrichten verwalten“ sind ausgenommen. Unterstützt PNG, JPEG, GIF, BMP und TIFF.',
      fields: [
        { t: 'toggle', p: 'security.scamImages.enabled', label: 'Bekannte Scam-Bilder automatisch erkennen' },
        { t: 'select', p: 'security.scamImages.action', label: 'Aktion', options: [['delete', 'Nur löschen'], ['timeout', 'Löschen + Timeout'], ['kick', 'Löschen + Kicken'], ['ban', 'Bannen']] },
        { t: 'number', p: 'security.scamImages.timeoutMinutes', label: 'Timeout-Dauer (Minuten)', min: 1, max: 40320 },
        { t: 'number', p: 'security.scamImages.threshold', label: 'Toleranz (0–16)', min: 0, max: 16, help: 'Wie stark sich ein Bild unterscheiden darf und trotzdem als gleich gilt. 6 ist ein guter Wert; höher = mehr Treffer, aber mehr Fehlalarme.' },
        { t: 'toggle', p: 'security.scamImages.autoDetect.enabled', label: 'Selbst erkennen: gleiches Bild von mehreren Mitgliedern in kurzer Zeit' },
        { t: 'number', p: 'security.scamImages.autoDetect.members', label: 'Ab Mitgliedern', min: 2, max: 50 },
        { t: 'number', p: 'security.scamImages.autoDetect.minutes', label: 'innerhalb von Minuten', min: 1, max: 1440 },
      ],
    },
    {
      title: 'Bekannte Scam-Bilder',
      render: () =>
        liveBlock('scam-images', (list) =>
          list.length
            ? h(
                'table',
                {},
                h('tr', {}, h('th', {}, 'Bild-Hash'), h('th', {}, 'Quelle'), h('th', {}, 'Hinzugefügt'), h('th', {}, 'Treffer'), h('th', {})),
                list.map((k) =>
                  h(
                    'tr',
                    {},
                    h('td', {}, h('code', {}, k.hash), k.name && h('div', { class: 'muted small' }, k.name)),
                    h('td', {}, k.source === 'auto' ? 'automatisch' : `gemeldet${k.addedByName ? ` von ${k.addedByName}` : ''}`),
                    h('td', {}, fmtTime(k.addedAt)),
                    h('td', {}, k.hits),
                    h('td', {}, h('button', { class: 'btn ghost small', onclick: () => confirm('Aus der Liste entfernen?') && runAction('scam-image-remove', { hash: k.hash }, 'Entfernt').then(render) }, 'Entfernen')),
                  ),
                ),
              )
            : h('div', { class: 'empty' }, 'Noch keine Scam-Bilder bekannt.'),
        ),
    },
    {
      title: 'Mindest-Account-Alter',
      desc: 'Sehr neue Discord-Accounts beim Beitritt automatisch behandeln – gegen Raid- und Wegwerf-Accounts.',
      fields: [
        { t: 'toggle', p: 'security.accountAge.enabled', label: 'Mindest-Account-Alter prüfen' },
        { t: 'number', p: 'security.accountAge.minDays', label: 'Mindestalter (Tage)', min: 1, max: 365 },
        { t: 'select', p: 'security.accountAge.action', label: 'Aktion', options: [['kick', 'Kicken'], ['timeout', 'Timeout bis zum Mindestalter (max. 28 Tage)'], ['log', 'Nur melden']] },
        { t: 'toggle', p: 'security.accountAge.dm', label: 'Betroffene per DM informieren' },
      ],
    },
    {
      title: 'Anti-Raid',
      desc: 'Viele Beitritte in kurzer Zeit lösen eine Meldung aus – bewusst nur ein Alarm, kein automatischer Massen-Kick.',
      fields: [
        { t: 'toggle', p: 'security.antiRaid.enabled', label: 'Ungewöhnlich viele Beitritte erkennen' },
        { t: 'number', p: 'security.antiRaid.joins', label: 'Beitritte', min: 3, max: 500 },
        { t: 'number', p: 'security.antiRaid.seconds', label: 'in Sekunden', min: 5, max: 3600 },
        { t: 'roles', p: 'security.antiRaid.pingRoles', label: 'Bei Alarm markieren' },
      ],
    },
    {
      title: 'Log-Kanal',
      desc: 'Verifizierungen, neue Accounts und Raid-Alarm. Leer = Mod-Log.',
      fields: [{ t: 'channel', p: 'security.logChannel', label: 'Log-Kanal', empty: '— Mod-Log verwenden —' }],
    },
  ],
});
})();
