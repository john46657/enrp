import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { BRAND } from '@emden/shared';
import { Notice } from '@/components/Notice';
import { BackendUnavailableError, callBackend, getSession } from '@/lib/backend';
import { dashboardOrigin } from '@/lib/config';
import { loginMessage } from '@/lib/login-messages';

export const metadata: Metadata = { title: 'Anmelden' };

const statusSchema = z.object({ discordLogin: z.enum(['configured', 'not_configured']) });

/** Nur Pfade innerhalb des Dashboards; das Backend prüft zusätzlich. */
function safePath(value: unknown): string {
  return typeof value === 'string' && /^\/(?![/\\])[^\s\\]*$/.test(value) && !value.startsWith('/login')
    ? value
    : '/';
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const returnTo = safePath(params.returnTo);
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const session = await getSession();
  if (session.state === 'authenticated') redirect(returnTo);

  let configured: boolean | null = null;
  try {
    const status = await callBackend('/auth/status', statusSchema);
    configured = status.ok ? status.data.discordLogin === 'configured' : null;
  } catch (err) {
    if (!(err instanceof BackendUnavailableError)) throw err;
  }
  const message = loginMessage(first(params.error) ?? first(params.info));

  // Cookies gelten nur für genau eine Adresse: "localhost" und "127.0.0.1" sind für den Browser verschieden.
  // Wird das Control Center unter einer anderen Adresse geöffnet als eingestellt, würde die Anmeldung scheitern.
  const canonical = new URL(dashboardOrigin());
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const wrongHost = process.env.NODE_ENV !== 'production' && host !== null && host !== canonical.host;
  const loginHref = `/api/auth/discord/login${returnTo === '/' ? '' : `?returnTo=${encodeURIComponent(returnTo)}`}`;

  return (
    <main id="main" className="login" tabIndex={-1}>
      <div className="login__panel">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <span>
            <span className="brand__name">{BRAND.name}</span>
            <span className="brand__sub">Control Center</span>
          </span>
        </div>

        <h1>Anmelden</h1>
        <p className="login__intro">
          Melde dich mit deinem Discord-Konto an. Zugang hat nur, wer freigeschaltet wurde.
        </p>

        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

        {wrongHost ? (
          <Notice tone="warn">
            Bitte öffne das Control Center unter <a href={`${canonical.origin}/login`}>{canonical.origin}</a>.
            Unter dieser Adresse ({host}) funktioniert die Anmeldung nicht, weil der Browser Anmelde-Cookies
            nur für genau eine Adresse speichert.
          </Notice>
        ) : session.state === 'unreachable' || configured === null ? (
          <Notice tone="error">
            Das Backend ist nicht erreichbar. Starte es mit <code>npm run dev:api</code> und lade die Seite
            neu.
          </Notice>
        ) : configured ? (
          <a className="button button--primary login__button" href={loginHref}>
            Mit Discord anmelden
          </a>
        ) : (
          <Notice tone="warn">
            Die Anmeldung mit Discord ist noch nicht eingerichtet. Trage <code>DISCORD_CLIENT_ID</code> und{' '}
            <code>DISCORD_CLIENT_SECRET</code> in die <code>.env</code> ein und starte das Backend neu. Die
            Schritt-für-Schritt-Anleitung steht in <code>docs/discord-login.md</code>.
          </Notice>
        )}

        <p className="login__privacy">
          Verwendet werden nur deine Discord-ID und dein Anzeigename. Keine E-Mail-Adresse, kein Passwort.
        </p>
      </div>
    </main>
  );
}
