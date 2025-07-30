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
 * 2. 発言モード管理（Map<channelId, Map<userId, modeKey>>）
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

export function getModeKey(channelId, userId) {
  const chMap = activeChannels.get(channelId);
  return chMap ? chMap.get(userId) : null;
}

export function setActive(channelId, userId, modeKey) {
  ensureChannelMap(channelId).set(userId, modeKey);
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
    // 1) 忘れずに deferReply
    await interaction.deferReply({ ephemeral: true });

    // 2) 必要な変数を先に取り出し
    const member       = interaction.member;
    const clientConfig = interaction.client.ROLE_CONFIG || {};
    const channelId    = interaction.channelId;
    const userId       = interaction.user.id;

    // 3) ON→OFF トグル
    if (isActive(channelId, userId)) {
      setInactive(channelId, userId);
      return interaction.editReply('役職発言モードを **OFF** にしました。');
    }

    // 4) ユーザーの Discord ロールID一覧を取得
    const userRoles = member.roles.cache.map(r => r.id);

    // 5) 各モード (modeKey) ごとに cfg.envVar から roleIds を取得してマッチング
    const matched = Object.entries(clientConfig).flatMap(
      ([modeKey, cfg]) => {
        // cfg.envVar から roleIds を取得
        const ids = (process.env[cfg.envVar] || '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
        // ユーザーが持っているものを抽出
        const hitIds = ids.filter(id => userRoles.includes(id));
        // hitIds が 1 つ以上あれば「このモードにマッチ」とする
        return hitIds.length > 0
          ? [{ modeKey, cfg, roleIds: hitIds }]
          : [];
      }
    );

    if (matched.length === 0) {
      return interaction.editReply('役職ロールを保有していません。');
    }

    // 6) 複数モード → 選択メニュー
    if (matched.length > 1) {
      const options = matched.map(({ modeKey, cfg }) => ({
        label: cfg.embedName,
        value: modeKey,
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

    // 7) 単一モード → ON
    const { modeKey, cfg } = matched[0];
    setActive(channelId, userId, modeKey);
    return interaction.editReply(
      `役職発言モードを **ON** にしました。（${cfg.embedName}）`
    );

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

    const selectedModeKey = interaction.values[0];
    setActive(channelId, userId, selectedModeKey);

    const cfg = interaction.client.ROLE_CONFIG[selectedModeKey] || {};
    const modeName = cfg.embedName || '不明なモード';

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
export function makeEmbed(content, modeKey, roleConfigMap, attachmentURL = null) {
  const cfg = roleConfigMap[modeKey];
  if (!cfg) {
    console.error(`[makeEmbed] Unknown modeKey: ${modeKey}`);
    return new EmbedBuilder()
      .setDescription(content)
      .setFooter({ text: `MODE_KEY:${modeKey} (未定義)` });
  }

  const embed = new EmbedBuilder()
    .setAuthor({ name: cfg.embedName, iconURL: cfg.embedIcon })
    .setDescription(content)
    .setColor(cfg.embedColor ?? 0x3498db);

  if (attachmentURL) embed.setImage(attachmentURL);
  return embed;
}
