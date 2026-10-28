'use server';

import { isSecureOrigin, sessionCookieName } from '@emden/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { BackendUnavailableError, callBackend } from '@/lib/backend';
import { dashboardOrigin } from '@/lib/config';

/** Abmelden: Sitzung im Backend beenden (Audit-Log) und das Cookie im Browser löschen. */
export async function logout(): Promise<void> {
  try {
    await callBackend('/auth/logout', null, { method: 'POST' });
  } catch (err) {
    // Auch wenn das Backend gerade nicht erreichbar ist, wird das Cookie im Browser entfernt.
    if (!(err instanceof BackendUnavailableError)) throw err;
  }
  const origin = dashboardOrigin();
  (await cookies()).set(sessionCookieName(origin), '', {
    maxAge: 0,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureOrigin(origin),
  });
  redirect('/login?info=logged_out');
}
