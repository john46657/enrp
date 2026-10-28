// Tests für das Zählen: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enrp-counting-'));
const settings = require('../src/lib/settings');
const counting = require('../src/lib/counting');

let next = 1;
const freshGuild = (overrides = {}) => {
  const id = String(9000 + next++);
  settings.set(id, 'counting.enabled', true);
  settings.set(id, 'counting.channel', '1');
  for (const [k, v] of Object.entries(overrides)) settings.set(id, `counting.${k}`, v);
  return id;
};

test('parseNumber: Zahl am Anfang, sonst nichts', () => {
  assert.equal(counting.parseNumber('19'), 19);
  assert.equal(counting.parseNumber('  20 🎉'), 20);
  assert.equal(counting.parseNumber('21 weiter so'), 21);
  assert.equal(counting.parseNumber('hallo 5'), null);
  assert.equal(counting.parseNumber('1.000'), null);
  assert.equal(counting.parseNumber('1,5'), null);
  assert.equal(counting.parseNumber(''), null);
});

test('richtig zählen, Rekord und Bestenliste', () => {
  const g = freshGuild();
  assert.equal(counting.count(g, 'a', 'm1', '1').result, 'ok');
  assert.equal(counting.count(g, 'b', 'm2', '2').result, 'ok');
  const r = counting.count(g, 'a', 'm3', '3');
  assert.deepEqual([r.result, r.record], ['ok', true]);
  assert.equal(counting.count(g, 'b', 'm4', 'nur reden').result, 'ignored');
  const s = counting.stateOf(g);
  assert.deepEqual([s.current, s.record, s.lastUserId, s.lastMessageId], [3, 3, 'a', 'm3']);
  assert.deepEqual(counting.topCounters(g), [['a', 2], ['b', 1]]);
});

test('falsche Zahl setzt auf 1 zurück, Rekord bleibt', () => {
  const g = freshGuild();
  for (const [i, u] of ['a', 'b', 'a', 'b'].entries()) counting.count(g, u, `m${i}`, String(i + 1));
  const r = counting.count(g, 'a', 'x', '7');
  assert.deepEqual([r.result, r.expected, r.reached], ['wrong', 5, 4]);
  const s = counting.stateOf(g);
  assert.deepEqual([s.current, s.record, s.resets, s.fails.a], [0, 4, 1, 1]);
  assert.equal(counting.count(g, 'a', 'y', '1').result, 'ok');
});

test('zweimal hintereinander ist ein Fehler, außer es ist erlaubt', () => {
  const g = freshGuild();
  counting.count(g, 'a', 'm1', '1');
  assert.equal(counting.count(g, 'a', 'm2', '2').result, 'twice');
  assert.equal(counting.stateOf(g).current, 0);

  const g2 = freshGuild({ allowTwice: true });
  counting.count(g2, 'a', 'm1', '1');
  assert.equal(counting.count(g2, 'a', 'm2', '2').result, 'ok');
});

test('ohne Zurücksetzen bleibt der Stand bei Fehlern', () => {
  const g = freshGuild({ resetOnFail: false });
  counting.count(g, 'a', 'm1', '1');
  assert.equal(counting.count(g, 'b', 'm2', '5').result, 'wrong');
  assert.equal(counting.stateOf(g).current, 1);
  assert.equal(counting.count(g, 'b', 'm3', '2').result, 'ok');
});

test('handleMessage reagiert nur im Zähl-Kanal', async () => {
  const g = freshGuild();
  const reactions = [];
  const sent = [];
  const msg = (content, channelId = '1', author = 'a', id = 'm') => ({
    guildId: g,
    channelId,
    id,
    content,
    author: { id: author, toString: () => `<@${author}>` },
    react: async (e) => reactions.push(e),
    delete: async () => reactions.push('deleted'),
    channel: { send: async (m) => sent.push(m) },
  });
  assert.equal(await counting.handleMessage(msg('1', '2')), false);
  assert.equal(await counting.handleMessage(msg('1')), true);
  assert.equal(await counting.handleMessage(msg('3', '1', 'b')), true);
  assert.deepEqual(reactions, ['✅', '❌']);
  assert.equal(sent.length, 1);

  // Gelöschte letzte Zahl wird angesagt.
  await counting.handleMessage(msg('1', '1', 'a', 'last'));
  await counting.handleDelete(msg('1', '1', 'a', 'last'));
  assert.equal(sent.length, 2);
  await counting.handleDelete(msg('1', '1', 'a', 'other'));
  assert.equal(sent.length, 2);
});
