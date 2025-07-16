import { REST, Routes } from 'discord.js';
import { data as rolepost } from './embedPost.js';
import { data as status } from './status.js';
import config from '../config.json' with { type: 'json' };
import { commands as blacklistCommands } from '../blacklistCommands.js';


const rest = new REST().setToken(process.env.DISCORD_TOKEN);

try {
  console.log('🔄  スラッシュコマンドを登録中...');
  await rest.put(
  Routes.applicationGuildCommands(config.clientId, config.guildId),
  { body: [rolepost.toJSON(), status.toJSON(), ...blacklistCommands.map(c => c.toJSON())] },
);
  console.log('✅  登録完了！');
} catch (err) {
  console.error(err);
}
process.exit(0);
