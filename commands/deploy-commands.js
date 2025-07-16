// commands/deploy-commands.js
import { REST, Routes } from 'discord.js';
import config from '../config.json';
import { data as rolepost } from './embedPost.js';
import { data as status } from './status.js';
import { commands as blacklistCommands } from '../blacklistCommands.js';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('🔄 スラッシュコマンドを登録中...');
    const body = [
      rolepost.toJSON(),
      status.toJSON(),
      ...blacklistCommands.map(c => c.toJSON())
    ];
    const res = await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body }
    );
    console.log('✅ 登録完了！', res);
  } catch (err) {
    console.error('❌ コマンド登録エラー:', err);
  } finally {
    process.exit(0);
  }
})();
