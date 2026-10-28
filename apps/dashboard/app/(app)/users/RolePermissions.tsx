'use client';

import { useActionState } from 'react';
import { Notice } from '@/components/Notice';
import { SubmitButton } from '@/components/SubmitButton';
import { updateRolePermissionsAction } from './actions';
import { idle } from './state';

interface Role {
  key: string;
  name: string;
  permissions: string[];
  editable: boolean;
}
interface Permission {
  key: string;
  category: string;
  description: string;
}

function SaveRole({ role }: { role: Role }) {
  const [state, action] = useActionState(updateRolePermissionsAction, idle);
  return (
    <form action={action} id={`role-form-${role.key}`} className="matrix__save">
      <input type="hidden" name="role" value={role.key} />
      <SubmitButton variant="secondary">Speichern</SubmitButton>
      {state.status === 'idle' ? null : (
        <Notice tone={state.status === 'success' ? 'success' : 'error'}>{state.message}</Notice>
      )}
    </form>
  );
}

/**
 * Berechtigungen je Rolle als Tabelle. Bearbeitbar sind nur Rollen unterhalb der eigenen; Kästchen
 * gehören über das form-Attribut zum Speichern-Formular ihrer Spalte.
 */
export function RolePermissions({ roles, permissions }: { roles: Role[]; permissions: Permission[] }) {
  const anyEditable = roles.some((role) => role.editable);
  return (
    <div className="table-scroll">
      <table className="table matrix">
        <caption className="sr-only">Berechtigungen je Rolle</caption>
        <thead>
          <tr>
            <th scope="col">Berechtigung</th>
            {roles.map((role) => (
              <th scope="col" key={role.key}>
                {role.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {permissions.map((permission) => (
            <tr key={permission.key}>
              <th scope="row">
                <span className="matrix__permission">{permission.description}</span>
                <span className="matrix__key">{permission.key}</span>
              </th>
              {roles.map((role) => {
                const checked = role.permissions.includes(permission.key);
                return (
                  <td key={role.key}>
                    <input
                      // key mit gespeichertem Stand: Nach dem Speichern zeigt das Kästchen den neuen Stand.
                      key={`${permission.key}:${checked}`}
                      type="checkbox"
                      name="permissions"
                      value={permission.key}
                      form={`role-form-${role.key}`}
                      defaultChecked={checked}
                      disabled={!role.editable}
                      aria-label={`${permission.description} für ${role.name}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {anyEditable ? (
          <tfoot>
            <tr>
              <td />
              {roles.map((role) => (
                <td key={role.key}>{role.editable ? <SaveRole role={role} /> : null}</td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
