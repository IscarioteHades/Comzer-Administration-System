import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
} from 'discord.js';
import { ROLE_CONFIG } from '../config/roles.js';

/* --------------------------------------------------
 * 1. /rolepost スラッシュコマンド定義
 * -------------------------------------------------- */
export const data = new SlashCommandBuilder()
  .setName('rolepost')
  .setDescription('役職発言モードの ON / OFF を切り替えます（トグル式）');

/* --------------------------------------------------
 * 2. 発言モード管理（Map<channelId, Map<userId, roleId>>）
 * -------------------------------------------------- */
const activeChannels = new Map();

function ensureChannelMap(channelId) {
  if (!activeChannels.has(channelId)) {
    activeChannels.set(channelId, new Map());
  }
  return activeChannels.get(channelId);
}

export function isActive(channelId, userId) {
  const chMap = activeChannels.get(channelId);
  return chMap ? chMap.has(userId) : false;
}

export function getRoleId(channelId, userId) {
  const chMap = activeChannels.get(channelId);
  return chMap ? chMap.get(userId) : null;
}

export function setActive(channelId, userId, roleId) {
  ensureChannelMap(channelId).set(userId, roleId);
}

export function setInactive(channelId, userId) {
  const chMap = activeChannels.get(channelId);
  if (chMap) chMap.delete(userId);
}

/* --------------------------------------------------
 * 3. /rolepost コマンド本体
 * -------------------------------------------------- */
export async function execute(interaction) {
  try {
    // --- 必ず最初に deferReply ---
    await interaction.deferReply({ ephemeral: true });

    const member       = interaction.member;
    const clientConfig = interaction.client.ROLE_CONFIG || ROLE_CONFIG;
    const channelId    = interaction.channelId;
    const userId       = interaction.user.id;

    // ON→OFF トグル
    if (isActive(channelId, userId)) {
      setInactive(channelId, userId);
      return interaction.editReply('役職発言モードを **OFF** にしました。');
    }

    // 1) ユーザーの Discord ロールID一覧を取得
    const userRoles = member.roles.cache.map(r => r.id);

    // 2) ROLE_CONFIG を走査して、持っている envVar（役職ロール）を探す
    const matched = Object.entries(clientConfig)
      .flatMap(([key, cfg]) => {
        const ids = (process.env[cfg.envVar] || "")
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
        return ids.some(rid => userRoles.includes(rid))
          ? [{ key, rid: ids[0], cfg }]
          : [];
      });

    if (matched.length === 0) {
      return interaction.editReply('役職ロールを保有していません。');
    }

    // 複数モード → 選択メニュー
    if (matched.length > 1) {
      const options = matched.map(({ key, rid, cfg }) => ({
        label: cfg.label,
        value: rid,
        emoji: cfg.emoji,
      }));

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`rolepost-choose-${channelId}-${userId}`)
        .setPlaceholder('モードを選択してください')
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(menu);
      return interaction.editReply({
        content: 'どのモードで発言モードを有効にしますか？',
        components: [row],
      });
    }

    // 単一モード → そのまま ON
    if (matched.length === 1) {
      const { rid, cfg } = matched[0];
      setActive(channelId, userId, rid);
      return interaction.editReply(
        `役職発言モードを **ON** にしました。（${cfg.embedName}）`
      );
    }

  } catch (err) {
    console.error('[embedPost] execute error:', err);
    const method = interaction.deferred ? 'followUp' : 'reply';
    return interaction[method]({
      content: '⚠️ コマンド実行中にエラーが発生しました。',
      ephemeral: true,
    });
  }
}

/* --------------------------------------------------
 * 4. 選択メニューレスポンス
 * -------------------------------------------------- */
export async function handleRolepostSelect(interaction) {
  try {
    // customId: rolepost-choose-<channelId>-<userId>
    const [, , channelId, userId] = interaction.customId.split('-');
    if (interaction.user.id !== userId) {
      return interaction.reply({ content: 'あなた以外は操作できません。', ephemeral: true });
    }

    // value に roleId がそのまま来る
    const roleId = interaction.values[0];
    setActive(channelId, userId, roleId);

    // 選択された roleId から ROLE_CONFIG を逆引き
    const entry = Object.values(interaction.client.ROLE_CONFIG)
      .find(cfg => (process.env[cfg.envVar] || "").split(',').includes(roleId));
    const modeName = entry?.embedName || '不明なモード';

    await interaction.update({
      content: `役職発言モードを **ON** にしました。（${modeName}）`,
      components: [],
    });
  } catch (err) {
    console.error('[embedPost] handleSelect error:', err);
  }
}

/* --------------------------------------------------
 * 5. Embed 生成ヘルパー
 * -------------------------------------------------- */
export function makeEmbed(content, roleId, ROLE_CONFIG, attachmentURL = null) {
  const cfg = ROLE_CONFIG[roleId];
  if (!cfg) {
    console.error(`[makeEmbed] Unknown roleId: ${roleId}`);
    return new EmbedBuilder()
      .setDescription(content)
      .setFooter({ text: `ROLE_ID:${roleId} (未定義)` });
  }

  const embed = new EmbedBuilder()
    .setAuthor({ name: cfg.embedName, iconURL: cfg.embedIcon })
    .setDescription(content)
    .setColor(cfg.embedColor ?? 0x3498db);

  if (attachmentURL) embed.setImage(attachmentURL);
  return embed;
}
