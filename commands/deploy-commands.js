// commands/deploy-commands.js
import { REST, Routes } from 'discord.js';
import config from '../config.json' assert { type: 'json' };
import { data as rolepost } from './embedPost.js';
import { data as status } from './status.js';
import { data as shutdown } from './shutdown.js';
import { commands as blacklistCommands } from '../blacklistCommands.js';
import { data as start } from './start.js';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    // guildId が文字列 or 配列どちらでも扱えるように正規化
    const guildIds = Array.isArray(config.guildId)
      ? config.guildId
      : [config.guildId];

    for (const guildId of guildIds) {
      // 空配列で一括上書きして全削除
      const remaining = await rest.put(
        Routes.applicationGuildCommands(config.clientId, guildId),
        { body: [] }
      );
    }

    console.log('🔄 Clearing global commands…');
    const clearedGlobal = await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: [] }
    );
    console.log(`🗑️ Cleared global commands, remaining: ${clearedGlobal.length}`);

    console.log('🔄 Registering global commands…');
    const commandsBody = [
      rolepost.toJSON(),
      status.toJSON(),
      shutdown.toJSON(),
      start.toJSON(),
      ...blacklistCommands.map(c => c.toJSON()),
    ];
    const registered = await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: commandsBody }
    );
    console.log(`✅ Global commands registered: ${registered.length}`);
  } catch (err) {
    console.error('❌ Error during command deployment:', err);
  } finally {
    process.exit(0);
  }
})();
