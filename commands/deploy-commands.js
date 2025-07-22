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
    
    // config.guildId: デプロイ対象のギルドID配列
    for (const guildId of config.guildId) {
      const guildCommands = await rest.get(
        Routes.applicationGuildCommands(config.clientId, guildId)
      );

      if (Array.isArray(guildCommands) && guildCommands.length) {
        for (const cmd of guildCommands) {
          await rest.delete(
            Routes.applicationGuildCommand(config.clientId, guildId, cmd.id)
          );
        }
      }
    }

    console.log('🔄 Clearing global commands…');
    // グローバルコマンドを空にする
    await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: [] }
    );

    console.log('🔄 Registering global commands…');
    // グローバルコマンドを登録
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
