import {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
} from 'discord.js';

/* --------------------------------------------------
 * 1. /rolepost スラッシュコマンドの定義
 * -------------------------------------------------- */
export const data = new SlashCommandBuilder()
  .setName('rolepost')
  .setDescription('役職発言モードの ON / OFF を切り替えます（トグル式）');

/* --------------------------------------------------
 * 2. 発言モードの状態管理（Map<channelId, Map<userId, roleId>>）
 * -------------------------------------------------- */
const activeChannels = new Map();  // Map<string, Map<string, string>>

// 指定チャンネルの Map がなければ作る
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
  const chMap = ensureChannelMap(channelId);
  chMap.set(userId, roleId);
}

export function setInactive(channelId, userId) {
  const chMap = activeChannels.get(channelId);
  if (chMap) chMap.delete(userId);
}

/* --------------------------------------------------
 * 3. /rolepost コマンド本体
 * -------------------------------------------------- */
export async function execute(interaction) {
  if (interaction.replied || interaction.deferred) return;
  await interaction.deferReply({ ephemeral: true });

  const member       = interaction.member;
  const ROLE_CONFIG  = interaction.client.ROLE_CONFIG || {};
  const channelId    = interaction.channelId;
  const userId       = interaction.user.id;

  // ON → OFF 切り替え
  if (isActive(channelId, userId)) {
    setInactive(channelId, userId);
    return interaction.editReply({ content: '役職発言モードを **OFF** にしました。' });
  }

  // 保有ロールのフィルタリング
  const userRoles      = member.roles.cache.map(r => r.id);
  const allowedRoleIds = Object.keys(ROLE_CONFIG);
  const matchedRoleIds = allowedRoleIds.filter(id => userRoles.includes(id));

  if (matchedRoleIds.length === 0) {
    return interaction.editReply({ content: '役職ロールを保有していません。' });
  }

  // 複数ロール→選択メニュー
  if (matchedRoleIds.length > 1) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`rolepost-choose-${userId}`)
      .setPlaceholder('役職を選択してください')
      .addOptions(
        matchedRoleIds.map(rid => ({
          // ラベルに末尾4桁を追加してユニーク化
          label: `${ROLE_CONFIG[rid].name} (${rid.slice(-4)})`,
          value: rid,
          emoji: ROLE_CONFIG[rid].emoji || undefined,
        }))
      );
    const row = new ActionRowBuilder().addComponents(menu);
    return interaction.editReply({
      content: 'どの役職で発言モードを有効にしますか？',
      components: [row],
    });
  }

  // 単一ロールなら即ON
  setActive(channelId, userId, matchedRoleIds[0]);
  return interaction.editReply({
    content: `役職発言モードを **ON** にしました。（${ROLE_CONFIG[matchedRoleIds[0]].name}）`,
  });
}

/* --------------------------------------------------
 * 4. 選択メニューのレスポンス処理
 * -------------------------------------------------- */
export async function handleRolepostSelect(interaction) {
  const [ , , userId ] = interaction.customId.split('-');
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: 'あなた以外は操作できません。', ephemeral: true });
  }

  const roleId = interaction.values[0];
  setActive(interaction.channelId, userId, roleId);

  const roleName = interaction.client.ROLE_CONFIG?.[roleId]?.name || '不明なロール';
  await interaction.update({
    content: `役職発言モードを **ON** にしました。（${roleName}）`,
    components: [],
  });
}

/* --------------------------------------------------
 * 5. Embed 生成ヘルパー
 * -------------------------------------------------- */
export function makeEmbed(content, roleId, ROLE_CONFIG, attachmentURL = null) {
  const cfg = ROLE_CONFIG[roleId];
  const embed = new EmbedBuilder()
    .setAuthor({ name: cfg.embedName, iconURL: cfg.embedIcon })
    .setDescription(content)
    .setColor(cfg.embedColor ?? 0x3498db)

  if (attachmentURL) {
    embed.setImage(attachmentURL);
  }
  return embed;
}
