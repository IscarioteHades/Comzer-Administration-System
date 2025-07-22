// commands/deploy-commands.js
import { REST, Routes } from 'discord.js';
import config from '../config.json' assert { type: 'json' };
import { data as rolepost } from './embedPost.js';
import { data as status } from './status.js';
import { data as shutdown } from './shutdown.js';
import { commands as blacklistCommands } from '../blacklistCommands.js';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
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
