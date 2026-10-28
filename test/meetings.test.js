// Tests für Team-Kalender & Meetings: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enrp-meetings-'));
const { Collection, PermissionsBitField } = require('discord.js');
const settings = require('../src/lib/settings');
const db = require('../src/lib/db');
const meetings = require('../src/lib/meetings');

function fakeGuild(id) {
  const sent = [];
  const voice = { id: 'v1', members: new Collection(), isVoiceBased: () => true };
  const text = { id: 't1', isTextBased: () => true, send: async (p) => (sent.push(p), { id: `m${sent.length}` }), messages: { fetch: async () => ({ edit: async () => {} }) } };
  settings.set(id, 'team.enabled', true);
  settings.set(id, 'team.meetings', { enabled: true, channel: 't1', reminderMinutes: 30 });
  return { id, sent, voice, channels: { cache: new Collection([['t1', text], ['v1', voice]]), fetch: async () => null } };
}

test('Datum und Uhrzeit werden in der Zeitzone des Servers gelesen', () => {
  assert.equal(new Date(meetings.parseStart('01.07.2026', '20:00', 'Europe/Berlin')).toISOString(), '2026-07-01T18:00:00.000Z');
  assert.equal(new Date(meetings.parseStart('01.07.2026', '20:00', 'Europe/London')).toISOString(), '2026-07-01T19:00:00.000Z');
  for (const [d, t] of [['31.02.2026', '10:00'], ['01.13.2026', '10:00'], ['01.01.2026', '24:00'], ['2026-01-01', '10:00'], ['01.01.2026', '10']]) {
    assert.equal(meetings.parseStart(d, t, 'Europe/Berlin'), null, `${d} ${t}`);
  }
});

test('Meeting anlegen, Erinnerung einmal, Anwesenheit aus dem Sprachkanal', async () => {
  const guild = fakeGuild('6000000000000000001');
  await assert.rejects(meetings.createMeeting(guild, { title: 'Alt', start: Date.now() - 1000, createdBy: '1' }), /Zukunft/);
  const m = await meetings.createMeeting(guild, { title: 'Teammeeting', start: Date.now() + 20 * 60_000, duration: 60, roles: ['r1'], voiceChannelId: 'v1', createdBy: '1' });
  assert.equal(guild.sent[0].content, '<@&r1>');
  m.rsvp = { a: 'yes', b: 'no', c: 'maybe' };
  await meetings.tick(guild); // 20 Min. vorher → Erinnerung (30 Min. eingestellt)
  await meetings.tick(guild);
  const reminders = guild.sent.filter((p) => p.embeds?.[0]?.data.description?.includes('beginnt'));
  assert.equal(reminders.length, 1, 'genau eine Erinnerung');
  assert.match(reminders[0].content, /<@a>/);
  assert.doesNotMatch(reminders[0].content, /<@b>/, 'wer abgesagt hat, wird nicht erinnert');

  // Beginn: wer im Sprachkanal ist, gilt als anwesend.
  m.start = Date.now() - 1000;
  guild.voice.members.set('a', {});
  guild.voice.members.set('x', {});
  await meetings.tick(guild);
  assert.deepEqual(Object.keys(m.attendance).sort(), ['a', 'x']);
  assert.equal(m.samples, 1);

  const stats = meetings.attendanceStats(guild.id);
  assert.equal(stats.a.present, 1);
  assert.equal(stats.b.no, 1);
  assert.equal(stats.x.present, 1, 'auch ohne Zusage zählt die Anwesenheit');
});

test('Zu- und Absagen nur für Teammitglieder', async () => {
  const guild = fakeGuild('6000000000000000002');
  settings.set(guild.id, 'team.roles', [{ id: 'teamrole', perms: [] }]);
  const m = await meetings.createMeeting(guild, { title: 'X', start: Date.now() + 3_600_000, createdBy: '1' });
  const replies = [];
  const interaction = (roles) => ({
    guildId: guild.id,
    user: { id: 'u1' },
    member: { id: 'u1', guild: { id: guild.id, ownerId: 'owner' }, permissions: new PermissionsBitField(0n), roles: { cache: new Collection(roles.map((r) => [r, {}])) } },
    reply: async (p) => replies.push(p),
    update: async (p) => replies.push(p),
    replied: false,
    deferred: false,
  });
  await meetings.answer(interaction([]), 'yes', m.id);
  assert.equal(m.rsvp.u1, undefined);
  assert.match(replies.at(-1).content, /Nur Teammitglieder/);
  await meetings.answer(interaction(['teamrole']), 'yes', m.id);
  assert.equal(m.rsvp.u1, 'yes');
});

test.after(() => {
  db.flush();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
