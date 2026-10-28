import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createApproval,
  decideApproval,
  permissionsAdmin,
  setFlag,
  updateSetting,
  verifyAuditChain,
  writeAudit,
  systemActor,
  expireApprovals,
  getApproval,
} from '@enrp/core';
import { auditEvents, appRoles, eq, rolePermissions, sql } from '@enrp/database';
import { advance, closeDb, createTestContext, db, expectAppError, owner, resetDatabase, userWithRole } from './helpers';

const ADMIN = '200000000000000001';
const ADMIN2 = '200000000000000002';
const MOD = '200000000000000003';

beforeEach(resetDatabase);
afterAll(closeDb);

describe('Audit-Log', () => {
  it('bildet eine prüfbare Hash-Kette und erkennt Manipulationen', async () => {
    const ctx = createTestContext();
    for (let i = 0; i < 5; i++) {
      await writeAudit(
        ctx.db,
        systemActor('test'),
        { action: 'test.event', resourceType: 'test', resourceId: i, after: { i, nested: { b: 1, a: [1, 2] } } },
        ctx.now(),
      );
    }
    expect(await verifyAuditChain(ctx.db)).toMatchObject({ ok: true, checked: 5 });

    // Direkte Änderungen werden durch den Trigger blockiert …
    await expect(ctx.db.execute(sql`update audit_events set action = 'x'`)).rejects.toThrow();
    await expect(ctx.db.execute(sql`delete from audit_events`)).rejects.toThrow();

    // … und selbst wenn jemand den Trigger umgeht, fällt die Änderung bei der Prüfung auf.
    const client = await db().pool.connect();
    try {
      await client.query('alter table audit_events disable trigger audit_events_no_update');
      await client.query(`update audit_events set after = '{"i": 99}' where id = 3`);
      await client.query('alter table audit_events enable trigger audit_events_no_update');
    } finally {
      client.release();
    }
    const result = await verifyAuditChain(ctx.db);
    expect(result.ok).toBe(false);
    expect(result.brokenAt?.id).toBe(3);
  });
});

describe('Vier-Augen-Prinzip', () => {
  it('verhindert Selbstfreigabe, führt genau einmal aus und lehnt abgelaufene Anfragen ab', async () => {
    const ctx = createTestContext();
    const requester = await userWithRole(ctx, ADMIN, 'owner');
    const approver = await userWithRole(ctx, ADMIN2, 'owner');
    const [role] = await ctx.db.select().from(appRoles).where(eq(appRoles.key, 'read_only'));
    const approval = await createApproval(ctx, requester, {
      actionType: 'permissions.role.update',
      summary: 'Test',
      payload: { roleId: role!.id, grants: [{ permission: 'tickets:view' }] },
      reason: 'Testfreigabe',
    });

    await expectAppError(decideApproval(ctx, requester, approval.id, 'approve', 'selbst'), 'SELF_ACTION_FORBIDDEN');
    const executed = await decideApproval(ctx, approver, String(approval.number), 'approve', 'passt');
    expect(executed.status).toBe('executed');
    const grants = await ctx.db.select().from(rolePermissions).where(eq(rolePermissions.roleId, role!.id));
    expect(grants.map((g) => g.permission)).toEqual(['tickets:view']);
    // Bereits ausgeführte Freigaben können nicht erneut verwendet werden.
    await expectAppError(decideApproval(ctx, approver, approval.id, 'approve', 'nochmal'), 'INVALID_STATE');

    const second = await createApproval(ctx, requester, {
      actionType: 'permissions.role.update',
      summary: 'Test 2',
      payload: { roleId: role!.id, grants: [] },
      reason: 'läuft ab',
      ttlHours: 1,
    });
    advance(ctx, 2 * 3600_000);
    await expectAppError(decideApproval(ctx, approver, second.id, 'approve', 'zu spät'), 'GONE');
    expect(await expireApprovals(ctx.db, ctx.now())).toBe(0); // bereits beim Versuch als abgelaufen markiert
  });

  it('auch die genehmigende Person darf keine Rechte freigeben, die sie selbst nicht hat', async () => {
    const ctx = createTestContext();
    const requester = await userWithRole(ctx, ADMIN, 'owner');
    // Genehmigungsrecht, aber keine Backup-Rechte
    const approver = await userWithRole(ctx, MOD);
    approver.subject.grants = [{ permission: 'approvals:approve' }, { permission: 'permissions:approve' }];
    const [role] = await ctx.db.select().from(appRoles).where(eq(appRoles.key, 'read_only'));
    const approval = await createApproval(ctx, requester, {
      actionType: 'permissions.role.update',
      summary: 'Backup-Rechte vergeben',
      payload: { roleId: role!.id, grants: [{ permission: 'backups:approve' }] },
      reason: 'Test',
    });
    await expectAppError(decideApproval(ctx, approver, approval.id, 'approve', 'ok'), 'ESCALATION_DENIED');
    expect((await getApproval(ctx.db, approval.id))!.status).toBe('pending');
  });

  it('der DB-Constraint verhindert Selbstfreigabe auch bei direkten Schreibzugriffen', async () => {
    const ctx = createTestContext();
    const requester = await userWithRole(ctx, ADMIN, 'owner');
    const approval = await createApproval(ctx, requester, {
      actionType: 'permissions.role.update',
      summary: 'x',
      payload: { roleId: '00000000-0000-0000-0000-000000000000', grants: [] },
      reason: 'Constraint-Test',
    });
    await expect(
      ctx.db.execute(sql`update approval_requests set decided_by = ${ADMIN} where id = ${approval.id}`),
    ).rejects.toThrow();
  });
});

describe('Rechteverwaltung', () => {
  it('verhindert Rechteausweitung und verlangt Freigaben für kritische Rechte', async () => {
    const ctx = createTestContext();
    // Moderationsleitung mit permissions:edit, aber ohne Backup-Rechte
    const [modRole] = await ctx.db.select().from(appRoles).where(eq(appRoles.key, 'moderation'));
    await ctx.db.insert(rolePermissions).values({ roleId: modRole!.id, permission: 'permissions:edit' });
    const lead = await userWithRole(ctx, MOD, 'moderation');

    await expectAppError(
      permissionsAdmin.updateRoleGrants(ctx, lead, 'read_only', [{ permission: 'backups:approve' }], 'Versuch'),
      'ESCALATION_DENIED',
    );
    const applied = await permissionsAdmin.updateRoleGrants(
      ctx,
      lead,
      'read_only',
      [{ permission: 'tickets:view' }],
      'ok',
    );
    expect(applied.status).toBe('applied');
    // Entfernen/Vergeben kritischer Rechte (permissions:edit) → Freigabe nötig
    const critical = await permissionsAdmin.updateRoleGrants(
      ctx,
      lead,
      'read_only',
      [{ permission: 'tickets:view' }, { permission: 'permissions:edit' }],
      'kritisch',
    );
    expect(critical.status).toBe('approval_required');

    // Owner-Rolle ist geschützt
    await expectAppError(permissionsAdmin.updateRoleGrants(ctx, lead, 'owner', [], 'x'), 'FORBIDDEN');
  });

  it('Befehls-Overrides: gesperrte Befehle bleiben gesperrt, Deny wirkt sofort', async () => {
    const ctx = createTestContext();
    const admin = await owner(ctx);
    await expectAppError(
      permissionsAdmin.setCommandOverride(
        ctx,
        admin,
        { command: 'permissions grant', discordRoleId: '300000000000000001', effect: 'allow' },
        'versuch',
      ),
      'ESCALATION_DENIED',
    );
    await permissionsAdmin.setCommandOverride(
      ctx,
      admin,
      { command: 'mod', discordRoleId: '300000000000000001', effect: 'deny' },
      'Sperre',
    );
    const modActor = await userWithRole(ctx, MOD, 'moderation', ['300000000000000001']);
    const access = await permissionsAdmin.checkCommandAccess(ctx.db, ctx.config.ownerDiscordIds, {
      command: 'mod warn',
      discordUserId: MOD,
      roleIds: ['300000000000000001'],
      subject: modActor.subject,
    });
    expect(access).toMatchObject({ allowed: false, source: 'override-deny' });
    const reset = await permissionsAdmin.removeCommandOverride(ctx, admin, { command: 'mod' }, 'zurücksetzen');
    expect(reset.removed).toBe(1);
  });
});

describe('Feature-Flags & Einstellungen', () => {
  it('protokolliert Änderungen mit Versionen und Begründung', async () => {
    const ctx = createTestContext();
    const admin = await owner(ctx);
    await setFlag(ctx, admin, { key: 'kill_switch', enabled: true, reason: 'Notfall' });
    await setFlag(ctx, admin, { key: 'kill_switch', enabled: false, reason: 'Entwarnung' });
    const events = await ctx.db.select().from(auditEvents).where(eq(auditEvents.resourceId, 'kill_switch'));
    expect(events.map((e) => e.action)).toEqual(['killswitch.activate', 'killswitch.deactivate']);

    await expectAppError(updateSetting(ctx, admin, 'duty', { maxSessionHours: 999 }, 'zu hoch'), 'BAD_REQUEST');
    const updated = await updateSetting(
      ctx,
      admin,
      'duty',
      { maxSessionHours: 8, clockSkewToleranceSeconds: 60, serverTimeoutSeconds: 120 },
      'kürzer',
    );
    expect(updated.version).toBe(1);

    const reader = await userWithRole(ctx, ADMIN, 'read_only');
    await expectAppError(setFlag(ctx, reader, { key: 'tickets', enabled: false, reason: 'x' }), 'FORBIDDEN');
  });
});
