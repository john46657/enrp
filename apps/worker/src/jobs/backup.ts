import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { automations, backups, systemActor, writeAudit, type CoreContext } from '@enrp/core';
import { and, backupRuns, eq, isNull, lt, restoreRequests } from '@enrp/database';

export interface BackupConfig {
  databaseUrl: string;
  dir: string;
  retentionDays: number;
  pgDump: string;
  pgRestore: string;
  restoreTestUrl?: string;
  restoreTargets: Partial<Record<'development' | 'staging' | 'production', string>>;
  allowProductionRestore: boolean;
}

/** Startet ein Programm ohne Shell (keine Befehlsinjektion möglich) und sammelt stderr/stdout. */
export function run(
  cmd: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${path.basename(cmd)} beendet mit Code ${code}: ${stderr.trim().slice(0, 500)}`)),
    );
  });
}

/** Zerlegt eine Postgres-URL in Verbindungsparameter; das Passwort geht nur über PGPASSWORD an das Programm. */
export function pgConnection(url: string) {
  const u = new URL(url);
  return {
    args: [
      '--host',
      u.hostname,
      '--port',
      u.port || '5432',
      '--username',
      decodeURIComponent(u.username),
      '--dbname',
      u.pathname.slice(1),
    ],
    env: {
      PGPASSWORD: decodeURIComponent(u.password),
      PGSSLMODE: u.searchParams.get('sslmode') ?? process.env.PGSSLMODE ?? 'prefer',
    },
  };
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Liest das Inhaltsverzeichnis eines Dumps und zählt Tabellen-Daten-Einträge (Integritätsprüfung). */
export async function inspectDump(pgRestore: string, file: string) {
  const { stdout } = await run(pgRestore, ['--list', file]);
  const tables = stdout
    .split('\n')
    .filter((l) => / TABLE DATA /.test(l))
    .map((l) => l.trim().split(/\s+/).slice(-2, -1)[0] ?? '')
    .filter(Boolean);
  return { entries: stdout.split('\n').filter((l) => l && !l.startsWith(';')).length, tables };
}

/**
 * Erstellt ein Backup (pg_dump, Custom-Format), prüft es (SHA-256 erneut gelesen, pg_restore --list,
 * optional vollständiger Wiederherstellungstest) und markiert es erst danach als erfolgreich.
 */
export async function runBackup(ctx: CoreContext, cfg: BackupConfig, input: { kind: string; triggeredBy: string }) {
  const run_ = await backups.startBackupRun(ctx.db, input);
  const fileName = `enrp-${ctx.now().toISOString().replace(/[:.]/g, '-')}.dump`;
  const file = path.resolve(cfg.dir, fileName);
  try {
    await mkdir(cfg.dir, { recursive: true, mode: 0o700 });
    const conn = pgConnection(cfg.databaseUrl);
    await run(cfg.pgDump, [...conn.args, '--format=custom', '--no-owner', '--no-privileges', '--file', file], conn.env);
    await chmod(file, 0o600);
    const { size } = await stat(file);
    const sha256 = await sha256File(file);
    await backups.markBackupVerifying(ctx.db, run_.id, {
      fileName,
      storageLocation: path.resolve(cfg.dir),
      sizeBytes: size,
      sha256,
    });

    // Prüfung 1: Datei unverändert lesbar, Prüfsumme stimmt.
    if ((await sha256File(file)) !== sha256) throw new Error('Prüfsumme weicht beim erneuten Lesen ab.');
    // Prüfung 2: Archiv ist für pg_restore lesbar und enthält Tabellendaten.
    const listing = await inspectDump(cfg.pgRestore, file);
    if (!listing.tables.length) throw new Error('Das Backup enthält keine Tabellendaten.');
    // Prüfung 3 (optional): Vollständige Wiederherstellung in eine Testdatenbank.
    let restoreTest: Record<string, unknown> | null = null;
    if (cfg.restoreTestUrl) restoreTest = await restoreInto(cfg, file, cfg.restoreTestUrl);

    const completed = await backups.completeBackupRun(ctx.db, run_.id, {
      verification: { sha256Verified: true, entries: listing.entries, tables: listing.tables, restoreTest },
      expiresAt: new Date(ctx.now().getTime() + cfg.retentionDays * 86400_000),
      now: ctx.now(),
    });
    await writeAudit(
      ctx.db,
      systemActor('backup'),
      {
        action: 'backup.succeeded',
        resourceType: 'backup',
        resourceId: run_.id,
        metadata: { fileName, size, tables: listing.tables.length },
      },
      ctx.now(),
    );
    return completed;
  } catch (err) {
    const message = (err as Error).message;
    await backups.failBackupRun(ctx.db, run_.id, message, ctx.now());
    await rm(file, { force: true });
    await writeAudit(
      ctx.db,
      systemActor('backup'),
      {
        action: 'backup.failed',
        resourceType: 'backup',
        resourceId: run_.id,
        metadata: { error: message.slice(0, 300) },
      },
      ctx.now(),
    );
    const health = await backups.backupHealth(ctx.db, ctx.now());
    await automations.fireTrigger(ctx, 'backup_failed', {
      count: health.consecutiveFailures,
      summary: `Backup fehlgeschlagen: ${message.slice(0, 300)}`,
      dedupeKey: 'backup',
    });
    ctx.realtime.publish('alerts', 'backup.failed', { backupId: run_.id });
    throw err;
  }
}

async function restoreInto(cfg: BackupConfig, file: string, targetUrl: string) {
  const conn = pgConnection(targetUrl);
  const started = Date.now();
  await run(
    cfg.pgRestore,
    [
      ...conn.args,
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--single-transaction',
      '--exit-on-error',
      file,
    ],
    conn.env,
  );
  return { restored: true, durationMs: Date.now() - started, target: new URL(targetUrl).pathname.slice(1) };
}

/** Führt eine freigegebene Wiederherstellung aus. Produktion nur mit ausdrücklicher Freischaltung. */
export async function runRestore(ctx: CoreContext, cfg: BackupConfig, restoreRequestId: string) {
  const [request] = await ctx.db.select().from(restoreRequests).where(eq(restoreRequests.id, restoreRequestId));
  if (!request || request.status !== 'approved') throw new Error('Wiederherstellung ist nicht freigegeben.');
  const backup = await backups.getBackup(ctx.db, request.backupId);
  const file = path.join(backup.storageLocation ?? cfg.dir, backup.fileName ?? '');
  if ((await sha256File(file)) !== backup.sha256) {
    await backups.updateRestoreRequest(ctx.db, request.id, 'failed', {
      error: 'Prüfsumme stimmt nicht – Backup beschädigt',
    });
    throw new Error('Prüfsumme des Backups stimmt nicht.');
  }
  const target =
    request.targetEnvironment === 'restore_test'
      ? cfg.restoreTestUrl
      : cfg.restoreTargets[request.targetEnvironment as 'development' | 'staging' | 'production'];
  const productionBlocked = request.targetEnvironment === 'production' && !cfg.allowProductionRestore;
  if (!target || productionBlocked) {
    // Ohne konfiguriertes Ziel wird nichts automatisch überschrieben: manueller Ablauf laut docs/operations.md.
    await backups.updateRestoreRequest(ctx.db, request.id, 'manual_required', {
      ...(request.preview as object),
      instructions:
        'Automatische Wiederherstellung für dieses Ziel nicht freigeschaltet. Manuellen Ablauf in docs/operations.md befolgen.',
    });
    await writeAudit(
      ctx.db,
      systemActor('backup'),
      { action: 'backup.restore.manual_required', resourceType: 'restore_request', resourceId: request.id },
      ctx.now(),
    );
    return { status: 'manual_required' };
  }
  await backups.updateRestoreRequest(ctx.db, request.id, 'running');
  try {
    const result = await restoreInto(cfg, file, target);
    await backups.updateRestoreRequest(ctx.db, request.id, 'succeeded', { ...(request.preview as object), result });
    await writeAudit(
      ctx.db,
      systemActor('backup'),
      { action: 'backup.restore.succeeded', resourceType: 'restore_request', resourceId: request.id, metadata: result },
      ctx.now(),
    );
    return { status: 'succeeded', ...result };
  } catch (err) {
    await backups.updateRestoreRequest(ctx.db, request.id, 'failed', {
      ...(request.preview as object),
      error: (err as Error).message.slice(0, 500),
    });
    throw err;
  }
}

/** Löscht abgelaufene Backup-Dateien (Aufbewahrungsregel) und markiert sie in der Datenbank. */
export async function pruneBackups(ctx: CoreContext, cfg: BackupConfig) {
  const expired = await ctx.db
    .select()
    .from(backupRuns)
    .where(and(lt(backupRuns.expiresAt, ctx.now()), isNull(backupRuns.deletedAt)));
  let removed = 0;
  for (const b of expired) {
    if (b.fileName) await rm(path.join(b.storageLocation ?? cfg.dir, b.fileName), { force: true });
    await ctx.db.update(backupRuns).set({ deletedAt: ctx.now() }).where(eq(backupRuns.id, b.id));
    removed++;
  }
  // Fehlgeschlagene Läufe hinterlassen keine Dateien; verwaiste Dateien werden nur gemeldet, nicht gelöscht.
  const files = await readdir(cfg.dir).catch(() => [] as string[]);
  return { removed, filesOnDisk: files.filter((f) => f.endsWith('.dump')).length };
}
