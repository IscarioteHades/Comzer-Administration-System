import { upsertMember } from '../src/citizen_data/czrApi.js';
import { CONFIG } from '../src/config.js';

const targetDiscordId = process.argv[2];
if (!targetDiscordId) {
  console.error('usage: node scripts/test-upsert.js <discord_id>');
  process.exit(1);
}

upsertMember({
  guild_id: CONFIG.GUILD_ID,
  discord_id: targetDiscordId,
  group: 'citizen',
  roles: [],
})
  .then((r) => { console.log('OK', r); })
  .catch((e) => { console.error('NG', e.message); process.exit(2); });
