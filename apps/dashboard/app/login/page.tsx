import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Anmelden' };

const ERRORS: Record<string, string> = {
  kein_zugriff: 'Dein Discord-Konto hat keine Rolle mit Zugriff auf die Verwaltung. Wende dich an die Serverleitung.',
  ungueltig: 'Die Anmeldung ist abgelaufen oder wurde in einem anderen Browser gestartet. Bitte erneut anmelden.',
  abgebrochen: 'Die Anmeldung bei Discord wurde abgebrochen.',
  nicht_konfiguriert:
    'Die Discord-Anmeldung ist noch nicht eingerichtet (DISCORD_CLIENT_ID und DISCORD_CLIENT_SECRET in der API setzen).',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}) {
  const { error, redirect } = await searchParams;
  const target = redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/';
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <span className="block h-6 w-1.5 rounded-sm bg-signal" aria-hidden />
          <span className="font-condensed text-2xl font-semibold">ENRP Verwaltung</span>
        </div>
        <h1 className="text-xl">Anmelden</h1>
        <p className="mt-1 text-muted">
          Die Verwaltung ist nur für das Team. Die Anmeldung erfolgt über dein Discord-Konto; Rechte ergeben sich aus
          deinen Rollen auf dem Server.
        </p>
        {error && (
          <p className="mt-4 rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm text-bad" role="alert">
            {ERRORS[error] ?? 'Die Anmeldung ist fehlgeschlagen.'}
          </p>
        )}
        <a
          href={`/api/v1/auth/discord/login?redirect=${encodeURIComponent(target)}`}
          className="mt-6 flex w-full items-center justify-center rounded-md bg-signal px-4 py-2.5 font-semibold text-signal-ink hover:brightness-110"
        >
          Mit Discord anmelden
        </a>
        <p className="mt-6 text-xs text-muted">
          Es werden nur Discord-ID, Name und Avatar verwendet. Sitzungen laufen nach 12 Stunden Inaktivität ab.
        </p>
      </div>
    </main>
  );
}
