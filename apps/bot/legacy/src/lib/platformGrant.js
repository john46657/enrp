// Plattform-Rechte für Altbefehle: Der neue Bot prüft jeden Altbefehl zuerst beim Rechtesystem der Plattform.
// Erlaubt die Plattform den Befehl (Recht, Rollen-Override oder Owner), gilt die Person für genau diese
// Befehlsausführung als Staff/Support – zusätzlich zu den bisherigen Staff-/Support-Rollen und Discord-Rechten.
const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

/** Führt fn mit Plattform-Freigabe für diese Person aus. */
function runWithGrant(userId, fn) {
  return storage.run({ userId }, fn);
}

/** Hat die Plattform der Person im laufenden Befehl Zugriff gegeben? */
function hasPlatformGrant(member) {
  const store = storage.getStore();
  return Boolean(store && member && (member.id === store.userId || member.user?.id === store.userId));
}

module.exports = { runWithGrant, hasPlatformGrant };
