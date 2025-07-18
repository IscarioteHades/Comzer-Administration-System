// commands/shutdown.js
import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('shutdown')
  .setDescription('ボットを停止します');

export async function execute(interaction) {
  // ———— 権限チェック ————
  const adminRoleIds = (process.env.STOP_ROLE_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
  const memberRoles = interaction.member.roles.cache;
  const hasAdminRole = adminRoleIds.some(roleId => memberRoles.has(roleId));
  if (!hasAdminRole) {
    // まだデファーもリプライもしていなければ reply
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
