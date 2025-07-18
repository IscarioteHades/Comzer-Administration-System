// commands/shutdown.js
import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('shutdown')
  .setDescription('ボットを停止します');

export async function execute(interaction) {
  // 環境変数から許可ロールリストを取得
  const adminRoleIds = (process.env.STOP_ROLE_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  const memberRoles = interaction.member.roles.cache;

  // 管理者ロールを一つも持っていなければ拒否
  const hasAdminRole = adminRoleIds.some(roleId => memberRoles.has(roleId));
  if (!hasAdminRole) {
    return interaction.reply({
      content: 'このコマンドを実行する権限がありません。',
      ephemeral: true,
    });
  }

  // 権限 OK
  await interaction.reply({ content: 'ボットをシャットダウンします…', ephemeral: true });

  // 少し待ってから終了
  setTimeout(() => {
    interaction.client.destroy();
    process.exit(0);
  }, 1000);
}
