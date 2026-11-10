import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, OWNER_ID, resetDatabase } from './helpers';
import { botHeaders, createTestApp } from './api-helpers';

const USER = '700000000000000011';

beforeEach(resetDatabase);
afterAll(closeDb);

describe('API: Leitstelle', () => {
  it('Einsatz anlegen, übernehmen, Status, Notiz, abschließen; Rechte und Validierung', async () => {
    const { app } = await createTestApp();
    const owner = botHeaders(OWNER_ID);

    expect((await app.inject('/api/v1/dispatch/incidents')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/v1/dispatch/incidents', headers: botHeaders(USER) })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v1/mod-calls', headers: botHeaders(USER) })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v1/roblox/live/players', headers: botHeaders(USER) })).statusCode).toBe(403);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/dispatch/incidents',
      headers: { ...owner, 'idempotency-key': 'cad-key-bad-0001' },
      payload: { title: 'x', location: '' },
    });
    expect(bad.statusCode).toBe(400);
    const unknownDept = await app.inject({
      method: 'POST',
      url: '/api/v1/dispatch/incidents',
      headers: { ...owner, 'idempotency-key': 'cad-key-dept-0001' },
      payload: { title: 'Unfall', location: 'Hauptstraße', department: 'Gibtsnicht' },
    });
    expect(unknownDept.statusCode).toBe(400);

    const headers = { ...owner, 'idempotency-key': 'cad-key-create-0001' };
    const payload = { title: 'Verkehrsunfall', location: 'Hauptstraße', priority: 1 };
    const created = await app.inject({ method: 'POST', url: '/api/v1/dispatch/incidents', headers, payload });
    expect(created.statusCode).toBe(200);
    const incident = created.json();
    expect(incident).toMatchObject({ number: 1, source: 'discord', status: 'open', department: 'Polizei' });
    // Wiederholung mit gleichem Schlüssel legt keinen zweiten Einsatz an
    const again = await app.inject({ method: 'POST', url: '/api/v1/dispatch/incidents', headers, payload });
    expect(again.json().id).toBe(incident.id);

    const post = (path: string, body: unknown) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/dispatch/incidents/${incident.number}${path}`,
        headers: owner,
        payload: body as object,
      });
    expect((await post('/assign', {})).statusCode).toBe(200);
    expect((await post('/status', { status: 'on_scene' })).statusCode).toBe(200);
    expect((await post('/status', { status: 'closed' })).statusCode).toBe(400);
    expect((await post('/notes', { text: 'Zwei Fahrzeuge beteiligt' })).statusCode).toBe(200);

    const units = await app.inject({ url: '/api/v1/dispatch/units', headers: owner });
    expect(units.json().items).toEqual([expect.objectContaining({ unitId: OWNER_ID, status: 'on_scene' })]);

    expect((await post('/close', { report: 'Abgeschleppt' })).statusCode).toBe(200);
    expect((await post('/assign', {})).statusCode).toBe(400);
    // Nachträgliche Notizen bleiben möglich
    expect((await post('/notes', { text: 'Nachtrag' })).statusCode).toBe(200);

    const detail = (await app.inject({ url: `/api/v1/dispatch/incidents/${incident.id}`, headers: owner })).json();
    expect(detail.incident).toMatchObject({ status: 'closed', report: 'Abgeschleppt' });
    expect(detail.events.length).toBeGreaterThanOrEqual(4);

    const open = await app.inject({ url: '/api/v1/dispatch/incidents?status=open,assigned', headers: owner });
    expect(open.json().items).toHaveLength(0);
    const stats = await app.inject({ url: '/api/v1/dispatch/stats?days=7', headers: owner });
    expect(stats.json()).toMatchObject({ total: 1, closed: 1, open: 0 });

    const me = await app.inject({
      method: 'PUT',
      url: '/api/v1/dispatch/units/me',
      headers: owner,
      payload: { status: 'off_duty', callsign: 'Adler 1' },
    });
    expect(me.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/dispatch/units', headers: owner })).json().items).toHaveLength(0);
    expect((await app.inject({ url: '/api/v1/dispatch/units?all=true', headers: owner })).json().items).toHaveLength(1);

    expect((await app.inject({ url: '/api/v1/mod-calls', headers: owner })).json().items).toEqual([]);
    expect((await app.inject({ url: '/api/v1/roblox/live/players', headers: owner })).json().items).toEqual([]);
    expect((await app.inject({ url: '/api/v1/roblox/live/vehicles?plate=en-a', headers: owner })).json().items).toEqual(
      [],
    );
    await app.close();
  });

  it('Fahndungen und Ingame-Aktionen über die API', async () => {
    const { app } = await createTestApp();
    const owner = botHeaders(OWNER_ID);
    expect((await app.inject({ url: '/api/v1/dispatch/bolos', headers: botHeaders(USER) })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v1/roblox/player-actions', headers: botHeaders(USER) })).statusCode).toBe(
      403,
    );

    const create = (key: string, payload: object) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/dispatch/bolos',
        headers: { ...owner, 'idempotency-key': key },
        payload,
      });
    expect((await create('bolo-key-bad-00001', { kind: 'person', reason: 'Ohne Ziel' })).statusCode).toBe(400);
    expect((await create('bolo-key-bad-00002', { kind: 'boot', plate: 'X', reason: 'x' })).statusCode).toBe(400);
    const created = await create('bolo-key-create-01', { kind: 'vehicle', plate: 'EN-AB 12', reason: 'Gestohlen' });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ number: 1, plateNormalized: 'ENAB12', status: 'active' });

    const list = await app.inject({ url: '/api/v1/dispatch/bolos?status=active', headers: owner });
    expect(list.json()).toMatchObject({ total: 1 });
    expect((await app.inject({ url: '/api/v1/dispatch/bolos/1', headers: owner })).json().plate).toBe('EN-AB 12');
    const resolve = await app.inject({
      method: 'POST',
      url: '/api/v1/dispatch/bolos/1/resolve',
      headers: owner,
      payload: { note: 'Gefunden' },
    });
    expect(resolve.json()).toMatchObject({ status: 'resolved' });

    const action = (payload: object) =>
      app.inject({ method: 'POST', url: '/api/v1/roblox/players/4711/actions', headers: owner, payload });
    expect((await action({ command: { action: 'jail' }, reason: 'Ohne Minuten' })).statusCode).toBe(400);
    expect((await action({ command: { action: 'fly' }, reason: 'Unbekannt' })).statusCode).toBe(400);
    expect((await action({ command: { action: 'heal' } })).statusCode).toBe(400); // Begründung fehlt
    const offline = await action({ command: { action: 'heal' }, reason: 'Spieler offline' });
    expect(offline.statusCode).toBe(400);
    expect(offline.json().error.message).toContain('online');
    expect((await app.inject({ url: '/api/v1/roblox/player-actions', headers: owner })).json().items).toEqual([]);
    await app.close();
  });
});
