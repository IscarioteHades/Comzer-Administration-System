// blacklistCommands.js

import { SlashCommandBuilder } from "@discordjs/builders";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { execute as executeStatus } from "./commands/status.js";

// Googleシート設定
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const TAB_NAME = process.env.BLACKLIST_TAB_NAME || "blacklist(CAS連携)";

let sheet;

// 初期化
export async function initBlacklist() {
  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth({
    client_email: SERVICE_ACCOUNT_EMAIL,
    private_key: PRIVATE_KEY.replace(/\\n/g, "\n"),
  });
  await doc.loadInfo();
  sheet = doc.sheetsByTitle[TAB_NAME];
  if (!sheet) throw new Error(`Tab '${TAB_NAME}' not found`);
}

// 追加 or 再有効化
export async function addBlacklistEntry(type, value, reason = "") {
  if (!sheet) await initBlacklist();
  const rows = await sheet.getRows();
  const today = new Date().toISOString().split("T")[0];

  // Active重複
  let already = rows.find(r => r['Type(Country/Player)'] === type && r.value === value && r.status === "Active");
  if (already) return { result: "duplicate" };

  // invalid → Activeへ再有効化
  let invalidRow = rows.find(r => r['Type(Country/Player)'] === type && r.value === value && r.status === "invalid");
  if (invalidRow) {
    invalidRow.status = "Active";
    invalidRow.reason = reason;
    invalidRow.date = today;
    await invalidRow.save();
    return { result: "reactivated" };
  }

  // 新規登録
  await sheet.addRow({
    'Type(Country/Player)': type,
    'status': "Active",
    value,
    reason,
    date: today
  });
  return { result: "added" };
}

// 論理削除
export async function removeBlacklistEntry(type, value) {
  if (!sheet) await initBlacklist();
  const rows = await sheet.getRows();
  const row = rows.find(r => r['Type(Country/Player)'] === type && r.value === value && r.status === "Active");
  if (!row) return { result: "notfound" };
  row.status = "invalid";
  row.date = new Date().toISOString().split("T")[0];
  await row.save();
  return { result: "invalidated" };
}

// Activeのみ取得
export async function getActiveBlacklist(type) {
  if (!sheet) await initBlacklist();
  const rows = await sheet.getRows();
  return rows.filter(r => r['Type(Country/Player)'] === type && r.status === "Active");
}

// ブラックリスト判定
export async function isBlacklistedPlayer(mcid) {
  const players = await getActiveBlacklist("Player");
  return players.some(r => r.value === mcid);
}
export async function isBlacklistedCountry(country) {
  const countries = await getActiveBlacklist("Country");
  return countries.some(r => r.value === country);
}

// ----- コマンド定義 -----
export const commands = [
  new SlashCommandBuilder()
    .setName("add_country")
    .setDescription("ブラックリスト(国)に追加")
    .addStringOption(o =>
      o.setName("name").setDescription("国名").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("remove_country")
    .setDescription("ブラックリスト(国)から削除")
    .addStringOption(o =>
      o.setName("name").setDescription("国名").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("add_player")
    .setDescription("ブラックリスト(プレイヤー)に追加")
    .addStringOption(o =>
      o.setName("mcid").setDescription("MCID").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("remove_player")
    .setDescription("ブラックリスト(プレイヤー)から削除")
    .addStringOption(o =>
      o.setName("mcid").setDescription("MCID").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("list_blacklist")
    .setDescription("ブラックリストの一覧を表示"),
];

// ----- コマンド登録 -----
export async function registerCommands(bot) {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationCommands(bot.user.id),
    { body: commands.map(c => c.toJSON()) }
  );
  console.log("✅ Slash commands registered");
}

// ----- コマンド実行時のハンドラ -----
export async function handleCommands(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  const name = interaction.commandName;

  // 管理者チェック（環境変数 ADMIN_IDS に許可ユーザーIDをカンマ区切りで）
  const adminIds = process.env.ADMIN_IDS?.split(",") || [];
  if (!adminIds.includes(interaction.user.id)) {
    await interaction.reply({ content: "君はステージが低い。君のコマンドを受け付けると君のカルマが私の中に入って来て私が苦しくなる。(権限エラー)", ephemeral: true });
    return true;
  }

  if (name === "add_country") {
    const country = interaction.options.getString("name", true).trim();
    const result = await addBlacklistEntry("Country", country, "");
    if (result.result === "duplicate") {
      await interaction.reply(`⚠️ 既にブラックリスト(国) に登録されています`);
    } else if (result.result === "reactivated") {
      await interaction.reply(`🟢 無効だった「${country}」を再有効化しました`);
    } else if (result.result === "added") {
      await interaction.reply(`✅ ブラックリスト(国) に「${country}」を追加しました`);
    }
    return true;
  }

  if (name === "remove_country") {
    const country = interaction.options.getString("name", true).trim();
    const result = await removeBlacklistEntry("Country", country);
    if (result.result === "invalidated") {
      await interaction.reply(`🟣 「${country}」を無効化しました`);
    } else {
      await interaction.reply(`⚠️ ブラックリスト(国) に「${country}」は存在しません`);
    }
    return true;
  }

  if (name === "add_player") {
    const mcid = interaction.options.getString("mcid", true).trim();
    const result = await addBlacklistEntry("Player", mcid, "");
    if (result.result === "duplicate") {
      await interaction.reply(`⚠️ 既にブラックリスト(プレイヤー) に登録されています`);
    } else if (result.result === "reactivated") {
      await interaction.reply(`🟢 無効だった「${mcid}」を再有効化しました`);
    } else if (result.result === "added") {
      await interaction.reply(`✅ ブラックリスト(プレイヤー) に「${mcid}」を追加しました`);
    }
    return true;
  }

  if (name === "remove_player") {
    const mcid = interaction.options.getString("mcid", true).trim();
    const result = await removeBlacklistEntry("Player", mcid);
    if (result.result === "invalidated") {
      await interaction.reply(`🟣 「${mcid}」を無効化しました`);
    } else {
      await interaction.reply(`⚠️ ブラックリスト(プレイヤー) に「${mcid}」は存在しません`);
    }
    return true;
  }

  if (name === "list_blacklist") {
    const countries = await getActiveBlacklist("Country");
    const players = await getActiveBlacklist("Player");
    const countryList = countries.length > 0 ? countries.map(r => r.value).join('\n') : "なし";
    const playerList = players.length > 0 ? players.map(r => r.value).join('\n') : "なし";
    await interaction.reply({
      embeds: [{
        title: "ブラックリスト一覧",
        fields: [
          { name: "国", value: countryList, inline: false },
          { name: "プレイヤー", value: playerList, inline: false },
        ],
        color: 0x2c3e50
      }],
      ephemeral: true
    });
    return true;
  }

  if (name === "status") {
    await executeStatus(interaction);
    return true;
  }
  return false;
}
