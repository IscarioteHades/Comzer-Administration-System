// commands/shutdown.js
import { SlashCommandBuilder } from 'discord.js';
import axios from 'axios';

export const data = new SlashCommandBuilder()
  .setName('shutdown')
  .setDescription('ボットを停止します');

export async function execute(interaction) {
  // 環境変数から許可ユーザー／ロールをパース
  const allowedUserIds = (process.env.STOP_USER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
  const allowedRoleIds = (process.env.STOP_ROLE_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  // 権限チェック
  let isAllowed = false;
  if (!interaction.guildId) {
    // DM ならユーザーIDのみ
    isAllowed = allowedUserIds.includes(interaction.user.id);
  } else {
    // ギルドならユーザーID or ロールID
    const memberRoles = interaction.member.roles.cache;
    const hasRole = allowedRoleIds.some(rid => memberRoles.has(rid));
    const isUser = allowedUserIds.includes(interaction.user.id);
    isAllowed = hasRole || isUser;
  }

  if (!isAllowed) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({
        content: 'このコマンドを実行する権限がありません。',
        ephemeral: true,
      });
    }
    return;
  }

  // ACK
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply({ content: 'ボットをシャットダウンします…' });

  // 少し待ってから停止
  setTimeout(async () => {
    try {
      // 1) Discord クライアント停止
      interaction.client.destroy();

      // 2) Koyeb 側インスタンス数を 0 に更新
      const apiToken = process.env.KOYEB_API_TOKEN;
      const appId    = process.env.KOYEB_APP_ID;
      if (apiToken && appId) {
        await axios.patch(
          `https://api.koyeb.com/v1/apps/${appId}`,
          { instances: 0 },
          { headers: { Authorization: `Bearer ${apiToken}` } }
        );
      } else {
        console.warn('KOYEB_API_TOKEN または KOYEB_APP_ID が設定されていません。');
      }
    } catch (error) {
      console.error('エラーが発生しました:', error);
    } finally {
      // 3) プロセス終了
      process.exit(0);
    }
  }, 1000);
}
