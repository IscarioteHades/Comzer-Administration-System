// commands/status.js
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import axios from 'axios';
export async function execute(interaction) {
  if (interaction.replied || interaction.deferred) return;

// 最終診断時刻の保持
export let lastSelfCheck = new Date();
export function updateLastSelfCheck() {
  lastSelfCheck = new Date();
}

// コマンド定義
export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('BOTの最終自己診断時刻と連携状態を表示');

// コマンド実行本体
export async function execute(interaction) {
  // JSTで表示
  const timeStr = lastSelfCheck.toLocaleString('ja-JP', { hour12: false, timeZone: 'Asia/Tokyo' });

  // ① Google Sheets（国民名簿・ブラックリスト）連携チェック
  let citizenSheet = '⛔ 国民名簿：連携失敗';
  let blacklistSheet = '⛔ ブラックリスト：連携失敗';
  try {
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
    await doc.loadInfo();
    if (doc.sheetsByTitle['コムザール連邦共和国']) {
      citizenSheet = '✅ 国民名簿：連携中';
    }
    if (doc.sheetsByTitle[process.env.BLACKLIST_TAB_NAME || 'blacklist(CAS連携)']) {
      blacklistSheet = '✅ ブラックリスト：連携中';
    }
  } catch {
    // 失敗時は上記のまま
  }

  // ② Mojang API（Java版MCID）疎通
  let mojangApi = '⛔ Mojang API：連携失敗';
  try {
    const resp = await axios.get('https://api.mojang.com/users/profiles/minecraft/Notch', { timeout: 3000 });
    if (resp.status === 200) mojangApi = '✅ Mojang API：連携中';
  } catch {}

  // ③ PlayerDB API（Bedrock/Xboxユーザー）疎通
  let bedrockApi = '⛔ Bedrock API：連携失敗';
  try {
    const resp = await axios.get('https://playerdb.co/api/player/xbox/Notch', { timeout: 3000 });
    // PlayerDBのAPIは success:true のJSONが返る
    if (resp.data && resp.data.success) bedrockApi = '✅ Bedrock API：連携中';
  } catch {}
  if (interaction.replied || interaction.deferred) return;
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("CAS自己診断プログラムを実行しました")
        .setDescription(
          `✅ 最終診断時刻：${timeStr}\n` +
          `${citizenSheet}\n` +
          `${blacklistSheet}\n` +
          `${mojangApi}\n` +
          `${bedrockApi}`
        )
        .setColor(0x2ecc71)
    ],
    ephemeral: true,
  });
}
