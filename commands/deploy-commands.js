import { REST, Routes } from 'discord.js';
import fs from 'fs';
import path from 'path';
import config from '../config.json' with { type: 'json' };
import { commands as blacklistCommands } from '../blacklistCommands.js';

const rest = new REST().setToken(process.env.DISCORD_TOKEN);
try {
  console.log('🔄  スラッシュコマンドを登録中...');
  const commandsPath = path.resolve('./commands');
  const dynamic = fs
    .readdirSync(commandsPath)
    .filter(f => f.endsWith('.js') && f !== 'deploy-commands.js')
    .map(f => {
      const mod = require(path.join(commandsPath, f));
      return mod.data.toJSON();
    });
  const blJson = blacklistCommands.map(c => c.toJSON());
  await rest.put(
  Routes.applicationGuildCommands(config.clientId, config.guildId),
  { body: [...dynamic, ...blJson] }
);
  console.log('✅ スラッシュコマンド登録完了！');
} catch (err) {
  console.error('❌ コマンド登録エラー:', err);
}
