// Fragt einen FiveM-Server ab (fivem.address eines Servers, z. B. "123.45.67.89:30120").
async function fetchFivemStatus(address) {
  const base = `http://${address}`;
  try {
    const [dynamic, players] = await Promise.all(
      ['dynamic.json', 'players.json'].map(async (file) => {
        const res = await fetch(`${base}/${file}`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }),
    );
    return {
      online: true,
      hostname: dynamic.hostname,
      players: players.length,
      maxPlayers: Number(dynamic.sv_maxclients) || 0,
      playerList: players.map((p) => p.name),
    };
  } catch {
    return { online: false };
  }
}

module.exports = { fetchFivemStatus };
