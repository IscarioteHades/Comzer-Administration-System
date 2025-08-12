import { upsertMember } from './czrApi.js';

const GUILD_ID      = process.env.CZR_GUILD_ID || '1188411576483590194';
const ROLE_DIPLOMAT = process.env.ROLE_DIPLOMAT_ID || '1188429176739479562';

export function inferGroupFromRoles(roleIds) {
  return roleIds.includes(ROLE_DIPLOMAT) ? 'diplomat' : 'citizen';
}

export async function syncMember(member) {
  const roles = [...member.roles.cache.keys()];
  const payload = {
    guild_id: GUILD_ID,
    discord_id: member.id,
    group: inferGroupFromRoles(roles),
    roles,
  };
  return upsertMember(payload);
}

export async function fullSync(client, throttleMs = Number(process.env.CZR_THROTTLE_MS || 250)) {
  const g = await client.guilds.fetch(GUILD_ID);
  const guild = await g.fetch();
  // 全メンバー取得（Server Members Intent が必須）
  const members = await guild.members.fetch(); // Collection GuildMember
  for (const m of members.values()) {
    try { await syncMember(m); }
    catch (e) { console.error('[fullSync] member', m.id, e.message); }
    await new Promise(r => setTimeout(r, throttleMs));
  }
}
