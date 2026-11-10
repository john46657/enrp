import { type BotCommand } from '../command';
import { announce, giveaway, poll, rules, suggest } from './community';
import { approval, audit, data, permissions } from './admin';
import { help } from './help';
import { appeal, mod, report } from './moderation';
import { automation, backup, deploy, env, feature, incident, killswitch, ops, status } from './ops';
import { leaderboard, profile, verify } from './player';
import { duty, faction, vehicle } from './world';

export const COMMANDS: BotCommand[] = [
  verify,
  profile,
  leaderboard,
  faction,
  duty,
  vehicle,
  mod,
  report,
  appeal,
  suggest,
  poll,
  giveaway,
  announce,
  rules,
  permissions,
  approval,
  audit,
  data,
  ops,
  incident,
  feature,
  killswitch,
  deploy,
  env,
  automation,
  backup,
  status,
  help,
];
