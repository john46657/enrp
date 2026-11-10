import { describe, expect, it, vi } from 'vitest';
import { createPrivateServerSync } from './private-servers';

const MAIN = '100000000000000001';
const LINKED = '100000000000000002';
const OLD = '100000000000000003';
const POLICE_ROLE = '200000000000000001';
const OTHER_ROLE = '200000000000000002';

/** Mitglied mit Rollen; roles.cache.some bildet discord.js' Collection nach. */
function member(id: string, roles: string[], bot = false) {
  const cache = Object.assign(new Map(roles.map((r) => [r, { id: r }])), {
    some: (fn: (r: { id: string }) => boolean) => roles.some((r) => fn({ id: r })),
  });
  return { id, user: { bot }, roles: { cache } };
}
function fakeGuild(id: string, members: ReturnType<typeof member>[] = []) {
  const map = new Map(members.map((m) => [m.id, m]));
  return {
    id,
    name: `Guild ${id}`,
    commands: { set: vi.fn(async () => undefined) },
    members: { fetch: vi.fn(async () => map) },
  };
}

function setup() {
  const guilds = new Map([
    [MAIN, fakeGuild(MAIN)],
    [
      LINKED,
      fakeGuild(LINKED, [
        member('300000000000000001', [POLICE_ROLE, OTHER_ROLE]),
        member('300000000000000002', [OTHER_ROLE]),
        member('300000000000000003', [POLICE_ROLE], true),
      ]),
    ],
    [OLD, fakeGuild(OLD)],
  ]);
  const posts: Array<{ path: string; body: unknown }> = [];
  const apis = {
    service: {
      get: vi.fn(async () => ({
        items: [
          {
            id: 'link-1',
            guildId: LINKED,
            name: 'Partner',
            teamRoleId: null,
            rightRoles: [{ right: 'polizei', roleId: POLICE_ROLE }],
          },
        ],
      })),
      post: vi.fn(async (path: string, body: unknown) => {
        posts.push({ path, body });
        return { added: 1, removed: 0, missingAccount: [] };
      }),
    },
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const sync = createPrivateServerSync({
    client: { guilds: { cache: guilds } } as never,
    apis: apis as never,
    logger: logger as never,
    mainGuildId: MAIN,
    commands: [{ name: 'ps' }],
  });
  return { sync, guilds, posts, logger };
}

describe('Privatserver-Abgleich im Bot', () => {
  it('registriert /ps nur im verknüpften Discord, entfernt es woanders und meldet nur zugeordnete Rollen', async () => {
    const { sync, guilds, posts } = setup();
    await sync.refresh();
    expect(guilds.get(LINKED)!.commands.set).toHaveBeenCalledWith([{ name: 'ps' }]);
    expect(guilds.get(OLD)!.commands.set).toHaveBeenCalledWith([]);
    expect(guilds.get(MAIN)!.commands.set).not.toHaveBeenCalled();
    expect(posts).toEqual([
      {
        path: '/api/v1/private-servers/link-1/sync',
        body: { full: true, members: [{ discordUserId: '300000000000000001', roleIds: [POLICE_ROLE] }] },
      },
    ]);
    // Zweiter Durchlauf: nichts neu registrieren, kein erneuter Vollabgleich innerhalb von 15 Minuten
    await sync.refresh();
    expect(guilds.get(LINKED)!.commands.set).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(1);
  });

  it('Rollenänderung und Verlassen lösen einen Teilabgleich aus, andere Rollen nicht', async () => {
    vi.useFakeTimers();
    try {
      const { sync, posts } = setup();
      await sync.refresh();
      posts.length = 0;
      const guild = { id: LINKED };
      const before = { ...member('300000000000000002', [OTHER_ROLE]), guild, partial: false };
      sync.onMemberUpdate(before as never, { ...member('300000000000000002', [OTHER_ROLE, '999']), guild } as never);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(posts).toHaveLength(0);

      sync.onMemberUpdate(
        before as never,
        { ...member('300000000000000002', [OTHER_ROLE, POLICE_ROLE]), guild } as never,
      );
      await vi.advanceTimersByTimeAsync(5_000);
      expect(posts).toEqual([
        {
          path: '/api/v1/private-servers/link-1/sync',
          body: { full: false, members: [{ discordUserId: '300000000000000002', roleIds: [POLICE_ROLE] }] },
        },
      ]);
      sync.onMemberRemove({ id: '300000000000000001', guild } as never);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(posts[1]!.body).toEqual({ full: false, members: [{ discordUserId: '300000000000000001', roleIds: [] }] });
    } finally {
      vi.useRealTimers();
    }
  });
});
