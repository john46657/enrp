// Tests für das Web-Dashboard ohne Discord (Teil von npm run check): echter HTTP-Server auf einem freien Port,
// nachgebauter Discord-Server, signierte Sitzung.
const { ChannelType, Collection, PermissionFlagsBits } = require('discord.js');
const { createServer, readConfig } = require('../src/dashboard/server');
const { sign, verify } = require('../src/dashboard/auth');

const SECRET = 'x'.repeat(40);

// Nachgebauter Discord-Server mit Rollen, Kanälen und zwei Mitgliedern (Admin, normales Mitglied).
function fakeClient() {
  const guildId = 'dash-guild';
  const roles = new Collection([
    ['r-team', { id: 'r-team', name: 'Team', hexColor: '#ff0000', position: 5, managed: false }],
    ['r-fw', { id: 'r-fw', name: 'Feuerwehr', hexColor: '#00ff00', position: 3, managed: false }],
    [guildId, { id: guildId, name: '@everyone', hexColor: '#000000', position: 0, managed: false }],
  ]);
  const sent = [];
  const channel = (id, name) => ({
    id,
    name,
    type: ChannelType.GuildText,
    rawPosition: 1,
    permissionsFor: () => ({ has: () => true }),
    isTextBased: () => true,
    send: async (payload) => {
      sent.push(payload);
      return { id: `msg-${sent.length}`, url: `https://discord.com/channels/${guildId}/${id}/msg-${sent.length}` };
    },
    messages: { fetch: async () => null, delete: async () => {} },
  });
  const channels = new Collection([
    ['c-team', channel('c-team', 'bewerbungen')],
    ['c-panel', channel('c-panel', 'bewerben')],
  ]);
  const member = (id, admin) => ({
    id,
    roles: { cache: { has: () => false } },
    permissions: { has: (perm) => admin && perm === PermissionFlagsBits.ManageGuild },
  });
  const members = { admin: member('admin', true), user: member('user', false) };
  const guild = {
    id: guildId,
    name: 'Testserver',
    iconURL: () => null,
    roles: { cache: roles },
    channels: { cache: channels, fetch: async (id) => channels.get(id) ?? null },
    members: { me: { roles: { highest: { position: 10 } } }, fetch: async (id) => members[id] ?? Promise.reject(new Error('unbekannt')) },
  };
  for (const m of Object.values(members)) m.guild = guild;
  for (const c of channels.values()) c.guild = guild;
  const client = { guilds: { cache: new Collection([[guildId, guild]]) }, users: { fetch: async (id) => ({ id, toString: () => `<@${id}>`, send: async () => {} }) } };
  guild.client = client;
  return { client, guild, sent };
}

module.exports = async function checkDashboard(fail) {
  const expect = (condition, message) => {
    if (!condition) fail(`Dashboard: ${message}`);
  };

  // Konfiguration
  expect(readConfig({}).missing.length === 5, 'ohne .env-Werte bleibt das Dashboard aus');
  expect(readConfig({ DASHBOARD_PORT: '3000', DASHBOARD_URL: 'https://x.de', DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: 's', DASHBOARD_SECRET: SECRET }).missing.length === 0, 'vollständige .env wird erkannt');
  expect(readConfig({ DASHBOARD_SECRET: 'kurz' }).missing.some((m) => m.startsWith('DASHBOARD_SECRET')), 'zu kurzes Secret wird abgelehnt');

  // Sitzungen
  const token = sign(SECRET, { id: 'admin', name: 'Admin', exp: Date.now() + 60_000 });
  expect(verify(SECRET, token)?.id === 'admin', 'Sitzung wird erkannt');
  expect(verify('y'.repeat(40), token) === null, 'falsche Signatur wird abgelehnt');
  expect(verify(SECRET, sign(SECRET, { id: 'a', exp: Date.now() - 1 })) === null, 'abgelaufene Sitzung wird abgelehnt');
  expect(verify(SECRET, `${token.split('.')[0]}x.${token.split('.')[1]}`) === null, 'veränderte Sitzung wird abgelehnt');

  const { client, guild, sent } = fakeClient();
  const server = createServer(client, { baseUrl: 'http://localhost', clientId: '1', clientSecret: 's', secret: SECRET });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookieFor = (id) => `enrp_session=${encodeURIComponent(sign(SECRET, { id, name: id, exp: Date.now() + 60_000 }))}`;
  const call = async (method, path, body, { user = 'admin', header = true } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user ? { Cookie: cookieFor(user) } : {}), ...(header ? { 'X-Enrp': '1' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* kein JSON */
    }
    return { status: response.status, json, text, headers: response.headers };
  };
  const G = guild.id;

  try {
    // Seiten und Anmeldung
    const index = await call('GET', '/', undefined, { user: null });
    expect(index.status === 200 && index.text.includes('app.js') && index.headers.get('content-security-policy'), 'Startseite mit CSP');
    expect((await call('GET', '/../package.json', undefined, { user: null })).status === 404, 'kein Zugriff außerhalb des public-Ordners');
    const login = await call('GET', '/login', undefined, { user: null });
    expect(login.status === 302 && login.headers.get('location').startsWith('https://discord.com/oauth2/authorize') && /enrp_state=/.test(login.headers.get('set-cookie')), 'Login leitet zu Discord weiter');
    expect((await call('GET', '/auth/callback?code=x&state=falsch', undefined, { user: null })).status === 400, 'Login mit falschem state wird abgelehnt');
    expect((await call('GET', '/api/me', undefined, { user: null })).status === 401, 'API ohne Anmeldung gesperrt');
    expect((await call('POST', `/api/guilds/${G}/panels`, { id: 'x1' }, { header: false })).status === 403, 'Änderungen ohne CSRF-Header gesperrt');

    // Rechte
    const me = await call('GET', '/api/me');
    expect(me.json?.guilds?.length === 1 && me.json.guilds[0].isAdmin, 'Admin sieht seinen Server');
    expect((await call('GET', '/api/me', undefined, { user: 'user' })).json?.guilds?.length === 0, 'Mitglied ohne Rechte sieht keinen Server');
    expect((await call('GET', `/api/guilds/${G}`, undefined, { user: 'user' })).status === 403, 'Mitglied ohne Rechte wird abgewiesen');

    const meta = await call('GET', `/api/guilds/${G}`);
    expect(meta.json?.roles?.length === 2 && meta.json.channels.length === 2 && meta.json.types.length >= 1, 'Server-Daten mit Rollen, Kanälen, Arten');

    // Panel + Art anlegen und komplett bearbeiten
    expect((await call('POST', `/api/guilds/${G}/panels`, { id: 'fraktionen', title: 'Fraktionen' })).status === 200, 'Panel anlegen');
    const panelPut = await call('PUT', `/api/guilds/${G}/panels/fraktionen`, { channel: 'c-team', description: 'Text', showList: false });
    expect(panelPut.json?.fraktionen?.channel === 'c-team', 'Panel bearbeiten');
    const created = await call('POST', `/api/guilds/${G}/types`, { id: 'feuerwehr', template: 'feuerwehr', panel: 'fraktionen' });
    expect(created.json?.id === 'feuerwehr' && created.json.effectiveChannel === 'c-team', 'Art aus Vorlage anlegen (Kanal vom Panel)');

    const type = created.json;
    const put = await call('PUT', `/api/guilds/${G}/types/feuerwehr`, {
      ...type,
      id: 'fw',
      numberPrefix: 'fw',
      stages: ['In Prüfung', 'Praxistest'],
      roles: { ...type.roles, managers: ['r-team', 'gibt-es-nicht'], acceptAdd: ['r-fw'] },
      channels: { open: 'c-team', accepted: 'unbekannt', rejected: '' },
      questions: [...type.questions.slice(0, 2), { type: 'ROLE', label: 'Welche Wache?', required: true, options: [{ roleId: 'r-fw' }, { roleId: 'falsch' }] }, { type: 'CHOICE', label: 'Schicht?', options: [{ label: 'Früh' }, { label: 'Spät' }], multiple: true }],
    });
    const fw = put.json;
    expect(put.status === 200 && fw.id === 'fw' && fw.numberPrefix === 'FW', `Art bearbeiten mit neuer ID (${put.json?.error ?? ''})`);
    expect(fw?.roles.managers.join() === 'r-team' && fw.channels.accepted === '', 'unbekannte Rollen/Kanäle werden verworfen');
    expect(fw?.questions.length === 4 && fw.questions[2].options.length === 1 && fw.questions[2].options[0].label === 'Feuerwehr', 'Rollenfrage bekommt Rollennamen');
    expect(fw?.stages.map((s) => s.id).join() === 'SCREENING,S_PRAXISTEST', 'Prüfschritte behalten bekannte IDs');

    const invalid = await call('PUT', `/api/guilds/${G}/types/fw`, { questions: [{ type: 'TEXT', label: 'x', min: 50, max: 10 }] });
    expect(invalid.status === 400 && /min ist größer/.test(invalid.json?.error), 'ungültige Fragen werden mit Meldung abgelehnt');
    expect((await call('PUT', `/api/guilds/${G}/types/fw`, { questions: [{ type: 'HACK', label: 'x' }] })).status === 400, 'unbekannter Fragetyp wird abgelehnt');
    expect((await call('PUT', `/api/guilds/${G}/types/fw`, { name: 'Neu' }, { user: 'user' })).status === 403, 'Mitglied ohne Rechte kann nichts ändern');

    // Panel posten
    const posted = await call('POST', `/api/guilds/${G}/panels/fraktionen/post`, { channelId: 'c-panel' });
    expect(posted.status === 200 && sent.length === 1, 'Panel posten');

    // Bewerbung entscheiden
    const store = require('../src/lib/applications/store');
    const record = store.createRecord(G, store.typeById(G, 'fw'), { userId: 'bewerber', userTag: 'bewerber', answers: [{ question: 'Frage', answer: 'Antwort' }] });
    const list = await call('GET', `/api/guilds/${G}/applications?status=open`);
    expect(list.json?.some((r) => r.number === record.number), 'offene Bewerbungen auflisten');
    const detail = await call('GET', `/api/guilds/${G}/applications/${record.number}`);
    expect(detail.json?.nextStatuses?.map((s) => s.id).join() === 'SCREENING,S_PRAXISTEST,WITHDRAWN', 'Bewerbung mit Statusoptionen');
    const stage = await call('POST', `/api/guilds/${G}/applications/${record.number}/decide`, { status: 'S_PRAXISTEST' });
    expect(stage.json?.statusLabel === 'Praxistest', 'Prüfschritt im Dashboard setzen');
    const accepted = await call('POST', `/api/guilds/${G}/applications/${record.number}/decide`, { action: 'accept', reason: 'Gut' });
    expect(accepted.json?.status === 'ACCEPTED' && store.getRecord(G, record.number).decidedBy === 'admin', 'Bewerbung im Dashboard annehmen');
    expect((await call('POST', `/api/guilds/${G}/applications/${record.number}/decide`, { action: 'reject' })).status === 400, 'doppelte Entscheidung wird abgelehnt');

    // Sperren
    const ban = await call('POST', `/api/guilds/${G}/bans`, { discordId: '123456789012345678', scope: 'fw', reason: 'Test', days: 3 });
    expect(ban.json?.id && store.activeBan(G, 'fw', { discordId: '123456789012345678' }), 'Sperre anlegen');
    expect((await call('DELETE', `/api/guilds/${G}/bans/${ban.json?.id}`)).status === 200 && !store.activeBan(G, 'fw', { discordId: '123456789012345678' }), 'Sperre aufheben');

    // Statistik, Löschen
    expect((await call('GET', `/api/guilds/${G}/stats?days=30`)).json?.fields?.length > 0, 'Statistik');
    expect((await call('POST', `/api/guilds/${G}/types`, { id: 'weg', template: 'leer' })).status === 200, 'zweite Art anlegen');
    expect((await call('DELETE', `/api/guilds/${G}/types/weg`)).status === 200 && !store.typeById(G, 'weg'), 'Art löschen');
  } finally {
    server.close();
  }
};

module.exports.fakeClient = fakeClient;
module.exports.SECRET = SECRET;
