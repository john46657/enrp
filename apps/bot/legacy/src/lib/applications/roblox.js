// Sucht Roblox-Konten über die öffentliche Roblox-API (kein API-Key nötig).
async function request(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Roblox antwortet mit HTTP ${res.status}`);
  return res.json();
}

// Gibt { id, name, displayName, avatarUrl } zurück, null wenn es den Namen nicht gibt; wirft bei Netzwerkfehlern.
async function findRobloxUser(username) {
  const { data } = await request('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
  });
  const user = data?.[0];
  if (!user) return null;
  let avatarUrl = null;
  try {
    const thumbs = await request(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png`);
    avatarUrl = thumbs.data?.[0]?.imageUrl ?? null;
  } catch {
    // Profilbild ist optional
  }
  return { id: String(user.id), name: user.name, displayName: user.displayName, avatarUrl };
}

const profileUrl = (id) => `https://www.roblox.com/users/${id}/profile`;

module.exports = { findRobloxUser, profileUrl };
