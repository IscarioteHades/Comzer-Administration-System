// blacklistCommands.js

import { SlashCommandBuilder } from "@discordjs/builders";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { execute as executeStatus } from "./commands/status.js";
import { ROLE_CONFIG } from "./index.js";

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
  .setName("delete_rolepost")
  .setDescription("役職発言（Bot発言）の削除")
  .addStringOption(o =>
    o.setName("message_id").setDescription("削除するメッセージのID").setRequired(true)
  ),
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
// ----- コマンド実行時のハンドラ -----
export async function handleCommands(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  const name = interaction.commandName;

  // 権限チェック
  const ALLOWED_ROLE_IDS = [
    ...(process.env.ROLLID_MINISTER ? process.env.ROLLID_MINISTER.split(',') : []),
    ...(process.env.ROLLID_DIPLOMAT ? process.env.ROLLID_DIPLOMAT.split(',') : []),
  ].map(x => x.trim()).filter(Boolean);

  const userRoleIds = interaction.member?.roles?.cache.map(r => String(r.id));
  const hasRole = ALLOWED_ROLE_IDS.map(r => String(r)).some(roleId => userRoleIds.includes(roleId));

  console.log('【権限チェック】有効ロールID:', ALLOWED_ROLE_IDS);
  console.log('【権限チェック】ユーザーロールID:', userRoleIds);
  console.log('【権限チェック】member:', interaction.member);
  console.log('【権限チェック】hasRole:', hasRole);

  if (!hasRole) {
    console.trace("権限エラーreply!");
    if (!interaction.replied && !interaction.deferred) {
      console.log("REPLY DEBUG", {
        where: "権限チェック",
        command: name,
        reply: "権限エラー文言",
        hasRole, ALLOWED_ROLE_IDS, userRoleIds,
        replied: interaction.replied,
        deferred: interaction.deferred
      });
      await interaction.reply({ content: "君はステージが低い。君のコマンドを受け付けると君のカルマが私の中に入って来て私が苦しくなる。(権限エラー)", ephemeral: true });
    }
    return true;
  }

  if (name === "add_country") {
    const country = interaction.options.getString("name", true).trim();
    const result = await addBlacklistEntry("Country", country, "");
    if (result.result === "duplicate") {
      if (!interaction.replied && !interaction.deferred) {
        console.log("REPLY DEBUG", {
          where: "add_country-duplicate",
          reply: "既にブラックリスト(国)に登録",
          replied: interaction.replied,
          deferred: interaction.deferred
        });
        await interaction.reply(`⚠️ 既にブラックリスト(国) に登録されています`);
      }
    } else if (result.result === "reactivated") {
      if (!interaction.replied && !interaction.deferred) {
        console.log("REPLY DEBUG", {
          where: "add_country-reactivated",
          reply: "無効を再有効化",
          replied: interaction.replied,
          deferred: interaction.deferred
        });
        await interaction.reply(`🟢 無効だった「${country}」を再有効化しました`);
      }
    } else if (result.result === "added") {
      if (!interaction.replied && !interaction.deferred) {
        console.log("REPLY DEBUG", {
          where: "add_country-added",
          reply: "ブラックリストに追加",
          replied: interaction.replied,
          deferred: interaction.deferred
        });
        await interaction.reply(`✅ ブラックリスト(国) に「${country}」を追加しました`);
      }
    }
    return true;
  }

  if (name === "remove_country") {
    const country = interaction.options.getString("name", true).trim();
    const result = await removeBlacklistEntry("Country", country);
    if (result.result === "invalidated") {
      console.log("REPLY DEBUG", {
        where: "remove_country-invalidated",
        reply: "無効化",
        replied: interaction.replied,
        deferred: interaction.deferred
      });
      await interaction.reply(`🟣 「${country}」を無効化しました`);
    } else {
      console.log("REPLY DEBUG", {
        where: "remove_country-notfound",
        reply: "存在しません",
        replied: interaction.replied,
        deferred: interaction.deferred
      });
      await interaction.reply(`⚠️ ブラックリスト(国) に「${country}」は存在しません`);
    }
    return true;
  }

  if (name === "add_player") {
    const mcid = interaction.options.getString("mcid", true).trim();
    const result = await addBlacklistEntry("Player", mcid, "");
    if (result.result === "duplicate") {
      console.log("REPLY DEBUG", {
        where: "add_player-duplicate",
        reply: "既にブラックリスト(プレイヤー)に登録",
        replied: interaction.replied,
        deferred: interaction.deferred
      });
      await interaction.reply(`⚠️ 既にブラックリスト(プレイヤー) に登録されています`);
    } else if (result.result === "reactivated") {
      console.log("REPLY DEBUG", {
        where: "add_player-reactivated",
        reply: "無効を再有効化",
        replied: interaction.replied,
        deferred: interaction.deferred
      });
      await interaction.reply(`🟢 無効だった「${mcid}」を再有効化しました`);
    } else if (result.result === "added") {
      console.log("REPLY DEBUG", {
        where: "add_player-added",
        reply: "ブラックリストに追加",
        replied: interaction.replied,
        deferred: interaction.deferred
      });
      await interaction.reply(`✅ ブラックリスト(プレイヤー) に「${mcid}」を追加しました`);
    }
    return true;
  }

  if (name === "remove_player") {
    const mcid = interaction.options.getString("mcid", true).trim();
    const result = await removeBlacklistEntry("Player", mcid);
    if (result.result === "invalidated") {
      console.log("REPLY DEBUG", {
        where: "remove_player-invalidated",
        reply: "無効化",
        replied: interaction.replied,
        deferred: interaction.deferred
      });
      await interaction.reply(`🟣 「${mcid}」を無効化しました`);
    } else {
      console.log("REPLY DEBUG", {
        where: "remove_player-notfound",
        reply: "存在しません",
        replied: interaction.replied,
        deferred: interaction.deferred
      });
      await interaction.reply(`⚠️ ブラックリスト(プレイヤー) に「${mcid}」は存在しません`);
    }
    return true;
  }

  if (name === "list_blacklist") {
    const countries = await getActiveBlacklist("Country");
    const players = await getActiveBlacklist("Player");
    const countryList = countries.length > 0 ? countries.map(r => r.value).join('\n') : "なし";
    const playerList = players.length > 0 ? players.map(r => r.value).join('\n') : "なし";
    console.log("REPLY DEBUG", {
      where: "list_blacklist",
      reply: "一覧送信",
      replied: interaction.replied,
      deferred: interaction.deferred
    });
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

  if (name === "delete_rolepost") {
    const messageId = interaction.options.getString("message_id", true);
    const channel = interaction.channel;
    try {
      const msg = await channel.messages.fetch(messageId);
      if (!msg.webhookId) {
        console.log("REPLY DEBUG", {
          where: "delete_rolepost-author",
          reply: "Bot以外は不可",
          replied: interaction.replied,
          deferred: interaction.deferred
        });
        await interaction.reply({ content: "コムザール行政システムが送信した役職発言のみ削除できます。", ephemeral: true });
        return true;
      }

      const embed = msg.embeds[0];
      if (!embed || !embed.footer?.text) {
        console.log("REPLY DEBUG", {
          where: "delete_rolepost-embed",
          reply: "役職発言以外不可",
          replied: interaction.replied,
          deferred: interaction.deferred
        });
        await interaction.reply({ content: "役職発言以外は削除できません。", ephemeral: true });
        return true;
      }
      const match = embed.footer.text.match(/ROLE_ID:(\d+)/);
      if (!match) {
        console.log("REPLY DEBUG", {
          where: "delete_rolepost-roleid",
          reply: "役職情報なし",
          replied: interaction.replied,
          deferred: interaction.deferred
        });
        await interaction.reply({ content: "役職情報が付与されていない発言です。", ephemeral: true });
        return true;
      }
      const roleIdOfPost = match[1];
      const canDeleteRoleIds = ROLE_CONFIG[roleIdOfPost]?.canDelete || [];
      const userRoleIds = interaction.member.roles.cache.map(r => r.id);

      const isAllowed = canDeleteRoleIds.some(rid => userRoleIds.includes(rid));
      if (!isAllowed) {
        console.log("REPLY DEBUG", {
          where: "delete_rolepost-authority",
          reply: "削除権限なし",
          replied: interaction.replied,
          deferred: interaction.deferred
        });
        await interaction.reply({ content: "あなたはこの役職発言を削除する権限がありません。", ephemeral: true });
        return true;
      }

      console.log("REPLY DEBUG", {
        where: "delete_rolepost-success",
        reply: "削除成功",
        replied: interaction.replied,
        deferred: interaction.deferred
      });
      await msg.delete();
      await interaction.reply({ content: "メッセージを削除しました。", ephemeral: true });
    } catch (e) {
      console.log("REPLY DEBUG", {
        where: "delete_rolepost-catch",
        reply: "削除例外",
        replied: interaction.replied,
        deferred: interaction.deferred
      });
      await interaction.reply({ content: "メッセージが見つからないか、削除できませんでした。", ephemeral: true });
    }
    return true;
  }

  if (name === "status") {
    // statusコマンド本体でreplyするためdebug不要
    await executeStatus(interaction);
    return true;
  }

  return false;
}

