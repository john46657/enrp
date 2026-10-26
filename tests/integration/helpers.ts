import pino from 'pino';
import {
  MemoryQueue,
  buildUserActor,
  noopRealtime,
  type CoreContext,
  type DiscordGateway,
  type DiscordMemberInfo,
  type UserActor,
} from '@enrp/core';
import { createDatabase, seedDatabase, type DatabaseHandle, appRoles, roleBindings, eq } from '@enrp/database';

export const OWNER_ID = '100000000000000001';
export const GUILD_ID = '900000000000000001';

let handle: DatabaseHandle | null = null;

export function db(): DatabaseHandle {
  handle ??= createDatabase(process.env.TEST_DATABASE_URL!, { max: 5, applicationName: 'enrp-test' });
  return handle;
}

export async function closeDb() {
  await handle?.close();
  handle = null;
}

/** Leert alle Tabellen (inkl. geschütztem Audit-Log über die Wartungsmarkierung) und legt Grunddaten an. */
export async function resetDatabase() {
  const client = await db().pool.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`);
    await client.query('begin');
    await client.query(`set local enrp.audit_maintenance = 'on'`);
    await client.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(', ')} restart identity cascade`);
    await client.query('commit');
  } finally {
    client.release();
  }
  await seedDatabase(db().db);
}

/** Discord-Attrappe: zeichnet alle Aufrufe auf, Mitglieder werden über setMember hinterlegt. */
export class FakeDiscord implements DiscordGateway {
  readonly configured = true;
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  members = new Map<string, DiscordMemberInfo>();
  failNext: string | null = null;

  setMember(id: string, roleIds: string[] = [], username = `user${id.slice(-4)}`) {
    this.members.set(id, { id, username, globalName: null, avatarHash: null, roleIds });
  }
  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
    if (this.failNext === method) {
      this.failNext = null;
      throw new Error(`Discord-Fehler bei ${method}`);
    }
  }
  async getMember(_guildId: string, userId: string) {
    return this.members.get(userId) ?? null;
  }
  async addRole(...args: unknown[]) {
    this.record('addRole', args);
  }
  async removeRole(...args: unknown[]) {
    this.record('removeRole', args);
  }
  async timeout(...args: unknown[]) {
    this.record('timeout', args);
  }
  async kick(...args: unknown[]) {
    this.record('kick', args);
  }
  async ban(...args: unknown[]) {
    this.record('ban', args);
  }
  async unban(...args: unknown[]) {
    this.record('unban', args);
  }
  async sendMessage(...args: unknown[]) {
    this.record('sendMessage', args);
    return { id: '1' };
  }
  async editMessage(...args: unknown[]) {
    this.record('editMessage', args);
  }
  async sendDirectMessage(...args: unknown[]) {
    this.record('sendDirectMessage', args);
    return true;
  }
}

export interface TestContext extends CoreContext {
  queue: MemoryQueue;
  discord: FakeDiscord;
  clock: { now: Date };
}

export function createTestContext(overrides: Partial<CoreContext['config']> = {}): TestContext {
  const clock = { now: new Date('2026-06-01T12:00:00.000Z') };
  return {
    db: db().db,
    now: () => new Date(clock.now.getTime()),
    clock,
    queue: new MemoryQueue(),
    realtime: noopRealtime,
    logger: pino({ level: 'silent' }),
    discord: new FakeDiscord(),
    config: { ownerDiscordIds: [OWNER_ID], hashSecret: 'test-hash-secret-0123456789abcdef', guildId: GUILD_ID, appEnv: 'development', ...overrides },
  };
}

export function advance(ctx: TestContext, ms: number) {
  ctx.clock.now = new Date(ctx.clock.now.getTime() + ms);
}

/** Erstellt eine handelnde Person mit den Rechten der angegebenen Plattform-Rolle (per direkter Zuweisung). */
export async function userWithRole(ctx: CoreContext, discordUserId: string, roleKey?: string, discordRoleIds: string[] = []): Promise<UserActor> {
  if (roleKey) {
    const [role] = await ctx.db.select().from(appRoles).where(eq(appRoles.key, roleKey));
    if (!role) throw new Error(`Rolle ${roleKey} fehlt`);
    await ctx.db.insert(roleBindings).values({ roleId: role.id, discordUserId }).onConflictDoNothing();
  }
  return buildUserActor(ctx.db, ctx.config, { discordUserId, roleIds: discordRoleIds, via: 'bot' });
}

export const owner = (ctx: CoreContext) => buildUserActor(ctx.db, ctx.config, { discordUserId: OWNER_ID, roleIds: [], via: 'bot' });

export async function expectAppError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err) {
    const actual = (err as { code?: string }).code;
    if (actual !== code) throw new Error(`Erwartet Fehler ${code}, erhalten ${actual}: ${(err as Error).message}`);
    return err as Error;
  }
  throw new Error(`Erwartet Fehler ${code}, aber die Operation war erfolgreich.`);
}
