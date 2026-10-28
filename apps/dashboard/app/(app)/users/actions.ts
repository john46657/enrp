'use server';

import { rolesResponseSchema, userResponseSchema } from '@emden/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { BackendUnavailableError, callBackend, type ApiResult } from '@/lib/backend';
import type { FormState } from './state';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_KEY = /^[a-z][a-z0-9_]{1,31}$/;

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();

/** Server Actions sind öffentlich aufrufbar – die Berechtigung prüft das Backend bei jeder Anfrage. */
async function send<T>(run: () => Promise<ApiResult<T>>, values?: Record<string, string>) {
  let result: ApiResult<T>;
  try {
    result = await run();
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      return {
        ok: false as const,
        state: { status: 'error', message: err.message, values, at: Date.now() } satisfies FormState,
      };
    }
    throw err;
  }
  if (result.ok) return { ok: true as const, data: result.data };
  if (result.status === 401) redirect('/login?info=expired');
  const fields = Object.fromEntries((result.fields ?? []).map((field) => [field.path, field.message]));
  return {
    ok: false as const,
    state: { status: 'error', message: result.message, fields, values, at: Date.now() } satisfies FormState,
  };
}

export async function createUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = {
    discordUserId: text(formData, 'discordUserId'),
    displayName: text(formData, 'displayName'),
    roleKey: text(formData, 'roleKey'),
  };
  const result = await send(
    () => callBackend('/users', userResponseSchema, { method: 'POST', body: values }),
    values,
  );
  if (!result.ok) return result.state;
  revalidatePath('/users');
  return {
    status: 'success',
    message: `${result.data.user.displayName} ist jetzt freigeschaltet.`,
    at: Date.now(),
  };
}

export async function updateUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = text(formData, 'userId');
  if (!UUID.test(id)) return { status: 'error', message: 'Ungültige Benutzer-ID.', at: Date.now() };
  const body: Record<string, string> = {};
  for (const key of ['roleKey', 'status'] as const) {
    const value = text(formData, key);
    if (value) body[key] = value;
  }
  const result = await send(() => callBackend(`/users/${id}`, userResponseSchema, { method: 'PATCH', body }));
  if (!result.ok) return result.state;
  revalidatePath('/users');
  const { user } = result.data;
  return {
    status: 'success',
    at: Date.now(),
    message:
      body.status === 'disabled'
        ? `${user.displayName} ist gesperrt und wurde abgemeldet.`
        : body.status === 'active'
          ? `${user.displayName} ist wieder freigeschaltet.`
          : `${user.displayName} hat jetzt die Rolle ${user.role.name}.`,
  };
}

export async function updateRolePermissionsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const role = text(formData, 'role');
  if (!ROLE_KEY.test(role)) return { status: 'error', message: 'Ungültige Rolle.', at: Date.now() };
  const permissions = formData.getAll('permissions').map(String);
  const result = await send(() =>
    callBackend(`/roles/${role}/permissions`, rolesResponseSchema, { method: 'PUT', body: { permissions } }),
  );
  if (!result.ok) return result.state;
  revalidatePath('/users');
  return { status: 'success', message: 'Gespeichert.', at: Date.now() };
}
