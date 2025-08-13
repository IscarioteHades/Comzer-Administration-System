import { upsertMember } from './czrApi.js';

const GUILD_ID      = process.env.CZR_GUILD_ID || '1188411576483590194';
const ROLE_DIPLOMAT = process.env.ROLE_DIPLOMAT_ID || '1188429176739479562';
const THROTTLE_MS   = Number(process.env.CZR_THROTTLE_MS || 700); // 既定700msに緩める

const STOP_USER_IDS = (process.env.STOP_USER_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

export function inferGroupFromRoles(roleIds) {
  return roleIds.includes(ROLE_DIPLOMAT) ? 'diplomat' : 'citizen';
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

export async function syncMember(member) {
  if (STOP_USER_IDS.includes(member.id)) return { skip: true, member: member.id };
  const roles = [...member.roles.cache.keys()];
  const payload = {
    guild_id: GUILD_ID,
    discord_id: member.id,
    group: inferGroupFromRoles(roles),
    roles,
  };
  return upsertMember(payload);
}

export async function fullSync(client) {
  const g = await client.guilds.fetch(GUILD_ID);
  const guild = await g.fetch();
  const members = await guild.members.fetch(); // 全件
  for (const m of members.values()) {
    try {
      await syncMember(m);
    } catch (e) {
      console.error('[fullSync] member', m.id, e.message);
    }
    const jitter = Math.floor(Math.random() * 200);
    await sleep(THROTTLE_MS + jitter);
  }
}
