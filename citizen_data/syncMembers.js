import { upsertMember } from './czrApi.js';

const GUILD_ID      = '1188411576483590194';
const ROLE_DIPLOMAT = '1188429176739479562';

export function inferGroupFromRoles(roleIds) {
  if (roleIds.includes(ROLE_DIPLOMAT)) return 'diplomat';
  return 'citizen';
}

export async function syncMember(m) {
  const roles = [...m.roles.cache.keys()];
  const payload = {
    guild_id: GUILD_ID,
    discord_id: m.id,
    group: inferGroupFromRoles(roles),
    roles,
  };
  const res = await upsertMember(payload);
  console.log('[syncMember]', m.id, res.status);
  return res;
}

export async function fullSync(client, throttleMs = 1000) { // ← 1000ms へ
  const g = await client.guilds.fetch(GUILD_ID);
  const guild = await g.fetch();
  const members = await guild.members.list({ limit: 1000 });
  for (const m of members.values()) {
    try {
      await syncMember(m);
    } catch (e) {
      console.error('[fullSync] member', m.id, 'failed:', e.message);
    }
    const jitter = Math.floor(Math.random() * 250);
    await new Promise(r => setTimeout(r, throttleMs + jitter));
  }
}
