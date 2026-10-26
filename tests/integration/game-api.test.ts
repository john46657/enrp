import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@emden-network/api';
import { GameService, RobloxOAuthClient, VerificationService, ensureUser, getFaction, listRanks } from '@emden-network/core';
import type { Pool } from '@emden-network/database';
import type { RoleKey } from '@emden-network/shared';
import { resetDb, snowflake, testPool } from '../helpers/db.js';

const KEY = 'k'.repeat(48);
const INTERNAL = 'i'.repeat(48);
const GUILD = '900000000000000003';
const PLACE = 1234567;
const auth = { authorization: `Bearer ${KEY}` };

let pool: Pool;
let app: FastifyInstance;
let game: GameService;

beforeAll(async () => {
  pool = testPool();
  const oauth = new RobloxOAuthClient({ clientId: '1', clientSecret: 'x'.repeat(16), redirectUri: 'http://localhost/cb', baseUrl: 'http://127.0.0.1:9' });
  app = await buildApp({
    pool,
    verification: new VerificationService(pool, oauth, { publicBaseUrl: 'http://localhost' }),
    cookieSecure: false,
    internalApiToken: INTERNAL,
    gameApiKey: KEY,
    allowedPlaceIds: new Set([PLACE]),
    disableRateLimit: true,
  });
  game = new GameService(pool);
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetDb(pool);
  await pool.query(`INSERT INTO game_settings (key, value) VALUES ('maintenance', '{"enabled": false, "message": null}')`);
});

const actor = (...roles: RoleKey[]) => ({ discordId: snowflake(), roles: new Set(roles) });

async function heartbeat(jobId: string, players: string[] = [], extra: Record<string, unknown> = {}) {
  return app.inject({ method: 'POST', url: '/v1/game/heartbeat', headers: auth, payload: { jobId, placeId: PLACE, players, ...extra } });
}

async function events(jobId: string, list: Record<string, unknown>[]) {
  return app.inject({ method: 'POST', url: '/v1/game/events', headers: auth, payload: { jobId, events: list } });
}

/** Verifizierter Spieler, Mitglied der Polizei */
async function officer(robloxId: string) {
  const discordId = snowflake();
  const userId = await ensureUser(pool, discordId);
  await pool.query('INSERT INTO discord_links (user_id, roblox_user_id, roblox_username) VALUES ($1, $2, $3)', [userId, robloxId, `user${robloxId}`]);
  const f = await getFaction(pool, 'polizei');
  const rank = (await listRanks(pool, 'polizei'))[0]!;
  await pool.query('INSERT INTO faction_members (faction_id, user_id, rank_id) VALUES ($1, $2, $3)', [f.id, userId, rank.id]);
  return { discordId, userId };
}

const ev = (type: string, extra: Record<string, unknown>) => ({ eventId: randomUUID(), occurredAt: new Date().toISOString(), type, ...extra });

describe('Game-API Authentifizierung und Validierung', () => {
  it('lehnt Anfragen ohne oder mit falschem Schlüssel ab', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/game/heartbeat', payload: {} })).statusCode).toBe(401);
    const wrong = await app.inject({ method: 'POST', url: '/v1/game/heartbeat', headers: { authorization: `Bearer ${INTERNAL}` }, payload: {} });
    expect(wrong.statusCode).toBe(401);
  });

  it('lehnt nicht freigegebene placeIds ab', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/game/heartbeat', headers: auth, payload: { jobId: 'job-a', placeId: 999, players: [] } });
    expect(r.statusCode).toBe(403);
  });

  it('validiert Schemas und gibt keine internen Details preis', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/game/heartbeat', headers: auth, payload: { jobId: 'job a; DROP', placeId: PLACE, players: ['x'] } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: 'VALIDATION', message: 'Ungültige Eingabe.' });
  });

  it('liefert öffentlichen Serverstatus ohne Personendaten', async () => {
    await heartbeat('job-a', ['11', '12']);
    await heartbeat('job-b', ['13']);
    const r = await app.inject({ method: 'GET', url: '/v1/servers/status' });
    expect(r.json()).toEqual({ servers: 2, players: 3, maintenance: false });
  });
});

describe('Heartbeat und Spielereignisse', () => {
  it('liefert Wartungsmodus mit der Heartbeat-Antwort', async () => {
    const admin = actor('management');
    await game.setMaintenance(admin, GUILD, true, 'Update');
    const r = await heartbeat('job-a');
    expect(r.json().settings.maintenance).toEqual({ enabled: true, message: 'Update' });
    await expect(game.setMaintenance(actor('moderator'), GUILD, false, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('verlangt einen Heartbeat vor Ereignissen', async () => {
    const r = await events('unbekannt', [ev('player.join', { robloxUserId: '1' })]);
    expect(r.statusCode).toBe(409);
  });

  it('verarbeitet doppelte Ereignisse genau einmal', async () => {
    const o = await officer('5001');
    await heartbeat('job-a', ['5001']);
    const start = ev('duty.start', { robloxUserId: '5001', faction: 'polizei' });
    const r1 = await events('job-a', [start]);
    expect(r1.json().results).toEqual([{ eventId: start.eventId, status: 'processed' }]);
    const r2 = await events('job-a', [start, start]);
    expect(r2.json().results.map((x: { status: string }) => x.status)).toEqual(['duplicate', 'duplicate']);
    const sessions = await pool.query('SELECT count(*)::int AS n FROM duty_sessions WHERE user_id = $1', [o.userId]);
    expect(sessions.rows[0].n).toBe(1);
  });

  it('lehnt Dienstbeginn für fremde Fraktion oder unverifizierte Spieler ab', async () => {
    await officer('5002');
    await heartbeat('job-a');
    const r = await events('job-a', [
      ev('duty.start', { robloxUserId: '5002', faction: 'feuerwehr' }),
      ev('duty.start', { robloxUserId: '9999', faction: 'polizei' }),
    ]);
    expect(r.json().results.map((x: { status: string; reason?: string }) => [x.status, x.reason])).toEqual([
      ['rejected', 'kein Mitglied dieser Fraktion'],
      ['rejected', 'NOT_LINKED'],
    ]);
  });

  it('beendet einen Dienst nur einmal (doppeltes Dienstende)', async () => {
    const o = await officer('5003');
    await heartbeat('job-a');
    await events('job-a', [ev('duty.start', { robloxUserId: '5003', faction: 'polizei', occurredAt: new Date(Date.now() - 60_000).toISOString() })]);
    const end1 = ev('duty.end', { robloxUserId: '5003' });
    const end2 = ev('duty.end', { robloxUserId: '5003' });
    const r = await events('job-a', [end1, end2, end1]);
    expect(r.json().results.map((x: { status: string }) => x.status)).toEqual(['processed', 'duplicate', 'duplicate']);
    const s = await pool.query('SELECT end_event_id FROM duty_sessions WHERE user_id = $1', [o.userId]);
    expect(s.rows).toEqual([{ end_event_id: end1.eventId }]);
  });

  it('lehnt Ereignisse mit unplausiblen Zeitstempeln ab', async () => {
    await officer('5004');
    await heartbeat('job-a');
    const r = await events('job-a', [
      ev('duty.start', { robloxUserId: '5004', faction: 'polizei', occurredAt: new Date(Date.now() + 10 * 60_000).toISOString() }),
      ev('duty.start', { robloxUserId: '5004', faction: 'polizei', occurredAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }),
    ]);
    expect(r.json().results.map((x: { reason?: string }) => x.reason)).toEqual(['TIMESTAMP_OUT_OF_RANGE', 'TIMESTAMP_OUT_OF_RANGE']);
  });

  it('lehnt Dienstende vor Dienstbeginn ab (inkonsistente Zeitstempel)', async () => {
    const o = await officer('5005');
    await heartbeat('job-a');
    await events('job-a', [ev('duty.start', { robloxUserId: '5005', faction: 'polizei' })]);
    const r = await events('job-a', [ev('duty.end', { robloxUserId: '5005', occurredAt: new Date(Date.now() - 3_600_000).toISOString() })]);
    expect(r.json().results[0]).toMatchObject({ status: 'rejected', reason: 'Dienstende liegt vor Dienstbeginn' });
    const s = await pool.query('SELECT ended_at FROM duty_sessions WHERE user_id = $1', [o.userId]);
    expect(s.rows[0].ended_at).toBeNull();
  });

  it('beendet Spiel-Dienste beim Herunterfahren des Servers und beim Verlassen', async () => {
    const a = await officer('5006');
    const b = await officer('5007');
    await heartbeat('job-a', ['5006', '5007']);
    await events('job-a', [ev('duty.start', { robloxUserId: '5006', faction: 'polizei' }), ev('duty.start', { robloxUserId: '5007', faction: 'polizei' })]);
    await events('job-a', [ev('player.leave', { robloxUserId: '5006' })]);
    expect((await pool.query('SELECT ended_at IS NOT NULL AS e FROM duty_sessions WHERE user_id = $1', [a.userId])).rows[0].e).toBe(true);
    await heartbeat('job-a', [], { shuttingDown: true });
    expect((await pool.query('SELECT ended_at IS NOT NULL AS e FROM duty_sessions WHERE user_id = $1', [b.userId])).rows[0].e).toBe(true);
  });
});

describe('Admin-Aufträge', () => {
  it('prüft Berechtigungen und Payload serverseitig', async () => {
    await expect(game.createJob(actor('moderator'), GUILD, 'ban', { robloxUserId: '1', reason: 'Cheating', durationSeconds: null })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(game.createJob(actor('verifiziert'), GUILD, 'announce', { message: 'hi' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(game.createJob(actor('management'), GUILD, 'announce', { message: '' })).rejects.toMatchObject({ code: 'VALIDATION' });
    // @ts-expect-error unbekannter Typ
    await expect(game.createJob(actor('owner'), GUILD, 'lua', { code: 'print(1)' })).rejects.toMatchObject({ code: 'VALIDATION' });
    const denied = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'permission.denied'`);
    expect(denied.rows[0].n).toBe(2);
  });

  it('verteilt Broadcasts an jeden Server genau einmal', async () => {
    await heartbeat('job-a');
    await heartbeat('job-b');
    const job = await game.createJob(actor('management'), GUILD, 'announce', { message: 'Willkommen bei Emden Network' });
    const a1 = (await app.inject({ method: 'GET', url: '/v1/game/actions?jobId=job-a', headers: auth })).json();
    const b1 = (await app.inject({ method: 'GET', url: '/v1/game/actions?jobId=job-b', headers: auth })).json();
    expect(a1.actions.map((x: { id: string }) => x.id)).toEqual([job.id]);
    expect(b1.actions[0].payload).toEqual({ message: 'Willkommen bei Emden Network' });
    const res = await app.inject({ method: 'POST', url: `/v1/game/actions/${job.id}/result`, headers: auth, payload: { jobId: 'job-a', success: true } });
    expect(res.json()).toMatchObject({ ok: true, duplicate: false });
    const again = await app.inject({ method: 'POST', url: `/v1/game/actions/${job.id}/result`, headers: auth, payload: { jobId: 'job-a', success: true } });
    expect(again.json()).toMatchObject({ ok: true, duplicate: true });
    const a2 = (await app.inject({ method: 'GET', url: '/v1/game/actions?jobId=job-a', headers: auth })).json();
    expect(a2.actions).toEqual([]);
  });

  it('reserviert Einzel-Aufträge (Ban) für genau einen Server und legt einen Moderationsfall an', async () => {
    await heartbeat('job-a');
    await heartbeat('job-b');
    const job = await game.createJob(actor('owner'), GUILD, 'ban', { robloxUserId: '777', reason: 'Exploiting', durationSeconds: 86400 });
    const [a, b] = await Promise.all([game.pollJobs('job-a'), game.pollJobs('job-b')]);
    expect(a.length + b.length).toBe(1);
    const winner = a.length ? 'job-a' : 'job-b';
    const loser = a.length ? 'job-b' : 'job-a';
    await expect(game.reportResult(loser, job.id, true)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await game.reportResult(winner, job.id, true)).toEqual({ status: 'succeeded', duplicate: false });
    expect(await game.reportResult(winner, job.id, true)).toEqual({ status: 'succeeded', duplicate: true });
    const c = await pool.query('SELECT action, target_roblox_id, expires_at IS NOT NULL AS has_expiry FROM moderation_cases');
    expect(c.rows).toEqual([{ action: 'game_ban', target_roblox_id: '777', has_expiry: true }]);
  });

  it('liefert abgelaufene Aufträge nicht mehr aus und lehnt späte Ergebnisse ab', async () => {
    await heartbeat('job-a');
    const job = await game.createJob(actor('owner'), GUILD, 'unban', { robloxUserId: '778' });
    expect(await game.pollJobs('job-a')).toHaveLength(1);
    await pool.query(`UPDATE command_jobs SET created_at = now() - interval '10 minutes', expires_at = now() - interval '1 second'`);
    await expect(game.reportResult('job-a', job.id, true)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect((await pool.query('SELECT status FROM command_jobs')).rows[0].status).toBe('expired');
    const announce = await game.createJob(actor('owner'), GUILD, 'announce', { message: 'alt' });
    await pool.query(`UPDATE command_jobs SET created_at = now() - interval '10 minutes', expires_at = now() - interval '1 second' WHERE id = $1`, [announce.id]);
    expect(await game.pollJobs('job-a')).toEqual([]);
  });

  it('gibt einen Auftrag nach Ablauf des Leases wieder frei (Serverabsturz)', async () => {
    await heartbeat('job-a');
    await heartbeat('job-b');
    await game.createJob(actor('owner'), GUILD, 'unban', { robloxUserId: '779' });
    expect(await game.pollJobs('job-a')).toHaveLength(1);
    expect(await game.pollJobs('job-b')).toHaveLength(0);
    await pool.query(`UPDATE command_jobs SET lease_until = now() - interval '1 second'`);
    expect(await game.pollJobs('job-b')).toHaveLength(1);
  });
});

describe('Profil-Endpunkt', () => {
  it('liefert Fraktion und Rang für Spielserver, aber nur mit Schlüssel', async () => {
    await officer('5010');
    expect((await app.inject({ method: 'GET', url: '/v1/players/roblox:5010/profile' })).statusCode).toBe(401);
    const r = await app.inject({ method: 'GET', url: '/v1/players/roblox:5010/profile', headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ roblox: { id: '5010', username: 'user5010' }, faction: { key: 'polizei', rank: { key: 'anwaerter' } } });
    expect((await app.inject({ method: 'GET', url: '/v1/players/roblox:42/profile', headers: auth })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/players/xyz/profile', headers: auth })).statusCode).toBe(400);
  });

  it('hebt Verknüpfungen nur mit internem Token auf', async () => {
    const o = await officer('5011');
    const body = { discordId: o.discordId, guildId: GUILD, actorDiscordId: o.discordId, reason: 'Selbst' };
    expect((await app.inject({ method: 'POST', url: '/v1/verification/revoke', headers: auth, payload: body })).statusCode).toBe(401);
    const r = await app.inject({ method: 'POST', url: '/v1/verification/revoke', headers: { authorization: `Bearer ${INTERNAL}` }, payload: body });
    expect(r.json()).toEqual({ ok: true, robloxUserId: '5011' });
  });
});
