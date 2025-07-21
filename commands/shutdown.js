// commands/shutdown.js
import { SlashCommandBuilder } from 'discord.js';
import axios from 'axios';

export const data = new SlashCommandBuilder()
  .setName('shutdown')
  .setDescription('ボットを停止します');

export async function execute(interaction) {
  // 権限チェックは省略…

  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply({ content: 'ボットをシャットダウンします…' });

  setTimeout(async () => {
    try {
      interaction.client.destroy();

      const apiToken = process.env.KOYEB_API_TOKEN;
      const appId    = process.env.KOYEB_APP_ID;
      if (apiToken && appId) {
        // アプリを一時停止 (pause) して再起動を防止
        await axios.post(
          `https://api.koyeb.com/v1/apps/${appId}/actions/pause`,
          {},
          { headers: { Authorization: `Bearer ${apiToken}` } }
        );
      } else {
        console.warn('KOYEB_API_TOKEN または KOYEB_APP_ID が設定されていません。');
      }
    } catch (error) {
      console.error('エラーが発生しました:', error);
    } finally {
      process.exit(0);
    }
  }, 1000);
}
