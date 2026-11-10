// Befehle vom Bot an das Spiel. Jeder Spielserver fragt alle paar Sekunden nach (GET /bridge/v1/sync) und bekommt
// die neuen Befehle für sich. Ziel eines Befehls:
//   "all"            alle Server (nur Haupt-Discord)
//   "owner:<id>"     alle Privatserver dieses Besitzers
//   "job:<JobId>"    genau ein Server (Spieler-Befehle – der Server, auf dem der Spieler gerade ist)
// Befehle verfallen nach 60 Sekunden. Das Spiel bestätigt jeden Befehl mit einem „ack“-Ereignis.
const crypto = require('node:crypto');

const TTL_MS = 60_000;
const BOOT = crypto.randomUUID(); // ändert sich bei jedem Bot-Start → Spiel setzt seinen Zähler zurück
let seq = 0;
const queue = [];
const versions = { bans: Date.now() };

function prune(now = Date.now()) {
  while (queue.length && now - queue[0].at > TTL_MS) queue.shift();
}

function enqueue(target, action, data = {}) {
  if (!/^(all|owner:\d+|job:[\w-]{1,64})$/.test(target)) throw new Error(`Ungültiges Ziel: ${target}`);
  seq += 1;
  queue.push({ seq, at: Date.now(), target, action, data });
  prune();
  return seq;
}

const matches = (target, job, ownerId) => target === 'all' || (ownerId && target === `owner:${ownerId}`) || target === `job:${job}`;

// cursor: letzter bekannter Zähler des Servers. Neuer Server oder neuer Bot-Start → nur den Zähler liefern,
// keine alten Befehle nachholen.
function pull({ job, ownerId, cursor, boot }) {
  prune();
  const fresh = boot !== BOOT || !Number.isInteger(cursor) || cursor < 0 || cursor > seq;
  const commands = fresh ? [] : queue.filter((c) => c.seq > cursor && matches(c.target, job, ownerId)).map((c) => ({ action: c.action, ...c.data }));
  return { boot: BOOT, cursor: seq, commands, bansVersion: versions.bans };
}

const bumpBans = () => {
  versions.bans = Math.max(versions.bans + 1, Date.now());
};

const pendingCount = () => {
  prune();
  return queue.length;
};

module.exports = { BOOT, TTL_MS, enqueue, pull, bumpBans, pendingCount, versions };
