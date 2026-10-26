import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { backups, decideApproval } from '@enrp/core';
import { runBackup, runRestore, sha256File } from '@enrp/worker/backup';
import { runWatchdog } from '@enrp/worker/watchdog';
import { pollMessage, suggestionMessage } from '@enrp/worker/messages';
import { community } from '@enrp/core';
import { closeDb, createTestContext, owner, resetDatabase, userWithRole } from './helpers';

const RESTORE_URL = process.env.TEST_RESTORE_DATABASE_URL ?? 'postgres://enrp:enrp@localhost:5432/enrp_restore_test';
let dir: string;

beforeEach(async () => {
  await resetDatabase();
  dir = await mkdtemp(path.join(os.tmpdir(), 'enrp-backup-'));
});
afterAll(async () => {
  await closeDb();
});

const cfg = (overrides = {}) => ({
  databaseUrl: process.env.TEST_DATABASE_URL!,
  dir,
  retentionDays: 7,
  pgDump: 'pg_dump',
  pgRestore: 'pg_restore',
  restoreTargets: {},
  allowProductionRestore: false,
  ...overrides,
});

describe('Backups (echtes pg_dump/pg_restore)', () => {
  it('erstellt, prüft und stellt ein Backup in eine Testdatenbank wieder her', async () => {
    const ctx = createTestContext();
    const result = await runBackup(ctx, cfg({ restoreTestUrl: RESTORE_URL }), { kind: 'manual', triggeredBy: 'test' });
    expect(result.status).toBe('succeeded');
    expect(result.verifiedAt).toBeTruthy();
    const verification = result.verification as { tables: string[]; restoreTest: { restored: boolean } };
    expect(verification.tables).toContain('audit_events');
    expect(verification.restoreTest.restored).toBe(true);
    expect(await sha256File(path.join(dir, result.fileName!))).toBe(result.sha256);
    const health = await backups.backupHealth(ctx.db, ctx.now());
    expect(health.consecutiveFailures).toBe(0);

    // Wiederherstellung braucht Antrag + Freigabe durch eine zweite Person.
    const a = await userWithRole(ctx, '900000000000000001', 'owner');
    const b = await userWithRole(ctx, '900000000000000002', 'owner');
    const { request, approval, preview } = await backups.requestRestore(ctx, a, { backupId: result.id, targetEnvironment: 'restore_test', reason: 'Wiederherstellungstest' });
    expect(preview.tables).toBeTruthy();
    await expect(runRestore(ctx, cfg({ restoreTestUrl: RESTORE_URL }), request.id)).rejects.toThrow(/nicht freigegeben/);
    await decideApproval(ctx, b, approval.id, 'approve', 'ok');
    const restored = await runRestore(ctx, cfg({ restoreTestUrl: RESTORE_URL }), request.id);
    expect(restored.status).toBe('succeeded');

    // Produktion ohne Freischaltung wird nicht automatisch überschrieben.
    const prod = await backups.requestRestore(ctx, a, { backupId: result.id, targetEnvironment: 'production', reason: 'Notfall' });
    await decideApproval(ctx, b, prod.approval.id, 'approve', 'ok');
    expect((await runRestore(ctx, cfg({ restoreTargets: { production: RESTORE_URL } }), prod.request.id)).status).toBe('manual_required');
    await rm(dir, { recursive: true, force: true });
  }, 60_000);

  it('fehlgeschlagenes Backup wird markiert, Datei entfernt und Automatisierung ausgelöst', async () => {
    const ctx = createTestContext();
    await expect(runBackup(ctx, cfg({ pgDump: '/nicht/vorhanden/pg_dump' }), { kind: 'manual', triggeredBy: 'test' })).rejects.toThrow();
    const health = await backups.backupHealth(ctx.db, ctx.now());
    expect(health.consecutiveFailures).toBe(1);
    expect(health.lastSuccessAt).toBeNull();
    expect((await runWatchdog(ctx)).fired).toContain('backup_failed');
  });

  it('manipulierte Backup-Datei wird bei der Wiederherstellung erkannt', async () => {
    const ctx = createTestContext();
    const result = await runBackup(ctx, cfg(), { kind: 'manual', triggeredBy: 'test' });
    await writeFile(path.join(dir, result.fileName!), 'manipuliert');
    const a = await owner(ctx);
    const b = await userWithRole(ctx, '900000000000000002', 'owner');
    const { request, approval } = await backups.requestRestore(ctx, a, { backupId: result.id, targetEnvironment: 'restore_test', reason: 'Test' });
    await decideApproval(ctx, b, approval.id, 'approve', 'ok');
    await expect(runRestore(ctx, cfg({ restoreTestUrl: RESTORE_URL }), request.id)).rejects.toThrow(/Prüfsumme/);
  }, 60_000);
});

describe('Discord-Nachrichten', () => {
  it('Vorschlags- und Umfragenachrichten enthalten Buttons und echte Zählstände', async () => {
    const ctx = createTestContext();
    const user = await userWithRole(ctx, '900000000000000005');
    const s = await community.createSuggestion(ctx, user, { title: 'Test', body: 'Inhalt' });
    await community.voteSuggestion(ctx, user, s.id, 1);
    const msg = await suggestionMessage(ctx, s.id);
    expect(msg.message.buttons.map((b) => b.customId)).toEqual([`sg:up:${s.id}`, `sg:down:${s.id}`]);
    expect(msg.message.embed.fields[0]!.value).toBe('1');
    const poll = await community.createPoll(ctx, await owner(ctx), { question: 'Frage?', options: ['A', 'B'] });
    const pm = await pollMessage(ctx, poll.id);
    expect(pm.message.buttons).toHaveLength(2);
  });
});
