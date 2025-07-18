// commands/shutdown.js
import { SlashCommandBuilder } from 'discord.js';
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

  // DM かギルドかでチェック
  let isAllowed = false;

  if (!interaction.guildId) {
    // DM／プライベートならユーザーIDだけで判定
    isAllowed = allowedUserIds.includes(interaction.user.id);
  } else {
    // ギルドならユーザーID or ロールID で判定
    const memberRoles = interaction.member.roles.cache;
    const hasRole = allowedRoleIds.some(rid => memberRoles.has(rid));
    const isUser = allowedUserIds.includes(interaction.user.id);
    isAllowed = hasRole || isUser;
  }

  if (!isAllowed) {
    // まだ defer／reply していなければ
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({
        content: 'このコマンドを実行する権限がありません。',
        ephemeral: true,
      });
    }
    return;
  }

  // ———— 安全に ACK ————
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply({ content: 'ボットをシャットダウンします…' });

  // ———— 少し待って終了 ————
  setTimeout(() => {
    interaction.client.destroy();
    process.exit(0);
  }, 1000);
}
