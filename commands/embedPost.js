import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
} from 'discord.js';

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
    const clientConfig = interaction.client.ROLE_CONFIG || {};
    const channelId    = interaction.channelId;
    const userId       = interaction.user.id;

    // ON→OFF トグル
    if (isActive(channelId, userId)) {
      setInactive(channelId, userId);
      return interaction.editReply('役職発言モードを **OFF** にしました。');
    }

    // 環境変数からロールIDリスト
    const diplomatRoles = (process.env.ROLLID_DIPLOMAT || '').split(',').filter(Boolean);
    const ministerRoles = (process.env.ROLLID_MINISTER  || '').split(',').filter(Boolean);

    // ユーザーのロールID一覧
    const userRoles = member.roles.cache.map(r => r.id);

    // 保持モード判定
    const matched = [
      ...diplomatRoles.filter(rid => userRoles.includes(rid)).map(() => ({ mode: 'diplomat', rid: diplomatRoles[0] })),
      ...ministerRoles.filter(rid => userRoles.includes(rid)).map(() => ({ mode: 'minister', rid: ministerRoles[0] }))
    ];

    if (matched.length === 0) {
      return interaction.editReply('役職ロールを保有していません。');
    }

    // 複数モード → 選択メニュー
    if (matched.length > 1) {
      const options = matched.map(({ mode, rid }) => {
        const cfg = clientConfig[rid] || {};
        return {
          label: mode === 'diplomat' ? '外交官(外務省 総合外務部職員)' : '閣僚会議議員',
          value: rid,                     // **ここで roleId を返す**
          emoji: cfg.emoji,
        };
      });

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`rolepost-choose-${channelId}-${userId}`) // チャンネルも含めて一意化
        .setPlaceholder('モードを選択してください')
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(menu);
      return interaction.editReply({
        content: 'どのモードで発言モードを有効にしますか？',
        components: [row],
      });
    }

    // 単一モード → そのまま ON
    const { rid } = matched[0];
    setActive(channelId, userId, rid);
    const modeName = matched[0].mode === 'diplomat' ? '外交官(外務省 総合外務部職員)' : '閣僚会議議員';
    return interaction.editReply(`役職発言モードを **ON** にしました。（${modeName}）`);

  } catch (err) {
    console.error('[embedPost] execute error:', err);
    // defer していれば followUp、していなければ reply
    const method = interaction.deferred ? 'followUp' : 'reply';
    return interaction[method]({ content: '⚠️ コマンド実行中にエラーが発生しました。', ephemeral: true });
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

    const modeName = (process.env.ROLLID_DIPLOMAT || '').split(',').includes(roleId)
      ? '外交官(外務省 総合外務部職員)'
      : '閣僚会議議員';

    await interaction.update({
      content: `役職発言モードを **ON** にしました。（${modeName}）`,
      components: [],
    });
  } catch (err) {
    console.error('[embedPost] handleSelect error:', err);
    // 更新に失敗してももう一度応答を試みない
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
