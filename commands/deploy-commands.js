import { REST, Routes } from 'discord.js';
import fs from 'fs';
import path from 'path';
import config from '../config.json' with { type: 'json' };
import { commands as blacklistCommands } from '../blacklistCommands.js';


const rest = new REST().setToken(process.env.DISCORD_TOKEN);

try {
  console.log('🔄  スラッシュコマンドを登録中...');
  const commandsDir = path.resolve('./commands');
  const dynamicCommands = fs
    .readdirSync(commandsDir)
    .filter(f => f.endsWith('.js'))
    .map(f => {
      const { data } = await import(path.join(commandsDir, f));
      return data.toJSON();
    });
  const blCommandJson = blacklistCommands.map(c => c.data.toJSON());
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: [...dynamicCommands, ...blCommandJson] },
  );
  console.log('✅  登録完了！');
} catch (err) {
  console.error(err);
}
process.exit(0);
