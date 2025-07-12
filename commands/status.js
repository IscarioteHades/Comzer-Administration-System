// commands/status.js
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

// 外部で最終診断時刻を参照する場合はここでexport
export let lastSelfCheck = new Date();

// ステータス更新関数（index.jsから呼び出し）
export function updateLastSelfCheck() {
  lastSelfCheck = new Date();
}

// スラッシュコマンド定義
export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('BOTの最終自己診断時刻に基づく結果を表示します');

// コマンド実行本体
export async function execute(interaction) {
  const timeStr = lastSelfCheck.toLocaleString('ja-JP', { hour12: false });
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("BOT自己診断ステータス")
        .setDescription(`✅ 最終診断時刻：${timeStr}`)
        .setColor(0x2ecc71)
    ],
    ephemeral: true,
  });
}
