import { REST, Routes } from 'discord.js';
import config from '../config.json' assert { type: 'json' };
import { data as rolepost } from './embedPost.js';
import { data as status } from './status.js';
import { data as shutdown } from './shutdown.js';
import { commands as blacklistCommands } from '../blacklistCommands.js';
import { data as start } from './start.js';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// 必要な config.clientId と config.guildId を確認
const { clientId, guildId } = config;

(async () => {
  try {
    console.log(`🔄 ギルド(${guildId})のスラッシュコマンドを登録中…`);

    // 一旦既存のコマンドを削除（オプション）
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: [] }
    );

    // 改めて登録するコマンド一覧
    const body = [
      rolepost.toJSON(),
      status.toJSON(),
      shutdown.toJSON(),
      start.toJSON(),
      ...blacklistCommands.map(c => c.toJSON()),
    ];

    const res = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body }
    );

    console.log(`✅ ギルドコマンド登録完了: ${res.length} 件`);
  } catch (err) {
    console.error('❌ コマンド登録エラー:', err);
  } finally {
    process.exit(0);
  }
})();
