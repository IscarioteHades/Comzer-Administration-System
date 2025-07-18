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
 * 3. /rolepost コマンド本体（モード単位判定版）
 * -------------------------------------------------- */
export async function execute(interaction) {
  if (interaction.replied || interaction.deferred) return;
  await interaction.deferReply({ ephemeral: true });

  const member     = interaction.member;
  const ROLE_CONFIG = interaction.client.ROLE_CONFIG || {};
  const channelId  = interaction.channelId;
  const userId     = interaction.user.id;

  // ON → OFF 切り替え
  if (isActive(channelId, userId)) {
    setInactive(channelId, userId);
    return interaction.editReply({ content: '役職発言モードを **OFF** にしました。' });
  }

  // 環境変数からモード別ロールリストを取得
  const diplomatRoles = (process.env.ROLLID_DIPLOMAT || '').split(',').filter(Boolean);
  const ministerRoles = (process.env.ROLLID_MINISTER  || '').split(',').filter(Boolean);

  // 実行者のロールID一覧
  const userRoles = member.roles.cache.map(r => r.id);

  // どのモードを持っているかを判定
  const matchedModes = [];
  if (diplomatRoles.some(rid => userRoles.includes(rid))) {
    matchedModes.push('diplomat');
  }
  if (ministerRoles.some(rid => userRoles.includes(rid))) {
    matchedModes.push('minister');
  }

  // モード未保持
  if (matchedModes.length === 0) {
    return interaction.editReply({ content: '役職ロールを保有していません。' });
  }

  // 複数モード保持 → 選択メニュー表示
  if (matchedModes.length > 1) {
    const options = matchedModes.map(mode => {
      if (mode === 'diplomat') {
        return {
          label: '外交官モード',
          value: 'diplomat',
          emoji: ROLE_CONFIG[diplomatRoles[0]]?.emoji
        };
      } else {
        return {
          label: '閣僚モード',
          value: 'minister',
          emoji: ROLE_CONFIG[ministerRoles[0]]?.emoji
        };
      }
    });

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`rolepost-choose-${userId}`)
      .setPlaceholder('役職モードを選択してください')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(menu);
    return interaction.editReply({
      content: 'どのモードで発言モードを有効にしますか？',
      components: [row],
    });
  }

  // 単一モード保持なら即 ON
  const mode = matchedModes[0];
  const roleId = mode === 'diplomat'
    ? diplomatRoles[0]
    : ministerRoles[0];

  setActive(channelId, userId, roleId);
  const modeName = mode === 'diplomat' ? '外交官モード' : '閣僚モード';
  return interaction.editReply({
    content: `役職発言モードを **ON** にしました。（${modeName}）`,
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

  const mode = interaction.values[0];  // 'diplomat' or 'minister'
  const diplomatRoles = (process.env.ROLLID_DIPLOMAT || '').split(',').filter(Boolean);
  const ministerRoles = (process.env.ROLLID_MINISTER  || '').split(',').filter(Boolean);
  const roleId = mode === 'diplomat'
    ? diplomatRoles[0]
    : ministerRoles[0];

  setActive(interaction.channelId, userId, roleId);

  const modeName = mode === 'diplomat' ? '外交官モード' : '閣僚モード';
  await interaction.update({
    content: `役職発言モードを **ON** にしました。（${modeName}）`,
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
    .setColor(cfg.embedColor ?? 0x3498db);

  if (attachmentURL) {
    embed.setImage(attachmentURL);
  }
  return embed;
}
