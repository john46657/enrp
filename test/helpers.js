// Nachgebaute Discord-Objekte für die Tests. Muss vor allen Bot-Modulen geladen werden (setzt DATA_DIR).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'enrp-test-'));
process.env.WEB_URL = 'http://localhost';
process.env.WEB_SECRET = 'test-secret';

const { PermissionFlagsBits } = require('discord.js');

let nextId = 1000;
const id = () => String(++nextId).padStart(18, '1');

function fakeUser(name) {
  const user = {
    id: id(),
    username: name,
    globalName: name,
    tag: name,
    createdTimestamp: Date.now() - 400 * 86_400_000,
    sent: [],
    toString() {
      return `<@${this.id}>`;
    },
    async send(payload) {
      this.sent.push(payload);
      return { id: id() };
    },
    async createDM() {
      return { id: `dm-${this.id}`, send: (payload) => this.send(payload) };
    },
  };
  return user;
}

function fakeMember(guild, user, { roles = [], manageGuild = false } = {}) {
  const held = new Set(roles);
  const member = {
    id: user.id,
    user,
    guild,
    joinedTimestamp: Date.now() - 30 * 86_400_000,
    nickname: null,
    roles: {
      cache: { has: (roleId) => held.has(roleId) },
      add: async (roleId) => held.add(roleId),
      remove: async (roleId) => held.delete(roleId),
    },
    permissions: { has: (flag) => manageGuild && flag === PermissionFlagsBits.ManageGuild },
    displayAvatarURL: () => 'https://example.com/avatar.png',
    async setNickname(nick) {
      this.nickname = nick;
    },
    toString: () => `<@${user.id}>`,
    held,
  };
  guild.memberMap.set(user.id, member);
  guild.client.userMap.set(user.id, user);
  return member;
}

function fakeChannel(guild, name) {
  const channel = {
    id: id(),
    name,
    guild,
    sent: [],
    isTextBased: () => true,
    async send(payload) {
      const message = {
        id: id(),
        payload,
        edits: [],
        async edit(next) {
          this.edits.push(next);
          this.payload = next;
        },
        startThread: async () => fakeChannel(guild, 'thread'),
      };
      channel.sent.push(message);
      channel.messageMap.set(message.id, message);
      return message;
    },
    messageMap: new Map(),
    messages: { fetch: async (messageId) => channel.messageMap.get(messageId) ?? Promise.reject(new Error('Unknown Message')), delete: async () => {} },
  };
  guild.channelMap.set(channel.id, channel);
  return channel;
}

function fakeWorld() {
  const client = { userMap: new Map(), guilds: { cache: new Map() }, users: {} };
  client.users.fetch = async (userId) => client.userMap.get(userId) ?? Promise.reject(new Error('Unknown User'));
  client.users.cache = client.userMap;
  const guild = { id: id(), name: 'Testserver', client, memberMap: new Map(), channelMap: new Map(), roles: { cache: new Map() } };
  guild.members = { fetch: async (userId) => guild.memberMap.get(userId) ?? Promise.reject(new Error('Unknown Member')), cache: guild.memberMap };
  guild.channels = { fetch: async (channelId) => guild.channelMap.get(channelId) ?? Promise.reject(new Error('Unknown Channel')), cache: guild.channelMap };
  client.guilds.cache.set(guild.id, guild);
  return { client, guild };
}

// Interaktion aus Panel/Button/Slash-Befehl; replies sammelt alle Antworten.
function fakeInteraction(guild, member, { options = {}, sub = null, values = [], message = null, channelId = null } = {}) {
  const interaction = {
    client: guild.client,
    guild,
    guildId: guild.id,
    member,
    user: member.user,
    values,
    message,
    channelId,
    replied: false,
    deferred: false,
    replies: [],
    memberPermissions: member.permissions,
    options: {
      getSubcommand: () => sub,
      getString: (name) => (typeof options[name] === 'string' ? options[name] : null),
      getInteger: (name) => (Number.isInteger(options[name]) ? options[name] : null),
      getBoolean: (name) => (typeof options[name] === 'boolean' ? options[name] : null),
      getRole: (name) => options[name]?.roleId ? { id: options[name].roleId } : null,
      getUser: (name) => options[name]?.user ?? null,
      getChannel: () => null,
    },
    async reply(payload) {
      this.replied = true;
      this.replies.push(payload);
    },
    async followUp(payload) {
      this.replies.push(payload);
    },
    async update(payload) {
      this.replied = true;
      this.replies.push(payload);
    },
  };
  return interaction;
}

// Text einer Antwort/DM (content oder erste Embed-Beschreibung).
function textOf(payload) {
  if (typeof payload === 'string') return payload;
  const first = payload?.embeds?.[0];
  const json = first?.toJSON ? first.toJSON() : first;
  return [payload?.content, json?.title, json?.description].filter(Boolean).join('\n');
}

module.exports = { fakeWorld, fakeUser, fakeMember, fakeChannel, fakeInteraction, textOf, id };
