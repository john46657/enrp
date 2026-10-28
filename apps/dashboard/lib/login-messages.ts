/** Verständliche Meldungen zu den Fehlercodes, die das Backend nach der Discord-Anmeldung zurückgibt. */
export const LOGIN_MESSAGES: Record<string, { tone: 'error' | 'warn' | 'info'; text: string }> = {
  not_configured: {
    tone: 'warn',
    text: 'Die Anmeldung mit Discord ist noch nicht eingerichtet. Wie das geht, steht in docs/discord-login.md.',
  },
  cancelled: { tone: 'info', text: 'Die Anmeldung wurde bei Discord abgebrochen.' },
  state_mismatch: {
    tone: 'warn',
    text: 'Die Anmeldung ist abgelaufen oder wurde in einem anderen Tab begonnen. Bitte erneut versuchen.',
  },
  discord_unavailable: {
    tone: 'error',
    text: 'Discord ist gerade nicht erreichbar. Bitte in ein paar Minuten erneut versuchen.',
  },
  login_failed: { tone: 'error', text: 'Die Anmeldung ist fehlgeschlagen. Bitte erneut versuchen.' },
  not_registered: {
    tone: 'warn',
    text: 'Dieses Discord-Konto ist nicht freigeschaltet. Bitte jemanden aus der Administration, dich unter „Benutzer und Rollen“ freizuschalten.',
  },
  account_disabled: { tone: 'error', text: 'Dieses Konto ist gesperrt. Wende dich an die Administration.' },
  expired: { tone: 'info', text: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.' },
  logged_out: { tone: 'info', text: 'Du wurdest abgemeldet.' },
};

export function loginMessage(code: string | undefined) {
  return code ? LOGIN_MESSAGES[code] : undefined;
}
