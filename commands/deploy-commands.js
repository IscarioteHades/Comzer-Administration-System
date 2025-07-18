// commands/deploy-commands.js
import { REST, Routes } from 'discord.js';
import config from '../config.json' assert { type: 'json' };
import { data as rolepost } from './embedPost.js';
import { data as status } from './status.js';
import { data as shutdown } from './shutdown.js';
import { commands as blacklistCommands } from '../blacklistCommands.js';

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    console.log('🔄 コマンドを登録中...');
    const globalBody = [
      rolepost.toJSON(),
      status.toJSON(),
      shutdown.toJSON(),
      ...blacklistCommands.map(c => c.toJSON())
    ];
    const res = await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: globalBody }
    );
    console.log('✅ 登録完了！', res);
  } catch (err) {
    console.error('❌ コマンド登録エラー:', err);
  } finally {
    process.exit(0);
  }
})();
