// Tests für das Bewerbungssystem ohne Discord-Login (Teil von npm run check).
// Nutzt nachgebaute Interaktionen, um den Editor (/bewerbungsart) durchzuspielen.
const { Collection } = require('discord.js');

module.exports = function checkApplications(fail) {
  const settings = require('../src/lib/settings');
  const store = require('../src/lib/applications/store');
  const admin = require('../src/lib/applications/admin');
  const templates = require('../src/lib/applications/templates');
  const { validateType } = require('../src/lib/applications/forms');
  const { suggestions } = require('../src/lib/applications/autocomplete');
  const { buildPanel, buildTeamMessage } = require('../src/lib/applications/messages');
  const editor = require('../src/commands/applications/editor');
  const panelCommand = require('../src/commands/applications/bewerbungspanel');

  const G = 'appcheck';
  const expect = (condition, message) => {
    if (!condition) fail(`Bewerbungen: ${message}`);
  };
  const expectError = (fn, pattern, message) => {
    try {
      fn();
      fail(`Bewerbungen: ${message} (kein Fehler)`);
    } catch (err) {
      if (!(err instanceof admin.EditError) || (pattern && !pattern.test(err.message))) fail(`Bewerbungen: ${message} (${err.message})`);
    }
  };
  // Discord-Builder prüfen ihre Limits erst bei toJSON() – alle Teile einmal bauen.
  const build = (payload, what) => {
    try {
      for (const e of payload.embeds ?? []) e.toJSON();
      for (const c of payload.components ?? []) c.toJSON();
      if (payload.toJSON) payload.toJSON();
    } catch (err) {
      fail(`Bewerbungen: ${what} lässt sich nicht bauen: ${err.message}`);
    }
  };

  // ---------- Vorlagen ----------
  const panels = Object.keys(settings.base.applications.panels);
  for (const [id] of Object.entries(templates.TEMPLATES)) {
    const type = { ...settings.base.applications.defaults, ...templates.build(id), id: `t-${id}`.slice(0, 24), numberPrefix: templates.build(id).numberPrefix || 'X', panel: panels[0] };
    for (const problem of validateType(type, { panels })) fail(`Vorlage ${id}: ${problem}`);
  }
  expect(templates.choices().length <= 25, 'höchstens 25 Vorlagen (Discord-Limit für Auswahlen)');

  // ---------- Panels ----------
  admin.createPanel(G, { id: 'fraktionen', title: '🚓 Fraktionen' });
  expectError(() => admin.createPanel(G, { id: 'fraktionen' }), /gibt es schon/, 'doppeltes Panel wird abgelehnt');
  expectError(() => admin.createPanel(G, { id: 'A B' }), /Panel-ID/, 'ungültige Panel-ID wird abgelehnt');
  admin.updatePanel(G, 'fraktionen', (p) => ({ ...p, description: 'Wähle deine Fraktion', channel: '999' }));
  expectError(() => admin.updatePanel(G, 'fraktionen', (p) => ({ ...p, image: 'kein-link' })), /URL/, 'Bild ohne URL wird abgelehnt');

  // ---------- Bewerbungsarten anlegen ----------
  const fw = admin.createType(G, { id: 'Feuerwehr', name: 'Feuerwehr', template: 'feuerwehr', panel: 'fraktionen' });
  expect(fw.id === 'feuerwehr' && fw.numberPrefix === 'FW' && fw.stages.length === 3 && fw.panel === 'fraktionen', 'Vorlage Feuerwehr wird übernommen');
  expect(fw.roles.managers.length === 0 && fw.channels.open === '', 'Vorlagen bringen keine Rollen oder Kanäle mit');
  expectError(() => admin.createType(G, { id: 'feuerwehr', template: 'leer' }), /gibt es schon/, 'doppelte ID wird abgelehnt');
  expectError(() => admin.createType(G, { id: 'x', template: 'leer' }), /ID/, 'zu kurze ID wird abgelehnt');
  expectError(() => admin.createType(G, { id: 'neu1', template: 'leer', prefix: 'a-b' }), /Präfix/, 'ungültiges Präfix wird abgelehnt');

  const sup = admin.createType(G, { id: 'supporter', template: 'supporter', prefix: 'sup' });
  expect(sup.numberPrefix === 'SUP' && sup.panel === settings.base.applications.defaults.panel, 'Präfix wird großgeschrieben, Standard-Panel aus defaults');
  const copy = admin.createType(G, { id: 'feuerwehr2', copyFrom: 'feuerwehr', name: 'Feuerwehr Nord' });
  expect(copy.name === 'Feuerwehr Nord' && copy.questions.length === fw.questions.length && copy.numberPrefix !== 'FW', 'Kopie übernimmt Fragen, bekommt eigenes Präfix');
  const blank = admin.createType(G, { id: 'eigene', template: 'leer' });
  expect(blank.numberPrefix === 'EIG', `Präfix aus der ID abgeleitet (${blank.numberPrefix})`);
  expect(!settings.base.applications.types.some((t) => t.id === 'feuerwehr'), 'Vorlage config.json bleibt unverändert');
  expect(!store.typeById('anderer-server', 'feuerwehr'), 'Neue Arten gelten nur für ihren Server');

  // ---------- Prüfschritte ----------
  const stages = admin.stagesFromLines('In Prüfung\nProbedienst\nGespräch', fw.stages);
  expect(stages[0].id === 'SCREENING' && stages[2].id === 'INTERVIEW' && stages[1].id === 'S_PROBEDIENST', 'bestehende Prüfschritte behalten ihre ID');
  expect(admin.stagesFromLines('A\nA')[0].id !== admin.stagesFromLines('A\nA')[1].id, 'gleich benannte Prüfschritte bekommen eigene IDs');
  expectError(() => admin.stagesFromLines(Array.from({ length: 11 }, (_, i) => `S${i}`).join('\n')), /10/, 'mehr als 10 Prüfschritte werden abgelehnt');

  // ---------- Status ----------
  const record = store.createRecord(G, store.typeById(G, 'feuerwehr'), { userId: 'u1', userTag: 'u1', answers: [] });
  expect(record.number === 'FW-0001' && record.status === 'SUBMITTED', `Nummer mit eigenem Präfix (${record.number})`);
  const fwType = store.typeById(G, 'feuerwehr');
  expect(store.nextStatuses(record, fwType).join() === 'SCREENING,INTERVIEW,PENDING_DECISION,WITHDRAWN', 'Status-Menü zeigt die Prüfschritte der Art');
  expect(store.nextStatuses(record, store.typeById(G, 'eigene')).join() === 'WITHDRAWN', 'ohne Prüfschritte nur Zurückziehen');
  store.setStatus(record, 'INTERVIEW', 'm1');
  expect(store.statusLabel('INTERVIEW', fwType) === 'Gespräch' && store.statusLabel('SUBMITTED', fwType) === 'Eingereicht', 'Statusnamen');
  build(buildTeamMessage(record, fwType), 'Team-Nachricht');
  store.bansOf(G)['B-0001'] = { id: 'B-0001', discordId: 'u9', scopes: ['feuerwehr'], reason: 'Test', createdAt: Date.now() };

  // ---------- ID ändern ----------
  admin.updateType(G, 'feuerwehr', (t) => {
    t.id = 'fw';
  });
  expect(store.getRecord(G, 'FW-0001').type === 'fw', 'Bewerbungen ziehen bei ID-Änderung mit');
  expect(store.bansOf(G)['B-0001'].scopes[0] === 'fw', 'Sperren ziehen bei ID-Änderung mit');
  expect(store.activeBan(G, 'fw', { discordId: 'u9' }), 'Sperre greift nach ID-Änderung');
  expectError(() => admin.updateType(G, 'fw', (t) => void (t.id = 'supporter')), /gibt es schon/, 'ID einer anderen Art wird abgelehnt');

  // ---------- Löschen ----------
  expectError(() => admin.deleteType(G, 'fw'), /offene Bewerbung/, 'Art mit offenen Bewerbungen kann nicht gelöscht werden');
  admin.deleteType(G, 'feuerwehr2');
  expect(!store.typeById(G, 'feuerwehr2'), 'Art wird gelöscht');
  expectError(() => admin.deletePanel(G, 'fraktionen'), /verschieben_nach/, 'Panel mit Arten braucht ein Ziel');
  admin.deletePanel(G, 'fraktionen', panels[0]);
  expect(store.typeById(G, 'fw').panel === panels[0], 'Arten werden beim Löschen des Panels verschoben');
  admin.createPanel(G, { id: 'fraktionen', title: '🚓 Fraktionen' });
  admin.updateType(G, 'fw', (t) => void (t.panel = 'fraktionen'));

  // ---------- Gespeicherte Werte nach einem „Neustart“ ----------
  settings.set(G, 'applications.types.fw.enabled', false); // /einstellungen bewerbung nach dem Editor
  admin.updateType(G, 'supporter', (t) => void (t.cooldownMinutes = 5));
  settings.set(G, 'applications.types.fw.cooldownMinutes', 77);
  settings.reload(G);
  const reloaded = store.typeById(G, 'fw');
  expect(reloaded && reloaded.enabled === false && reloaded.cooldownMinutes === 77, 'Einstellungen bleiben nach einem Neustart in der richtigen Reihenfolge');
  expect(store.typeById(G, 'supporter').cooldownMinutes === 5 && store.typeById(G, 'eigene'), 'Editor-Änderungen bleiben nach einem Neustart erhalten');
  settings.reset(G, { keep: ['applications'] });
  expect(store.typeById(G, 'fw'), '/einstellungen zuruecksetzen behält Bewerbungsarten');

  // ---------- Autovervollständigung ----------
  expect(suggestions(G, 'art', 'feuer').some((s) => s.value === 'fw'), 'Autovervollständigung findet eigene Arten');
  expect(suggestions(G, 'bereich', '')[0].value === '*', 'Sperr-Bereich bietet „Alle“ an');
  expect(suggestions(G, 'panel', 'frak').some((s) => s.value === 'fraktionen'), 'Autovervollständigung findet Panels');

  // ---------- Panels und Editor-Ansichten bauen ----------
  build(buildPanel(G, 'fraktionen'), 'Panel mit einer Art');
  admin.createType(G, { id: 'rettung', template: 'rettungsdienst', panel: 'fraktionen', emoji: '' });
  build(buildPanel(G, 'fraktionen'), 'Panel mit mehreren Arten (eine ohne Emoji)');
  build(buildPanel(G, 'gibtsnicht'), 'gelöschtes Panel');
  build(panelCommand.panelModal('fraktionen', settings.forGuild(G).applications.panels.fraktionen), 'Panel-Formular');
  for (const type of store.types(G)) {
    build(editor.views.homeView(G, type, 'Hinweis'), `Editor ${type.id}`);
    build(editor.views.questionsView(type), `Fragenliste ${type.id}`);
    for (const q of type.questions) {
      build(editor.views.questionView(type, q.key), `Frage ${type.id}/${q.key}`);
      build(editor.modals.questionModal(type, q.type, q), `Frage-Formular ${type.id}/${q.key}`);
    }
    build(editor.views.deleteView(G, type), `Löschen ${type.id}`);
    for (const modal of ['basicModal', 'textsModal', 'flowModal']) build(editor.modals[modal](type), `${modal} ${type.id}`);
    build(editor.modals.channelsModal(G, type), `channelsModal ${type.id}`);
    for (const group of ['zugang', 'entscheidung', 'team']) build(editor.modals.rolesModal(type, group), `Rollen-Formular ${group}`);
  }
  build(editor.views.newQuestionView(store.typeById(G, 'fw')), 'Fragetyp-Auswahl');
  for (const kind of ['TEXT', 'CHOICE', 'ROLE', 'ROBLOX']) build(editor.modals.questionModal(store.typeById(G, 'fw'), kind), `neues ${kind}-Formular`);
  build(editor.views.listView(G), 'Liste');

  // ---------- Editor mit nachgebauten Interaktionen ----------
  const run = async () => {
    let shown = null;
    const fake = (fields = {}, extra = {}) => ({
      guildId: G,
      guild: { id: G, channels: { cache: new Map() } },
      memberPermissions: { has: () => true },
      replied: false,
      deferred: false,
      update: async (payload) => {
        shown = payload;
      },
      showModal: async (modal) => {
        shown = modal;
      },
      reply: async (payload) => {
        shown = payload;
      },
      followUp: async (payload) => {
        shown = payload;
      },
      fields: {
        getTextInputValue: (id) => fields[id] ?? '',
        getStringSelectValues: (id) => (fields[id] !== undefined ? [fields[id]] : []),
        getSelectedRoles: (id) => new Collection((fields[id] ?? []).map((r) => [r.id, r])),
        getSelectedChannels: (id) => new Collection((fields[id] ? [fields[id]] : []).map((c) => [c.id, c])),
      },
      ...extra,
    });
    const click = (args, fields, extra) => editor.components.appedit(fake(fields, extra), args);

    await click(['qsave', 'fw', 'new', 'CHOICE'], { label: 'Welche Schicht?', description: '', required: 'ja', options: 'Früh\nSpät | ab 14 Uhr\nNacht', multiple: 'ja' });
    const choiceQ = store.typeById(G, 'fw').questions.at(-1);
    expect(choiceQ?.key === 'welche_schicht' && choiceQ.options.length === 3 && choiceQ.options[1].description === 'ab 14 Uhr' && choiceQ.multiple, 'Auswahlfrage im Editor anlegen');

    await click(['qsave', 'fw', 'new', 'ROLE'], { label: 'Welche Wache?', required: 'nein', roles: [{ id: 'r1', name: 'Wache 1' }, { id: 'r2', name: 'Wache 2' }], multiple: 'nein' });
    const roleQ = store.typeById(G, 'fw').questions.at(-1);
    expect(roleQ?.type === 'ROLE' && roleQ.options[1].roleId === 'r2' && roleQ.required === false, 'Rollenfrage im Editor anlegen');

    await click(['qsave', 'fw', 'welche_schicht', 'CHOICE'], { label: 'Welche Schicht passt dir?', required: 'ja', options: 'Früh\nSpät', multiple: 'nein' });
    const edited = store.typeById(G, 'fw').questions.find((q) => q.key === 'welche_schicht');
    expect(edited?.label === 'Welche Schicht passt dir?' && edited.options.length === 2, 'Frage im Editor bearbeiten');

    const before = store.typeById(G, 'fw').questions.map((q) => q.key);
    await click(['qmove', 'fw', 'welche_schicht', 'up']);
    const after = store.typeById(G, 'fw').questions.map((q) => q.key);
    expect(after.indexOf('welche_schicht') === before.indexOf('welche_schicht') - 1, 'Frage nach oben verschieben');
    await click(['qdel', 'fw', 'welche_wache']);
    expect(!store.typeById(G, 'fw').questions.some((q) => q.key === 'welche_wache'), 'Frage löschen');

    await click(['qsave', 'fw', 'new', 'TEXT'], { label: 'Kaputt', required: 'ja', min: '50', max: '10' });
    expect(!store.typeById(G, 'fw').questions.some((q) => q.label === 'Kaputt') && /min ist größer/.test(shown?.content ?? ''), 'Fehler im Formular werden gemeldet und nichts gespeichert');

    await click(['flowsave', 'fw'], { stages: 'In Prüfung\nPraxistest', cooldown: '60', timeLimit: '30', onLeave: 'DENY', threads: 'ja' });
    const flowType = store.typeById(G, 'fw');
    expect(flowType.stages.map((s) => s.label).join() === 'In Prüfung,Praxistest' && flowType.cooldownMinutes === 60 && flowType.onLeave === 'DENY' && flowType.teamThreads, 'Ablauf speichern');

    await click(['rolessave', 'fw', 'team'], { managers: [{ id: 'm1' }], ping: [{ id: 'p1' }, { id: 'p2' }] });
    expect(store.typeById(G, 'fw').roles.managers.join() === 'm1' && store.typeById(G, 'fw').roles.ping.length === 2 && store.typeById(G, 'fw').roles.pending.length === 0, 'Rollen speichern');

    await click(['channelssave', 'fw'], { panel: panels[0], open: { id: 'c1' } });
    expect(store.typeById(G, 'fw').channels.open === 'c1' && store.typeById(G, 'fw').panel === panels[0], 'Kanäle und Panel speichern');

    await click(['basicsave', 'fw'], { name: 'Berufsfeuerwehr', id: 'bf', prefix: 'bf', emoji: '🚒', description: 'Neu' });
    expect(store.typeById(G, 'bf')?.numberPrefix === 'BF' && store.getRecord(G, 'FW-0001').type === 'bf', 'Name, ID und Präfix im Editor ändern');
    await click(['basicsave', 'bf'], { name: 'X', id: 'bf', prefix: 'BF', emoji: 'kein emoji', description: '' });
    expect(store.typeById(G, 'bf').emoji === '🚒' && /Emoji/.test(shown?.content ?? ''), 'ungültiges Emoji wird abgelehnt');

    await click(['toggle', 'bf']);
    expect(store.typeById(G, 'bf').enabled === true, 'Öffnen/Schließen');

    const denied = fake({}, { memberPermissions: { has: () => false } });
    await editor.components.appedit(denied, ['toggle', 'bf']);
    expect(store.typeById(G, 'bf').enabled === true && /Server verwalten/.test(shown?.content ?? ''), 'Editor nur mit „Server verwalten“');
  };
  return run();
};
