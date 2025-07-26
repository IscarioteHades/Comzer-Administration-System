import { REST, Routes } from 'discord.js';
import config from '../config.json' assert { type: 'json' };
import { data as rolepost }    from './embedPost.js';
import { data as status }      from './status.js';
import { data as shutdown }    from './shutdown.js';
import { data as start }       from './start.js';
import { commands as blacklistCommands } from '../blacklistCommands.js';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const { clientId, guildId } = config;

(async () => {
  try {
    // ———— ギルドコマンドの一括削除 ————
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: [] }
    );

    // ———— グローバルコマンドの一括削除 ————
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: [] }
    );

    // ———— グローバルコマンド登録 ————
    const globalBody = [
      rolepost.toJSON(),
      status.toJSON(),
      shutdown.toJSON(),
      start.toJSON(),
      ...blacklistCommands.map(c => c.toJSON()),
    ];

    console.log(`🔄 グローバルコマンドを登録中…`);
    const registered = await rest.put(
      Routes.applicationCommands(clientId),
      { body: globalBody }
    );
    console.log(`✅ グローバルコマンド登録完了: ${registered.length} 件`);

  } catch (err) {
    console.error('❌ コマンド登録エラー:', err);
  } finally {
    process.exit(0);
  }
})();
