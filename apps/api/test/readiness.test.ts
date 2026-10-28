import { readinessResponseSchema } from '@emden/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDatabase, type DatabaseHandle } from '../src/db/database.js';
import { createTestDatabase } from './support/database.js';
import { testConfig } from './helpers.js';

async function ready(db: DatabaseHandle) {
  const app = await buildApp(testConfig(), { db });
  try {
    const res = await app.inject({ url: '/ready' });
    return { statusCode: res.statusCode, body: readinessResponseSchema.parse(res.json()) };
  } finally {
    await app.close();
  }
}

describe('GET /ready mit Datenbank', () => {
  let migrated: DatabaseHandle;
  let empty: DatabaseHandle;
  beforeAll(async () => {
    [migrated, empty] = await Promise.all([
      createTestDatabase(),
      openDatabase({ kind: 'pglite', dataDir: null }),
    ]);
  });
  afterAll(async () => {
    await migrated.close();
  });

  it('meldet "ready", wenn die Datenbank erreichbar und das Schema aktuell ist', async () => {
    const { statusCode, body } = await ready(migrated);
    expect(statusCode).toBe(200);
    expect(body.checks).toEqual([
      {
        name: 'database',
        status: 'ok',
        message: 'Testdatenbank im Arbeitsspeicher (PGlite), Schema-Version 1.',
      },
    ]);
  });

  it('meldet "not_ready", solange Migrationen ausstehen', async () => {
    const { statusCode, body } = await ready(empty);
    expect(statusCode).toBe(503);
    expect(body.checks[0]).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('npm run db:migrate'),
    });
  });

  it('meldet "not_ready", wenn die Datenbank nicht erreichbar ist – ohne interne Details', async () => {
    await empty.close();
    const { statusCode, body } = await ready(empty);
    expect(statusCode).toBe(503);
    expect(body.checks[0]).toEqual({
      name: 'database',
      status: 'failed',
      message: 'Testdatenbank im Arbeitsspeicher (PGlite) ist nicht erreichbar.',
    });
  });
});
