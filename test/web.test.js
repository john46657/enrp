const { fakeWorld, fakeUser, fakeMember, fakeChannel, fakeInteraction } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const settings = require('../src/lib/settings');
const web = require('../src/lib/web');
const store = require('../src/lib/applications/store');
const typesCommand = require('../src/commands/applications/types');
const { createServer } = require('../src/web/server');

// Roblox-Suche ohne Netzwerk; alle anderen Anfragen gehen an den Testserver.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (!String(url).includes('roblox.com')) return realFetch(url, options);
  if (String(url).includes('usernames')) {
    const name = JSON.parse(options.body).usernames[0];
    return { ok: true, json: async () => ({ data: name === 'GibtEsNicht' ? [] : [{ id: 4711, name, displayName: name }] }) };
  }
  return { ok: true, json: async () => ({ data: [] }) };
};

const { client, guild } = fakeWorld();
const teamChannel = fakeChannel(guild, 'bewerbungen');
const MANAGER_ROLE = '900000000000000001';
const admin = fakeMember(guild, fakeUser('Admin'), { manageGuild: true });
const manager = fakeMember(guild, fakeUser('Manager'), { roles: [MANAGER_ROLE] });
const applicant = fakeMember(guild, fakeUser('Bewerber'));
const outsider = fakeMember(guild, fakeUser('Fremder'));
settings.set(guild.id, 'applications.qualiChannel', teamChannel.id);

let origin;
let server;
test.before(async () => {
  const run = (sub, options) => typesCommand.execute(fakeInteraction(guild, admin, { sub, options }));
  await run('erstellen', { schluessel: 'web', name: 'Web-Bewerbung', emoji: '🌐' });
  await run('bearbeiten', { art: 'web', formular: 'WEB' });
  await run('frage-hinzufuegen', { art: 'web', typ: 'ROBLOX', frage: 'Wie heißt du in Roblox?' });
  await run('frage-hinzufuegen', { art: 'web', typ: 'TEXT', frage: 'Warum <b>du</b>?', min: 10 });
  await run('frage-hinzufuegen', { art: 'web', typ: 'CHOICE', frage: 'Wann hast du Zeit?', optionen: 'Abends; Nachts', mehrfach: true, pflicht: false });
  await run('rollen', { art: 'web', liste: 'managers', aktion: 'add', rolle: { roleId: MANAGER_ROLE } });
  server = createServer(client);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const local = (url) => url.replace('http://localhost', origin);
const post = (url, fields, headers = {}) =>
  fetch(url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields) });

test('signierte Links: Manipulation, falsche Art und Ablauf werden abgelehnt', () => {
  const token = web.sign({ k: 'apply', g: '1', u: '2', exp: Date.now() + 1000 });
  assert.equal(web.verify(token, 'apply').u, '2');
  assert.equal(web.verify(token, 'dash'), null);
  assert.equal(web.verify(`${token}x`, 'apply'), null);
  const [body, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ k: 'apply', g: '1', u: '999', exp: Date.now() + 1000 })).toString('base64url');
  assert.equal(web.verify(`${forged}.${signature}`, 'apply'), null);
  assert.equal(web.verify(`${body}.${signature}`, 'apply', Date.now() + 5000), null);
  assert.equal(web.verify(undefined, 'apply'), null);
});

test('Web-Formular: Link aus Discord, Prüfung, Einreichen', async () => {
  const flow = require('../src/lib/applications/flow');
  const offer = fakeInteraction(guild, applicant);
  await flow.offer(offer, 'web');
  const url = local(offer.replies[0].components[0].toJSON().components[0].url);
  assert.equal(applicant.user.sent.length, 0, 'bei Web-Formular kommt keine DM mit Fragen');

  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await page.text();
  assert.match(html, /Web-Bewerbung/);
  assert.match(html, /Warum &lt;b&gt;du&lt;\/b&gt;\?/, 'Fragen werden als Text ausgegeben, nicht als HTML');
  assert.match(html, /name="q_2" value="Nachts"/);

  assert.equal((await fetch(`${url}x`)).status, 403);

  const invalid = await post(url, { q_0: 'GibtEsNicht', q_1: 'kurz', q_2: 'Morgens' });
  assert.equal(invalid.status, 422);
  const invalidHtml = await invalid.text();
  assert.match(invalidHtml, /kein Roblox-Konto/);
  assert.match(invalidHtml, /mindestens 10 Zeichen/);
  assert.match(invalidHtml, /Ungültige Auswahl/);
  assert.equal(Object.keys(store.recordsOf(guild.id)).length, 0);

  const ok = await post(url, { q_0: 'MeinRoblox', q_1: 'Weil ich gerne Roleplay spiele.' });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Q-0001/);
  const record = store.getRecord(guild.id, 'Q-0001');
  assert.equal(record.userId, applicant.id);
  assert.equal(record.via, 'WEB');
  assert.deepEqual(record.roblox, { id: '4711', name: 'MeinRoblox' });
  assert.equal(record.answers[2].answer, '');
  assert.equal(teamChannel.sent.length, 1);

  const again = await post(url, { q_0: 'MeinRoblox', q_1: 'Weil ich gerne Roleplay spiele.' });
  assert.equal(again.status, 422);
  assert.match(await again.text(), /bereits eine offene/);
});

test('Dashboard: Anmeldung, Rechte, Entscheidung, Sperren', async () => {
  assert.equal((await fetch(`${origin}/dash`)).status, 401);

  const loginAs = async (member) => {
    const res = await fetch(local(web.loginUrl({ guildId: guild.id, userId: member.id })), { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    return res.headers.get('set-cookie').split(';')[0];
  };
  assert.equal((await fetch(`${origin}/dash`, { headers: { cookie: await loginAs(outsider) } })).status, 403);

  const cookie = await loginAs(manager);
  const list = await (await fetch(`${origin}/dash`, { headers: { cookie } })).text();
  assert.match(list, /Q-0001/);
  for (const path of ['stats', 'bans', 'numbers', 'log', 'setup', 'app/Q-0001']) {
    assert.equal((await fetch(`${origin}/dash/${path}`, { headers: { cookie } })).status, 200, path);
  }
  const detail = await (await fetch(`${origin}/dash/app/Q-0001`, { headers: { cookie } })).text();
  assert.match(detail, /Weil ich gerne Roleplay spiele\./);
  const csrf = detail.match(/name="csrf" value="([^"]+)"/)[1];

  const noCsrf = await post(`${origin}/dash/app/Q-0001/decide`, { status: 'ACCEPTED' }, { cookie });
  assert.equal(noCsrf.status, 403);
  assert.equal(store.getRecord(guild.id, 'Q-0001').status, 'OPEN');

  const decided = await post(`${origin}/dash/app/Q-0001/decide`, { status: 'REJECTED', reason: 'Zu kurz', csrf }, { cookie });
  assert.equal(decided.status, 303);
  const record = store.getRecord(guild.id, 'Q-0001');
  assert.equal(record.status, 'REJECTED');
  assert.equal(record.decidedBy, manager.id);
  assert.equal(record.reason, 'Zu kurz');
  assert.equal(teamChannel.sent[0].edits.length, 1, 'Team-Nachricht in Discord wurde aktualisiert');

  const ban = await post(`${origin}/dash/bans/add`, { discordId: applicant.id, scope: '*', reason: 'Test', days: '7', csrf }, { cookie });
  assert.equal(ban.status, 303);
  assert.match(store.eligibility(applicant, store.typeById(guild.id, 'web')), /gesperrt/);
  await post(`${origin}/dash/bans/lift`, { id: 'B-0001', csrf }, { cookie });
  assert.equal(store.activeBans(guild.id).length, 0);

  // Einrichtung umschalten darf nur Staff
  assert.equal((await post(`${origin}/dash/setup/toggle`, { type: 'web', csrf }, { cookie })).status, 403);
  assert.equal(store.typeById(guild.id, 'web').enabled, true);
});
