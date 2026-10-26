import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  OUTBOX_ROLE_GRANT,
  OUTBOX_ROLE_REVOKE,
  OutboxProcessor,
  enqueueOutbox,
  ensureUser,
  registerRoleSyncHandlers,
  setGuildRole,
} from '@emden-network/core';
import type { Pool } from '@emden-network/database';
import { resetDb, snowflake, testPool } from '../helpers/db.js';
import { FakeDiscord } from '../helpers/fake-discord.js';

const GUILD = '900000000000000002';
const VERIFIED = '800000000000000001';
const UNVERIFIED = '800000000000000002';
const FACTION_ROLE = '800000000000000003';

let pool: Pool;
let discord: FakeDiscord;
let processor: OutboxProcessor;
let errors: { final: boolean }[];

beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDb(pool);
  discord = new FakeDiscord();
  errors = [];
  processor = new OutboxProcessor(pool, { backoffBaseSeconds: 5, onError: (_e, _err, final) => errors.push({ final }) });
  registerRoleSyncHandlers(processor, pool, discord);
});

async function linkedMember(): Promise<string> {
  const discordId = snowflake();
  const userId = await ensureUser(pool, discordId);
  await pool.query('INSERT INTO discord_links (user_id, roblox_user_id) VALUES ($1, $2)', [userId, Math.floor(Math.random() * 1e9) + 1]);
  discord.members.add(discordId);
  return discordId;
}

async function configure() {
  await setGuildRole(pool, GUILD, 'verifiziert', VERIFIED, 'system');
  await setGuildRole(pool, GUILD, 'unverified', UNVERIFIED, 'system');
}

async function eventRow() {
  return (await pool.query('SELECT status, attempts, last_error, available_at > now() AS delayed FROM outbox_events')).rows[0];
}

describe('Rollenvergabe „Verifiziert“', () => {
  it('vergibt ausschließlich die Rolle Verifiziert, entfernt Unverified und benachrichtigt per DM', async () => {
    await configure();
    const id = await linkedMember();
    discord.roles.set(id, new Set([UNVERIFIED]));
    await enqueueOutbox(pool, OUTBOX_ROLE_GRANT, { guildId: GUILD, discordId: id, notify: true, robloxUsername: 'Tester' });
    expect(await processor.runOnce()).toBe(1);
    expect([...discord.roles.get(id)!]).toEqual([VERIFIED]);
    expect(discord.hasRole(id, FACTION_ROLE)).toBe(false);
    expect(discord.dms[0]!.content).toContain('Tester');
    expect((await eventRow()).status).toBe('done');
    const audit = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'discord.verified_role_granted'`);
    expect(audit.rows[0].n).toBe(1);
  });

  it('schlägt dauerhaft fehl, wenn die Rolle nicht konfiguriert ist, und protokolliert das', async () => {
    const id = await linkedMember();
    await enqueueOutbox(pool, OUTBOX_ROLE_GRANT, { guildId: GUILD, discordId: id, notify: false });
    await processor.runOnce();
    const row = await eventRow();
    expect(row.status).toBe('failed');
    expect(row.last_error).toContain('nicht konfiguriert');
    const audit = await pool.query(`SELECT outcome FROM audit_logs WHERE action = 'outbox.failed'`);
    expect(audit.rows).toEqual([{ outcome: 'failure' }]);
  });

  it('wiederholt bei vorübergehendem Discord-Fehler mit Backoff und gibt nach max_attempts auf', async () => {
    await configure();
    const id = await linkedMember();
    discord.failAddRole = new Error('Discord 503');
    await enqueueOutbox(pool, OUTBOX_ROLE_GRANT, { guildId: GUILD, discordId: id, notify: false }, { maxAttempts: 3 });

    await processor.runOnce();
    let row = await eventRow();
    expect(row).toMatchObject({ status: 'pending', attempts: 1, delayed: true });
    expect(await processor.runOnce()).toBe(0); // noch nicht fällig

    for (let i = 0; i < 2; i++) {
      await pool.query('UPDATE outbox_events SET available_at = now()');
      await processor.runOnce();
    }
    row = await eventRow();
    expect(row).toMatchObject({ status: 'failed', attempts: 3 });
    expect(errors.map((e) => e.final)).toEqual([false, false, true]);
  });

  it('erholt sich nach einem vorübergehenden Fehler', async () => {
    await configure();
    const id = await linkedMember();
    discord.failAddRole = new Error('timeout');
    await enqueueOutbox(pool, OUTBOX_ROLE_GRANT, { guildId: GUILD, discordId: id, notify: false });
    await processor.runOnce();
    discord.failAddRole = null;
    await pool.query('UPDATE outbox_events SET available_at = now()');
    await processor.runOnce();
    expect((await eventRow()).status).toBe('done');
    expect(discord.hasRole(id, VERIFIED)).toBe(true);
  });

  it('gibt auf, wenn das Mitglied den Server verlassen hat', async () => {
    await configure();
    const id = await linkedMember();
    discord.members.delete(id);
    await enqueueOutbox(pool, OUTBOX_ROLE_GRANT, { guildId: GUILD, discordId: id, notify: false });
    await processor.runOnce();
    expect((await eventRow()).status).toBe('failed');
  });

  it('vergibt keine Rolle, wenn die Verknüpfung inzwischen aufgehoben wurde', async () => {
    await configure();
    const id = await linkedMember();
    await pool.query(`UPDATE discord_links SET revoked_at = now(), revoked_reason = 'test'`);
    await enqueueOutbox(pool, OUTBOX_ROLE_GRANT, { guildId: GUILD, discordId: id, notify: false });
    await processor.runOnce();
    expect(discord.hasRole(id, VERIFIED)).toBe(false);
  });

  it('übersteht deaktivierte DMs', async () => {
    await configure();
    const id = await linkedMember();
    discord.dmsDisabled = true;
    await enqueueOutbox(pool, OUTBOX_ROLE_GRANT, { guildId: GUILD, discordId: id, notify: true });
    await processor.runOnce();
    expect((await eventRow()).status).toBe('done');
  });

  it('entzieht die Rolle nach Aufheben der Verknüpfung', async () => {
    await configure();
    const id = await linkedMember();
    discord.roles.set(id, new Set([VERIFIED]));
    await pool.query(`UPDATE discord_links SET revoked_at = now(), revoked_reason = 'test'`);
    await enqueueOutbox(pool, OUTBOX_ROLE_REVOKE, { guildId: GUILD, discordId: id, notify: false });
    await processor.runOnce();
    expect([...discord.roles.get(id)!]).toEqual([UNVERIFIED]);
  });

  it('legt keine doppelten offenen Events mit gleichem dedupe_key an', async () => {
    const id = snowflake();
    await enqueueOutbox(pool, OUTBOX_ROLE_GRANT, { guildId: GUILD, discordId: id, notify: false }, { dedupeKey: `verified:${id}` });
    await enqueueOutbox(pool, OUTBOX_ROLE_GRANT, { guildId: GUILD, discordId: id, notify: false }, { dedupeKey: `verified:${id}` });
    expect((await pool.query('SELECT count(*)::int AS n FROM outbox_events')).rows[0].n).toBe(1);
  });

  it('übernimmt Events mit abgelaufener Sperre (Worker-Absturz)', async () => {
    await configure();
    const id = await linkedMember();
    await enqueueOutbox(pool, OUTBOX_ROLE_GRANT, { guildId: GUILD, discordId: id, notify: false });
    await pool.query(`UPDATE outbox_events SET status = 'processing', attempts = 1, locked_until = now() - interval '1 second'`);
    await processor.runOnce();
    expect((await eventRow()).status).toBe('done');
  });
});
