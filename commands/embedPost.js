// commands/embedPost.js
import {
  SlashCommandBuilder,
  EmbedBuilder,
} from 'discord.js';

/* --------------------------------------------------
 * 1. /rolepost スラッシュコマンドの定義
 * -------------------------------------------------- */
export const data = new SlashCommandBuilder()
  .setName('rolepost')
  .setDescription('役職発言モードの ON / OFF を切り替えます（トグル式）');

/* --------------------------------------------------
 * 2. チャンネルごとの ON / OFF 状態を保持
 *    true なら「役職発言モード ON」
 * -------------------------------------------------- */
const activeChannels = new Set();

/**
 * 現在 ON かどうかを返す
 * @param {string} channelId
 * @returns {boolean}
 */
export function isActive(channelId) {
  return activeChannels.has(channelId);
}

/**
 * ON / OFF を切り替えて結果を返す
 * @param {string} channelId
 * @returns {boolean}  ← 切り替え後の状態（ON なら true）
 */
export function toggle(channelId) {
  if (activeChannels.has(channelId)) {
    activeChannels.delete(channelId);
    return false;
  }
  activeChannels.add(channelId);
  return true;
}

/* --------------------------------------------------
 * 3. /rolepost 実行本体
 * -------------------------------------------------- */
export async function execute(interaction) {
  const on = toggle(interaction.channelId);
  await interaction.reply({
    content: `役職発言モードを **${on ? 'ON' : 'OFF'}** にしました。`,
    ephemeral: true,
  });
}

/* --------------------------------------------------
 * 4. Embed 生成ヘルパ
 *    画像が 1 枚あればプレビューに使う（任意）
 * -------------------------------------------------- */
export function makeEmbed(content, roleId, ROLE_CONFIG, attachmentURL = null) {
  const embed = new EmbedBuilder()
    .setAuthor({
      name: '外交官 (外務省 総合外務部職員)',      // ← 肩書きはここで固定
      iconURL: ROLE_CONFIG[roleId].icon,
    })
    .setDescription(content)
    .setColor(0x3498db);

  if (attachmentURL) embed.setImage(attachmentURL);
  return embed;
}
