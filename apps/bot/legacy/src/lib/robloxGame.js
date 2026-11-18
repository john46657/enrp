// Fragt ein Roblox-Spiel ab (roblox.game eines Servers: Place-ID oder Spiel-Link). Öffentliche Roblox-API, kein Key nötig.
// Spielernamen gibt Roblox öffentlich nicht heraus – nur Anzahl, Server und Besuche.

// „123456“, „https://www.roblox.com/games/123456/Mein-Spiel“ oder „roblox.com/de/games/123456“ → "123456"
function parsePlaceId(text) {
  const value = String(text ?? '').trim();
  if (/^\d{1,20}$/.test(value)) return value;
  return /roblox\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?games\/(\d{1,20})/i.exec(value)?.[1] ?? null;
}

const gameUrl = (placeId) => `https://www.roblox.com/games/${placeId}`;

async function request(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Roblox antwortet mit HTTP ${res.status}`);
  return res.json();
}

const universes = new Map(); // placeId → universeId (ändert sich nie)

// Gibt { online: true, name, playing, maxPlayers, servers, visits, url } zurück, { online: false } wenn Roblox nicht antwortet.
// servers ist höchstens 100 (eine Seite der Serverliste), more = es gibt noch mehr.
async function fetchRobloxStatus(game) {
  const placeId = parsePlaceId(game);
  if (!placeId) return { online: false };
  try {
    if (!universes.has(placeId)) universes.set(placeId, (await request(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`)).universeId);
    const universeId = universes.get(placeId);
    if (!universeId) return { online: false };
    const [{ data }, servers] = await Promise.all([
      request(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
      request(`https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100`).catch(() => null),
    ]);
    const info = data?.[0];
    if (!info) return { online: false };
    return {
      online: true,
      name: info.name,
      playing: info.playing ?? 0,
      maxPlayers: info.maxPlayers ?? 0,
      visits: info.visits ?? 0,
      servers: servers ? servers.data.length : null,
      more: Boolean(servers?.nextPageCursor),
      url: gameUrl(placeId),
    };
  } catch {
    return { online: false };
  }
}

module.exports = { parsePlaceId, gameUrl, fetchRobloxStatus };
