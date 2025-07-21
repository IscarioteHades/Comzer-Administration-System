// commands/shutdown.js
import { SlashCommandBuilder } from 'discord.js';
import axios from 'axios';

export const data = new SlashCommandBuilder()
  .setName('shutdown')
  .setDescription('ボットを停止します');

export async function execute(interaction) {
  // ── 権限チェック ──
  const allowedUserIds = (process.env.STOP_USER_IDS || '')
    .split(',').map(id => id.trim()).filter(Boolean);
  const allowedRoleIds = (process.env.STOP_ROLE_IDS || '')
    .split(',').map(id => id.trim()).filter(Boolean);

  let isAllowed = false;
  if (!interaction.guildId) {
    // DM ならユーザーIDのみ
    isAllowed = allowedUserIds.includes(interaction.user.id);
  } else {
    // ギルドならユーザーID or ロールID
    const memberRoles = interaction.member.roles.cache;
    isAllowed = allowedUserIds.includes(interaction.user.id)
             || allowedRoleIds.some(rid => memberRoles.has(rid));
  }

  if (!isAllowed) {
    if (!interaction.deferred && !interaction.replied) {
      // Ephemeral は flags: 1<<6 で指定
      await interaction.reply({
        content: 'このコマンドを実行する権限がありません。',
        flags: 1 << 6
      });
    }
    return;
  }

  // ── ACK ──
  await interaction.deferReply({ flags: 1 << 6 });
  await interaction.editReply({ content: 'ボットをシャットダウンします…' });

  // 少し待ってから停止処理
  setTimeout(async () => {
    try {
      // 1) Discord クライアント停止
      interaction.client.destroy();

      // 2) Koyeb 側を完全停止（stop）
      const apiToken = process.env.KOYEB_API_TOKEN;
      const appId    = process.env.KOYEB_APP_ID;
      if (apiToken && appId) {
        await axios.post(
          `https://api.koyeb.com/v1/apps/${appId}/actions/stop`,
          {},
          { headers: { Authorization: `Bearer ${apiToken}` } }
        );
      } else {
        console.warn('KOYEB_API_TOKEN または KOYEB_APP_ID が設定されていません。');
      }
    } catch (error) {
      console.error('停止処理中にエラーが発生しました:', error);
    } finally {
      // 3) プロセス終了
      process.exit(0);
    }
  }, 1000);
}
