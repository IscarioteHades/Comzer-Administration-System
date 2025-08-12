import { upsertMember } from './czrApi.js';
import { CONFIG } from '../config.js';
import { sleep } from '../lib/sleep.js';

export function inferGroupFromRoles(roleIds) {
  // 外交官ロール → diplomat、それ以外は citizen（admin はユニークアカウント想定）
  return roleIds.includes(CONFIG.ROLE_DIPLOMAT) ? 'diplomat' : 'citizen';
}

export async function syncMember(member) {
  const roles = [...member.roles.cache.keys()];
  const payload = {
    guild_id: CONFIG.GUILD_ID,
    discord_id: member.id,
    group: inferGroupFromRoles(roles),
    roles,
  };
  return upsertMember(payload);
}

export async function fullSync(client) {
  const g = await client.guilds.fetch(CONFIG.GUILD_ID);
  const guild = await g.fetch();
  // すべてのメンバーを取得（Privileged Intent "Server Members" が必要）
  const members = await guild.members.fetch(); // Collection
  for (const m of members.values()) {
    try { await syncMember(m); }
    catch (e) { console.error('[fullSync] member', m.id, e.message); }
    await sleep(CONFIG.THROTTLE_MS);
  }
}
