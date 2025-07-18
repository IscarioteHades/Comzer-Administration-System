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
    console.log('🔄 グローバルスラッシュコマンドを登録中…');

    // 既存のグローバルコマンドをすべて置き換え（空配列でもOK）
    await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: [] }
    );

    // 改めて全コマンドを登録
    const body = [
      rolepost.toJSON(),
      status.toJSON(),
      shutdown.toJSON(),
      ...blacklistCommands.map(c => c.toJSON()),
    ];

    const res = await rest.put(
      Routes.applicationCommands(config.clientId),
      { body }
    );
    console.log(`✅ グローバルコマンド登録完了: ${res.length} 件`);
  } catch (err) {
    console.error('❌ コマンド登録エラー:', err);
  } finally {
    process.exit(0);
  }
})();
