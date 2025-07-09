import { REST, Routes } from 'discord.js';
import { data as rolepost } from './embedPost.js';
import config from '../config.json' with { type: 'json' };

/* ▼ 追加：ビルド時（トークン無）ならスキップして正常終了 */
if (!process.env.DISCORD_TOKEN) {
  console.log('DISCORD_TOKEN not set - skip slash-command deploy');
  process.exit(0);
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

try {
  console.log('🔄  スラッシュコマンドを登録中...');
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: [rolepost.toJSON()] },
  );
  console.log('✅  登録完了！');
} catch (err) {
  console.error(err);
}
