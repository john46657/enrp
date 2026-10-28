'use client';

import { useActionState } from 'react';
import { Notice } from '@/components/Notice';
import { SubmitButton } from '@/components/SubmitButton';
import { createUserAction } from './actions';
import { idle } from './state';

export function CreateUserForm({ roles }: { roles: { key: string; name: string }[] }) {
  const [state, action] = useActionState(createUserAction, idle);
  const fields = state.status === 'error' ? (state.fields ?? {}) : {};
  const values = state.status === 'error' ? (state.values ?? {}) : {};

  const errorId = (name: string) => (fields[name] ? `create-${name}-error` : undefined);

  return (
    <form action={action} className="form" noValidate>
      <div className="form__grid">
        <div className="field">
          <label htmlFor="create-discordUserId">Discord-ID</label>
          <input
            id="create-discordUserId"
            name="discordUserId"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={values.discordUserId ?? ''}
            aria-invalid={Boolean(fields.discordUserId)}
            aria-describedby={errorId('discordUserId') ?? 'create-discordUserId-help'}
            required
          />
          {fields.discordUserId ? (
            <p className="field__error" id="create-discordUserId-error">
              {fields.discordUserId}
            </p>
          ) : (
            <p className="field__help" id="create-discordUserId-help">
              17–20 Ziffern. In Discord: Entwicklermodus an, Rechtsklick auf die Person, „Benutzer-ID
              kopieren“.
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="create-displayName">Name</label>
          <input
            id="create-displayName"
            name="displayName"
            autoComplete="off"
            maxLength={64}
            defaultValue={values.displayName ?? ''}
            aria-invalid={Boolean(fields.displayName)}
            aria-describedby={errorId('displayName')}
            required
          />
          {fields.displayName ? (
            <p className="field__error" id="create-displayName-error">
              {fields.displayName}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="create-roleKey">Rolle</label>
          <select
            id="create-roleKey"
            name="roleKey"
            defaultValue={values.roleKey ?? roles.at(-1)?.key}
            aria-invalid={Boolean(fields.roleKey)}
            aria-describedby={errorId('roleKey')}
          >
            {roles.map((role) => (
              <option key={role.key} value={role.key}>
                {role.name}
              </option>
            ))}
          </select>
          {fields.roleKey ? (
            <p className="field__error" id="create-roleKey-error">
              {fields.roleKey}
            </p>
          ) : null}
        </div>
      </div>

      <div className="form__actions">
        <SubmitButton pendingText="Wird freigeschaltet …">Person freischalten</SubmitButton>
        {state.status === 'success' ? <Notice tone="success">{state.message}</Notice> : null}
        {state.status === 'error' && Object.keys(fields).length === 0 ? (
          <Notice tone="error">{state.message}</Notice>
        ) : null}
      </div>
    </form>
  );
}
