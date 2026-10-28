import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { rolesResponseSchema, usersResponseSchema } from '@emden/shared';
import { EmptyState } from '@/components/EmptyState';
import { Notice } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { callBackend, getSession, hasPermission } from '@/lib/backend';
import { formatDateTime } from '@/lib/format';
import { CreateUserForm } from './CreateUserForm';
import { RolePermissions } from './RolePermissions';
import { UserControls } from './UserControls';

export const metadata: Metadata = { title: 'Benutzer und Rollen' };

export default async function UsersPage() {
  const session = await getSession();
  if (session.state !== 'authenticated') redirect('/login?info=expired');
  const me = session.user;

  if (!hasPermission(me, 'users.read')) {
    return (
      <>
        <PageHeader title="Benutzer und Rollen" />
        <EmptyState title="Keine Berechtigung">
          <p>Für diesen Bereich brauchst du die Berechtigung „Benutzerliste ansehen“.</p>
        </EmptyState>
      </>
    );
  }

  const [usersResult, rolesResult] = await Promise.all([
    callBackend('/users', usersResponseSchema),
    hasPermission(me, 'roles.read') ? callBackend('/roles', rolesResponseSchema) : Promise.resolve(null),
  ]);
  if (!usersResult.ok) {
    if (usersResult.status === 401) redirect('/login?info=expired');
    throw new Error(usersResult.message);
  }
  const users = usersResult.data.users;
  const roles = rolesResult?.ok ? rolesResult.data : null;
  const canManage = hasPermission(me, 'users.manage');
  const assignable = (roles?.roles ?? [])
    .filter((role) => role.assignable)
    .map(({ key, name }) => ({ key, name }));

  return (
    <>
      <PageHeader
        title="Benutzer und Rollen"
        intro="Wer sich am Control Center anmelden darf und mit welchen Rechten. Die Anmeldung erfolgt über Discord."
      />

      {canManage && assignable.length > 0 ? (
        <section className="section" aria-labelledby="create-title">
          <h2 id="create-title">Person freischalten</h2>
          <p className="section__intro">
            Freigeschaltete Personen können sich mit dem Discord-Konto dieser ID anmelden. Vergeben kannst du
            nur Rollen unterhalb deiner eigenen.
          </p>
          <CreateUserForm roles={assignable} />
        </section>
      ) : canManage && !roles ? (
        <Notice tone="info">
          Zum Freischalten und Ändern von Rollen brauchst du zusätzlich die Berechtigung „Rollen und ihre
          Berechtigungen ansehen“.
        </Notice>
      ) : null}

      <section className="section" aria-labelledby="users-title">
        <h2 id="users-title">Freigeschaltete Personen</h2>
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">Freigeschaltete Personen mit Rolle und Status</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Rolle</th>
                <th scope="col">Status</th>
                <th scope="col">Letzte Anmeldung</th>
                {canManage ? <th scope="col">Verwalten</th> : null}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const manageable = canManage && user.id !== me.id && user.role.rank < me.role.rank;
                return (
                  <tr key={user.id}>
                    <td>
                      <span className="cell__primary">{user.displayName}</span>
                      <span className="cell__secondary">Discord-ID {user.discordUserId}</span>
                    </td>
                    <td>{user.role.name}</td>
                    <td>
                      {user.status === 'active' ? (
                        <StatusBadge tone="ok">Aktiv</StatusBadge>
                      ) : (
                        <StatusBadge tone="error">Gesperrt</StatusBadge>
                      )}
                    </td>
                    <td className="muted">
                      {user.lastLoginAt ? (
                        <time dateTime={user.lastLoginAt}>{formatDateTime(user.lastLoginAt)}</time>
                      ) : (
                        'Noch nie'
                      )}
                    </td>
                    {canManage ? (
                      <td>
                        {manageable ? (
                          <UserControls user={user} roles={assignable} />
                        ) : (
                          <span className="muted">
                            {user.id === me.id ? 'Das bist du' : 'Höhere oder gleiche Rolle'}
                          </span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {roles ? (
        <section className="section" aria-labelledby="roles-title">
          <h2 id="roles-title">Rollen und Berechtigungen</h2>
          <p className="section__intro">
            Der Owner hat immer alle Berechtigungen. Ändern kannst du nur Rollen unterhalb deiner eigenen und
            nur Berechtigungen, die du selbst hast. Jede Änderung wird im Audit-Log festgehalten.
          </p>
          <RolePermissions roles={roles.roles} permissions={roles.permissions} />
        </section>
      ) : null}
    </>
  );
}
