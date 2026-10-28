import { z } from 'zod';

/**
 * Antwortformate der Verwaltungs-API. Das Backend serialisiert genau diese Felder (alles andere wird
 * verworfen), das Dashboard prüft eingehende Daten dagegen.
 */

export const discordUserIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{17,20}$/, 'Die Discord-ID besteht aus 17 bis 20 Ziffern.');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Bitte einen Namen angeben.')
  .max(64, 'Der Name darf höchstens 64 Zeichen lang sein.');

export const roleRefSchema = z.object({ key: z.string(), name: z.string(), rank: z.number().int() });

export const currentUserSchema = z.object({
  id: z.uuid(),
  discordUserId: z.string(),
  displayName: z.string(),
  role: roleRefSchema,
  permissions: z.array(z.string()),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;
export const meResponseSchema = z.object({ user: currentUserSchema });

export const userStatusSchema = z.enum(['active', 'disabled']);

export const managedUserSchema = z.object({
  id: z.uuid(),
  discordUserId: z.string(),
  displayName: z.string(),
  role: roleRefSchema,
  status: userStatusSchema,
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
});
export type ManagedUser = z.infer<typeof managedUserSchema>;
export const usersResponseSchema = z.object({ users: z.array(managedUserSchema) });
export const userResponseSchema = z.object({ user: managedUserSchema });

export const createUserRequestSchema = z.object({
  discordUserId: discordUserIdSchema,
  displayName: displayNameSchema,
  roleKey: z.string().min(1, 'Bitte eine Rolle wählen.'),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    roleKey: z.string().min(1).optional(),
    status: userStatusSchema.optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), 'Es wurde nichts geändert.');
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const roleSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  rank: z.number().int(),
  permissions: z.array(z.string()),
  /** Darf die anfragende Person die Berechtigungen dieser Rolle ändern? */
  editable: z.boolean(),
  /** Darf die anfragende Person diese Rolle an andere vergeben? */
  assignable: z.boolean(),
});
export type Role = z.infer<typeof roleSchema>;
export const permissionInfoSchema = z.object({
  key: z.string(),
  category: z.string(),
  description: z.string(),
});
export const rolesResponseSchema = z.object({
  roles: z.array(roleSchema),
  permissions: z.array(permissionInfoSchema),
});

export const updateRolePermissionsRequestSchema = z.object({
  permissions: z.array(z.string()).max(100),
});

export const auditEntrySchema = z.object({
  id: z.number().int(),
  occurredAt: z.iso.datetime(),
  actorType: z.enum(['user', 'system', 'cli']),
  actorLabel: z.string(),
  action: z.string(),
  actionLabel: z.string(),
  outcome: z.enum(['success', 'denied', 'failure']),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export const auditLogResponseSchema = z.object({
  entries: z.array(auditEntrySchema),
  /** Für "Ältere Einträge laden": als ?before= übergeben. null = keine weiteren Einträge. */
  nextBefore: z.number().int().nullable(),
});
