'use client';

import { useActionState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Notice } from '@/components/Notice';
import { SubmitButton } from '@/components/SubmitButton';
import { updateUserAction } from './actions';
import { idle, type FormState } from './state';

interface Props {
  user: { id: string; displayName: string; status: 'active' | 'disabled'; role: { key: string } };
  roles: { key: string; name: string }[];
}

/** Rolle ändern und sperren/entsperren – nur angezeigt, wenn die angemeldete Person das darf. */
export function UserControls({ user, roles }: Props) {
  const [roleState, roleAction] = useActionState(updateUserAction, idle);
  const [statusState, statusAction] = useActionState(updateUserAction, idle);
  const statusFormId = `status-${user.id}`;
  // Immer die neueste Rückmeldung zeigen – egal, welches der beiden Formulare zuletzt benutzt wurde.
  const feedback = [roleState, statusState]
    .filter((state): state is Exclude<FormState, { status: 'idle' }> => state.status !== 'idle')
    .sort((a, b) => b.at - a.at)[0];

  return (
    <div className="controls">
      {/* key: Nach einer Änderung neu aufbauen, damit die Auswahl die aktuelle Rolle zeigt. */}
      <form action={roleAction} className="controls__role" key={user.role.key}>
        <input type="hidden" name="userId" value={user.id} />
        <label className="sr-only" htmlFor={`role-${user.id}`}>
          Rolle von {user.displayName}
        </label>
        <select id={`role-${user.id}`} name="roleKey" defaultValue={user.role.key}>
          {roles.map((role) => (
            <option key={role.key} value={role.key}>
              {role.name}
            </option>
          ))}
        </select>
        <SubmitButton variant="secondary">Rolle speichern</SubmitButton>
      </form>

      <form action={statusAction} id={statusFormId}>
        <input type="hidden" name="userId" value={user.id} />
        <input type="hidden" name="status" value={user.status === 'active' ? 'disabled' : 'active'} />
        {user.status === 'active' ? null : <SubmitButton variant="secondary">Entsperren</SubmitButton>}
      </form>
      {user.status === 'active' ? (
        <ConfirmDialog
          formId={statusFormId}
          trigger="Sperren"
          title={`${user.displayName} sperren?`}
          confirmLabel="Sperren"
        >
          <p>
            {user.displayName} wird sofort abgemeldet und kann sich nicht mehr anmelden, bis jemand den Zugang
            wieder freischaltet. Die Aktion wird im Audit-Log festgehalten.
          </p>
        </ConfirmDialog>
      ) : null}

      {feedback ? (
        <div className="controls__feedback">
          <Notice tone={feedback.status === 'success' ? 'success' : 'error'}>{feedback.message}</Notice>
        </div>
      ) : null}
    </div>
  );
}
