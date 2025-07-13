// commands/embedPost.js
import {
  SlashCommandBuilder,
  ActionRowBuilder,
  SelectMenuBuilder,
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
// 複数ユーザー/チャンネルに対応
// activeChannels: { [channelId]: { userId, roleId } }
const activeChannels = new Map();

/**
 * 現在そのチャンネルでONかどうか
 * @param {string} channelId
 * @param {string} userId
 * @returns {boolean}
 */
export function isActive(channelId, userId) {
  const state = activeChannels.get(channelId);
  return state && state.userId === userId;
}

/**
 * そのチャンネルの現在の発言役職IDを返す
 * @param {string} channelId
 * @returns {string|null}
 */
export function getRoleId(channelId) {
  return activeChannels.get(channelId)?.roleId || null;
}

/**
 * ON（役職ロール指定）でセット
 * @param {string} channelId
 * @param {string} userId
 * @param {string} roleId
 */
export function setActive(channelId, userId, roleId) {
  activeChannels.set(channelId, { userId, roleId });
}

/**
 * OFF
 * @param {string} channelId
 */
export function setInactive(channelId) {
  activeChannels.delete(channelId);
}


/* --------------------------------------------------
 * 3. /rolepost 実行本体
 * -------------------------------------------------- */
export async function execute(interaction) {
  if (interaction.replied || interaction.deferred) return;
  await interaction.deferReply({ ephemeral: true });
  const member = interaction.member;
  const ROLE_CONFIG = interaction.client.ROLE_CONFIG || {};

  // デバッグ用出力ここから
  const userRoles = member.roles.cache.map(r => String(r.id));
  const configKeys = Object.keys(ROLE_CONFIG).map(String);
  const userRoleIds = configKeys.filter(rid => userRoles.includes(rid));
  console.log("[ROLEPOST DEBUG] ユーザーロールID:", userRoles);
  console.log("[ROLEPOST DEBUG] ROLE_CONFIG キー:", configKeys);
  console.log("[ROLEPOST DEBUG] 一致ロールID:", userRoleIds);

  // 既にONならOFF
  if (isActive(interaction.channelId, interaction.user.id)) {
    setInactive(interaction.channelId);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: `役職発言モードを **OFF** にしました。`, ephemeral: true });
    }
    return;
  }

  if (userRoleIds.length === 0) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "役職ロールを保有していません。", ephemeral: true });
    }
    return;
  }

  if (userRoleIds.length > 1) {
    if (!interaction.replied && !interaction.deferred) {
      const row = new ActionRowBuilder().addComponents(
        new SelectMenuBuilder()
          .setCustomId(`rolepost-choose-${interaction.user.id}`)
          .setPlaceholder('役職を選択してください')
          .addOptions(userRoleIds.map(rid => ({
            label: ROLE_CONFIG[rid].name,
            value: rid,
            emoji: '🟦',
          })))
      );
      await interaction.reply({
        content: 'どの役職で発言モードを有効にしますか？',
        components: [row],
        ephemeral: true,
      });
    }
    return;
  }

  // 1つだけ持ってる場合は即ON
  setActive(interaction.channelId, interaction.user.id, userRoleIds[0]);
  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: `役職発言モードを **ON** にしました。（${ROLE_CONFIG[userRoleIds[0]].name}）`, ephemeral: true });
  }
}


/* --------------------------------------------------
 * 4. Embed 生成ヘルパ
 *    画像が 1 枚あればプレビューに使う（任意）
 * -------------------------------------------------- */
export function makeEmbed(content, roleId, ROLE_CONFIG, attachmentURL = null) {
  const embed = new EmbedBuilder()
    .setAuthor({
      name: ROLE_CONFIG[roleId].name,
      iconURL: ROLE_CONFIG[roleId].icon,
    })
    .setDescription(content)
    .setColor(0x3498db)
    .setFooter({ text: `ROLE_ID:${roleId}` });

  if (attachmentURL) embed.setImage(attachmentURL);
  return embed;
}

