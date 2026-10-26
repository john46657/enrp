import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DutyService, FactionService, ensureUser, getMembership, getRoster } from '@emden-network/core';
import type { Pool } from '@emden-network/database';
import type { RoleKey } from '@emden-network/shared';
import { resetDb, snowflake, testPool } from '../helpers/db.js';

const GUILD = '900000000000000004';
let pool: Pool;
let factions: FactionService;
let duty: DutyService;

beforeAll(() => {
  pool = testPool();
  factions = new FactionService(pool);
  duty = new DutyService(pool);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetDb(pool);
});

const actor = (...roles: RoleKey[]) => ({ discordId: snowflake(), roles: new Set(roles) });
let rid = 1000;
async function verified() {
  const discordId = snowflake();
  const userId = await ensureUser(pool, discordId);
  await pool.query('INSERT INTO discord_links (user_id, roblox_user_id) VALUES ($1, $2)', [userId, ++rid]);
  return { discordId, userId };
}

describe('Fraktionsverwaltung', () => {
  it('Leitung nimmt in eigene Fraktion auf, aber nicht in fremde', async () => {
    const lead = actor('polizeileitung');
    const p = await verified();
    await factions.invite(lead, GUILD, 'polizei', p.discordId);
    expect((await getMembership(pool, p.discordId))?.factionKey).toBe('polizei');
    const q = await verified();
    await expect(factions.invite(lead, GUILD, 'feuerwehr', q.discordId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await getMembership(pool, q.discordId)).toBeNull();
  });

  it('verlangt eine Verifizierung und verhindert Doppelmitgliedschaft', async () => {
    const m = actor('management');
    const unverified = snowflake();
    await ensureUser(pool, unverified);
    await expect(factions.invite(m, GUILD, 'polizei', unverified)).rejects.toMatchObject({ code: 'NOT_LINKED' });
    const p = await verified();
    await factions.invite(m, GUILD, 'polizei', p.discordId);
    await expect(factions.invite(m, GUILD, 'feuerwehr', p.discordId)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('befördert und degradiert nur in die richtige Richtung und protokolliert', async () => {
    const lead = actor('feuerwehrleitung');
    const p = await verified();
    await factions.invite(lead, GUILD, 'feuerwehr', p.discordId);
    await expect(factions.changeRank(lead, GUILD, p.discordId, 'anwaerter', 'promote')).rejects.toMatchObject({ code: 'CONFLICT' });
    const up = await factions.changeRank(lead, GUILD, p.discordId, 'brandmeister', 'promote');
    expect(up.to.key).toBe('brandmeister');
    await expect(factions.changeRank(lead, GUILD, p.discordId, 'brandinspektor', 'demote')).rejects.toMatchObject({ code: 'VALIDATION' });
    await factions.changeRank(lead, GUILD, p.discordId, 'feuerwehrmann', 'demote');
    await expect(factions.changeRank(actor('polizeileitung'), GUILD, p.discordId, 'brandmeister', 'set')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const audit = await factions.memberAudit(lead, GUILD, p.discordId);
    expect(audit.map((a) => a.action)).toEqual(['faction.rank_demote', 'faction.rank_promote', 'faction.member_added']);
  });

  it('entfernt Mitglieder und beendet deren Dienst', async () => {
    const lead = actor('rettungsdienstleitung');
    const p = await verified();
    await factions.invite(lead, GUILD, 'rettungsdienst', p.discordId);
    await duty.start({ userId: p.userId, factionKey: 'rettungsdienst', source: 'discord' });
    await factions.remove(lead, GUILD, p.discordId, 'Inaktivität');
    expect(await getMembership(pool, p.discordId)).toBeNull();
    expect(await duty.current(p.discordId)).toBeNull();
    expect(await getRoster(pool, 'rettungsdienst')).toEqual([]);
  });
});

describe('Dienstsystem', () => {
  async function officer() {
    const p = await verified();
    await factions.invite(actor('owner'), GUILD, 'polizei', p.discordId);
    return p;
  }

  it('erlaubt nur eine offene Sitzung und nur in der eigenen Fraktion', async () => {
    const p = await officer();
    await duty.start({ userId: p.userId, factionKey: 'polizei', source: 'discord' });
    await expect(duty.start({ userId: p.userId, factionKey: 'polizei', source: 'game' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(duty.start({ userId: p.userId, factionKey: 'feuerwehr', source: 'discord' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const roster = await getRoster(pool, 'polizei');
    expect(roster[0]?.onDuty).toBe(true);
  });

  it('verhindert parallele Doppel-Starts auf Datenbankebene', async () => {
    const p = await officer();
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => duty.start({ userId: p.userId, factionKey: 'polizei', source: 'discord' })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('kappt Sitzungen über 24 Stunden und markiert sie', async () => {
    const p = await officer();
    await duty.start({ userId: p.userId, factionKey: 'polizei', source: 'discord', at: new Date(Date.now() - 30 * 3_600_000) });
    const r = await duty.end({ userId: p.userId });
    expect(r.capped).toBe(true);
    const row = (await pool.query('SELECT ended_at - started_at AS d, correction_reason FROM duty_sessions')).rows[0];
    expect(row.correction_reason).toContain('24 Stunden');
  });

  it('lehnt Zeitstempel in der Zukunft ab', async () => {
    const p = await officer();
    await expect(duty.start({ userId: p.userId, factionKey: 'polizei', source: 'discord', at: new Date(Date.now() + 3_600_000) })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('korrigiert Sitzungen nur mit Berechtigung und bewahrt Originalwerte', async () => {
    const p = await officer();
    const { session } = await duty.start({ userId: p.userId, factionKey: 'polizei', source: 'discord', at: new Date(Date.now() - 2 * 3_600_000) });
    await duty.end({ userId: p.userId });
    await expect(duty.correct(actor('feuerwehrleitung'), GUILD, session.id, { endedAt: new Date() }, 'Test')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(duty.correct(actor('polizeileitung'), GUILD, session.id, { endedAt: new Date(Date.now() - 3 * 3_600_000) }, 'Test')).rejects.toMatchObject({ code: 'VALIDATION' });
    const corrected = await duty.correct(actor('polizeileitung'), GUILD, session.id, { startedAt: new Date(Date.now() - 3_600_000) }, 'Falsch gestartet');
    expect(corrected.startedAt.getTime()).toBeGreaterThan(Date.now() - 3_600_000 - 5000);
    const row = (await pool.query('SELECT original_started_at IS NOT NULL AS o, correction_reason FROM duty_sessions')).rows[0];
    expect(row).toEqual({ o: true, correction_reason: 'Falsch gestartet' });
    expect(Math.round((await duty.totalSeconds({ discordId: p.discordId }, 30)) / 60)).toBe(60);
  });

  it('exportiert CSV nur für die eigene Fraktion', async () => {
    const p = await officer();
    await duty.start({ userId: p.userId, factionKey: 'polizei', source: 'discord', at: new Date(Date.now() - 600_000) });
    await duty.end({ userId: p.userId });
    const csv = await duty.exportCsv(actor('polizeileitung'), GUILD, 'polizei', 7);
    expect(csv.split('\n')[0]).toBe('sitzung;discord_id;roblox_id;quelle;beginn_utc;ende_utc;dauer_minuten;korrigiert');
    expect(csv).toContain(`;${p.discordId};`);
    await expect(duty.exportCsv(actor('polizeileitung'), GUILD, 'feuerwehr', 7)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
