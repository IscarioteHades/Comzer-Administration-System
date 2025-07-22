import { createRequire } from "module";
const require = createRequire(import.meta.url);
import './logger.js';
const config = require("./config.json"); // JSONを require で読み込む方法 :contentReference[oaicite:1]{index=1}
import * as embedPost from './commands/embedPost.js';
import axios from "axios";
import http from "node:http";
import fetch from 'node-fetch';
import { extractionPrompt } from "./prompts.js";
import * as statusCommand from './commands/status.js';
import { data as shutdownData, execute as shutdownExec } from './commands/shutdown.js';
import fs from "node:fs";
import mysql from 'mysql2/promise';
import {
  handleCommands,
  initBlacklist,
  isBlacklistedCountry,
  isBlacklistedPlayer,
} from "./blacklistCommands.js";
import {
  WebhookClient,
  Client,
  InteractionResponseType,
  MessageFlags,
  Collection,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  SelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType,
} from "discord.js";
import OpenAI from "openai";
import { GoogleSpreadsheet } from "google-spreadsheet";

const HEALTHZ_URL = 'https://comzer-gov.net/wp-json/czr/v1/healthz';
const API_URL   = "https://comzer-gov.net/wp-json/czr/v1/data-access";
const API_TOKEN = "WAITOTTEMOBANANATONYUSUKIYADE2025";

// ── HTTP keep-alive サーバー（Render用）
const port = process.env.PORT || 3000;
http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
}).listen(port, () => console.log(`Server listening on ${port}`));

// MySQL関連
let healthPromise;

async function verifyDbHealthOnce() {
  if (healthPromise) return healthPromise;

  healthPromise = (async () => {
    console.log('[Startup] DB接続チェック…', HEALTHZ_URL);
    let res;
    try {
      res = await fetch(HEALTHZ_URL);
    } catch (e) {
      console.error('[Startup] ヘルスエンドポイント到達失敗:', e.message);
      return { ok: false, error: e.message };
    }
    if (res.ok) {
      console.log('[Startup] DB 接続 OK');
      return { ok: true };
    }
    const body = await res.json().catch(() => ({}));
    console.error(
      `[Startup] DBヘルスチェック ${res.status} エラー:`,
      body.message || body
    );
    return { ok: false, status: res.status, message: body.message };
  })();

  return healthPromise;
}

// ── 環境変数
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TICKET_CAT = process.env.TICKET_CAT;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const ADMIN_KEYWORD = process.env.ADMIN_KEYWORD || "!status";
const SHEET_ID_RAW = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const sheetId = SHEET_ID_RAW.match(/[-\w]{25,}/)?.[0] || SHEET_ID_RAW;
const today = (new Date()).toISOString().slice(0,10);
const prompt = extractionPrompt.replace("__TODAY__", today);
const DIPLOMAT_ICON_URL = 'https://www.comzer-gov.net/database/index.php/s/5dwbifgYfsdWpZx/preview'; // ← 外務省アイコン URL
const MINISTER_ICON_URL = 'https://www.comzer-gov.net/database/index.php/s/qGWt4rftd9ygKdi/preview'; // ← 閣僚議会議員アイコン URL

// 1. 環境変数からロールIDリストを取得（例: 大臣・外交官どちらも）
const DIPLOMAT_ROLE_IDS = (process.env.ROLLID_DIPLOMAT || '').split(',').filter(Boolean);
const MINISTER_ROLE_IDS = (process.env.ROLLID_MINISTER || '').split(',').filter(Boolean);

// 2. 各役職ロールごとの設定（ここに削除権限リストも入れる！）
const ROLE_CONFIG = {
  // ── 外交官ロールをまとめて
  ...Object.fromEntries(
    DIPLOMAT_ROLE_IDS.map(roleId => [ roleId, {
      embedName:   '外交官(外務省 総合外務部職員)',
      embedIcon:   DIPLOMAT_ICON_URL,
      webhookName: 'コムザール連邦共和国 外務省',
      webhookIcon: DIPLOMAT_ICON_URL,
      canDelete: [...DIPLOMAT_ROLE_IDS],  
    }])
  ),
  // ── 閣僚議会議員ロールをまとめて
  ...Object.fromEntries(
    MINISTER_ROLE_IDS.map(roleId => [ roleId, {
      embedName:   '閣僚議会議員',
      embedIcon:   MINISTER_ICON_URL,
      webhookName: 'コムザール連邦共和国 大統領府',
      webhookIcon: MINISTER_ICON_URL,
      canDelete: [...MINISTER_ROLE_IDS], 
    }])
  ),
};
  Object.entries(ROLE_CONFIG).forEach(([roleId, cfg]) => {
    // embedName/embedIcon の内容を
    // 従来の name/icon プロパティとしても参照できるようにする
    cfg.name = cfg.embedName;
    cfg.icon = cfg.embedIcon;
  });

export { ROLE_CONFIG };
const webhooks = new Map();
async function getOrCreateHook(channel, roleId) {
  const key = `${channel.id}:${roleId}`;
  if (webhooks.has(key)) return webhooks.get(key);
  
  const whs = await channel.fetchWebhooks();
  const webhookName = ROLE_CONFIG[roleId].webhookName;
  const webhookIcon = ROLE_CONFIG[roleId].webhookIcon;
  
  const existing = whs.find(w => w.name === webhookName);
  const hook = existing
    ? new WebhookClient({ id: existing.id, token: existing.token })
    : await channel.createWebhook({
        name: webhookName,
        avatar: webhookIcon,
      });

  webhooks.set(key, hook);
  return hook;
}

// ── タイムゾーン定義
function nowJST() {
  const now = new Date();
  return now.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

// ── 合流者名簿用Googleシートの初期化
let sheet;
try {
  const doc = new GoogleSpreadsheet(sheetId);
  await doc.useServiceAccountAuth({
    client_email: SERVICE_ACCOUNT_EMAIL,
    private_key:  PRIVATE_KEY.replace(/\\n/g, '\n'),
  });
  await doc.loadInfo();
  sheet = doc.sheetsByTitle['コムザール連邦共和国'];
  console.log('✅ GoogleSheet 読み込み完了');
} catch (err) {
  console.error('❌ GoogleSheet 初期化失敗:', err);
}

// ── OpenAI／Discord Bot 初期化
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});
bot.ROLE_CONFIG = ROLE_CONFIG;
bot.commands = new Collection([
  [embedPost.data.name,     embedPost],
  [statusCommand.data.name, statusCommand],
  [shutdownData.name,       { data: shutdownData, execute: shutdownExec }],
]);
// ── Botがログインして準備完了したら一度だけblacklistCommands.js側を初期化
bot.once("ready", async () => {
  console.log(`Logged in as ${bot.user.tag} | initializing blacklist…`);
  await initBlacklist();
  console.log("✅ Bot ready & blacklist initialized");
  const health = await verifyDbHealthOnce();
  console.log("→ verifyDbHealthOnce() の戻り値:", health);
});

// ── セッション管理
const sessions = new Map();
function startSession(channelId, userId) {
  const id = `${channelId}-${userId}-${Date.now()}`;
  sessions.set(id, { id, channelId, userId, step: 'version', data: {}, logs: [], lastAction: Date.now() });
  return sessions.get(id);
}
async function endSession(id, status) {
  const session = sessions.get(id);
  if (!session) return;
  session.status = status;
  session.logs.push(`[${nowJST()}] セッション終了: ${status}`);
  const text = session.logs.join("\n");
  const buffer = Buffer.from(text, 'utf8');
  const channelName = bot.channels.cache.get(session.channelId)?.name || session.channelId;
  const fileName = `${channelName}-一時入国審査.txt`;
  const logChannel = bot.channels.cache.get(LOG_CHANNEL_ID);
  if (logChannel?.isTextBased()) {
    try {
      await logChannel.send({
        content: `セッション ${session.id} が ${status} しました。詳細ログを添付します。`,
        files: [{ attachment: buffer, name: fileName }],
      });
    } catch (err) {
      console.error('ログ送信エラー:', err);
    }
  }
  sessions.delete(id);
}

// ステータスメッセージ更新＆診断時刻管理
setInterval(() => {
  const jstTime = new Date().toLocaleString("ja-JP", { hour12: false });
  bot.user.setActivity(
    `コムザール行政システム(CAS) 稼働中 | 診断:${jstTime}`,
    { type: ActivityType.Watching }
  );
  statusCommand.updateLastSelfCheck(); // ←最終診断時刻を更新
}, 30 * 60 * 1000);

// BOT起動直後にも初期化
bot.once("ready", () => {
  const jstTime = new Date().toLocaleString("ja-JP", { hour12: false });
  bot.user.setActivity(
    `コムザール行政システム稼働中 | 最新自己診断時刻:${jstTime}`,
    { type: ActivityType.Watching }
  );
  statusCommand.updateLastSelfCheck();
});

// タイムアウト監視 (10 分)
setInterval(() => {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (now - session.lastAction > 10 * 60 * 1000) {
      session.logs.push(`[${nowJST()}] タイムアウト`);
      endSession(session.id, 'タイムアウト');
    }
  }
}, 60 * 1000);

// ── 審査ロジック
async function runInspection(content, session) {
  // 1. GPTで整形
  let parsed;
  try {
    const today = (new Date()).toISOString().slice(0,10);
    const prompt = extractionPrompt.replace("__TODAY__", today);
    const gptRes = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: content }
      ],
    });
    parsed = JSON.parse(gptRes.choices[0].message.content);
    if (parsed.companions && Array.isArray(parsed.companions)) {
        parsed.companions = parsed.companions.map(c =>
          typeof c === "string" ? { mcid: c } : c
        );
      }    
    session.logs.push(`[${nowJST()}] 整形結果: ${JSON.stringify(parsed, null, 2)}`);
  } catch (e) {
    session.logs.push(`[${nowJST()}] 整形エラー: ${e}`);
    return { approved: false, content: "申請内容の解析に失敗しました。もう一度ご入力ください。" };
  }

  // 2. ブラックリスト照合
  if (await isBlacklistedCountry(parsed.nation)) {
    session.logs.push(`[${nowJST()}] ＜Blacklist(国)該当＞ ${parsed.nation}`);
    return { approved: false, content: "申請された国籍は安全保障上の理由から入国を許可することができないため、却下します。" };
  }
  if (await isBlacklistedPlayer(parsed.mcid)) {
    session.logs.push(`[${nowJST()}] ＜Blacklist(プレイヤー)該当＞ ${parsed.mcid}`);
    return { approved: false, content: "申請されたMCIDは安全保障上の理由から入国を許可することができないため、却下します。" };
  }

  let exists = false;
  try {
  // セッション（引数session）に格納されたバージョン情報を使う
  // ない場合は"java"デフォルト
  const version = session?.data?.version || "java";
  const mcid = parsed.mcid.replace(/^BE_/, ""); // ユーザーがBE_付けてても外す

  const url = version === "java"
    ? `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(mcid)}`
    : `https://playerdb.co/api/player/xbox/${encodeURIComponent(mcid)}`;
  const resp = await axios.get(url, { validateStatus: () => true });
  exists = version === "java" ? resp.status === 200 : resp.data.success === true;
  } catch {}

  if (!exists) {
    return { approved: false, content: `申請者MCID「${parsed.mcid}」のアカウントチェックが出来ませんでした。綴りにお間違いはございませんか？` };
  }

  // 3. 同行者チェック（全員：同国籍のみ可・存在判定・ブラックリストも判定！）
  if (parsed.companions && Array.isArray(parsed.companions)) {
    parsed.companions = parsed.companions.map(c =>
      typeof c === "string" ? { mcid: c } : c
    );
  }
  if (parsed.companions && parsed.companions.length > 0) {
    for (const { mcid: companionId } of parsed.companions) {
      if (!companionId) continue;
      // ブラックリスト判定
      if (await isBlacklistedPlayer(companionId)) {
        return { approved: false, content: `同行者「${companionId}」は安全保障上の理由から入国を許可することができないため。` };
      }
      // Java/BE判定
      let version = session?.data?.version || "java";
      if (companionId.startsWith("BE_")) version = "bedrock";
      // "BE_"をAPI問い合わせ時には必ず外す
      const apiId = companionId.replace(/^BE_/, "");
      let exists = false;
      try {
        const url = version === "java"
          ? `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(apiId)}`
          : `https://playerdb.co/api/player/xbox/${encodeURIComponent(apiId)}`;
        const resp = await axios.get(url, { validateStatus: () => true });
        exists = version === "java" ? resp.status === 200 : resp.data.success === true;
      } catch {}
      if (!exists) {
        return { approved: false, content: `同行者MCID「${companionId}」のアカウントチェックが出来ませんでした。綴りにお間違いはございませんか？。` };
      }
      // 国籍も主申請者と一致が必須（※ここはparsed.companionsにnationが入っていれば比較）
      if (companionId.nation && companionId.nation !== parsed.nation) {
        return { approved: false, content: `同行者「${companionId}」は申請者と国籍が異なるため承認できません。国籍が異なる場合、それぞれご申告ください。` };
      }
    }
  }

  // 4. 合流者チェック（コムザール国民に実在確認）※旧コードの名簿参照部分を活用
  if (parsed.joiners && parsed.joiners.length > 0) {
  // ① 配列チェック
  const joinerList = parsed.joiners;
  console.log("[JoinerCheck] joinerList:", joinerList);
  console.log("[JoinerCheck] Sending Authorization:", `Bearer ${API_TOKEN}`);

  // ② WordPress プラグインに問い合わせ
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_TOKEN}`,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify({
        action:  "match_joiners_strict",
        joiners: joinerList
      })
    });
  } catch (e) {
    console.error("[JoinerCheck][Error] ネットワークエラー:", e.message);
    return {
      approved: false,
      content: "合流者チェックの通信に失敗しました。ネットワークをご確認ください。"
    };
  }

  // ③ レスポンスをパース
  const data = await res.json().catch(() => ({}));
  console.log(
    "[JoinerCheck] data.discord_ids:",
    JSON.stringify(data.discord_ids, null, 2)
  );

  // ④ エラー時は即リターン（開発者向けログを詳細に）
  if (!res.ok) {
    console.error("[JoinerCheck][Error] APIエラー");
    console.error(`  URL:    ${API_URL}`);
    console.error(`  Status: ${res.status} (${res.statusText})`);
    console.error("  Body:   ", JSON.stringify(data, null, 2));
    return {
      approved: false,
      content: data.message || `サーバーエラー(${res.status})が発生しました。`
    };
  }

  // ⑤ 成功時は Discord ID リストを構築しつつ、過程をログ
  parsed.joinerDiscordIds = joinerList
    .map(j => {
      const raw = j.trim();
      const key = raw.normalize("NFKC");  // PHP 側が raw キーを使う場合
      const id  = data.discord_ids?.[key];
      if (!id) {
        console.warn(`[JoinerCheck][Warn] raw "${raw}" が discord_ids のキーになっていません`);
      } else {
        console.log(`[JoinerCheck] raw "${raw}" → ID ${id}`);
      }
      return id;
    })
    .filter(Boolean);

  // ⑥ 最終的な ID リスト
  console.log("[JoinerCheck] parsed.joinerDiscordIds:", parsed.joinerDiscordIds);
}

  // 5. 審査ルール（例：期間チェックなど、自由に追加！）
  // 例: 期間が31日超えなら却下など（例示・要件に合わせて変更可）
  const start = new Date(parsed.start_datetime);
  const end = new Date(parsed.end_datetime);
  const periodHours = (end - start) / (1000 * 60 * 60);
  if (periodHours > 24*31) {
    return { approved: false, content: "申請期間が長すぎるため却下します（申請期間が31日を超える場合、31日で申請後、申請が切れる前に再審査をお願いいたします。）" };
  }
  // 必須項目チェック
  if (!parsed.mcid || !parsed.nation || !parsed.purpose || !parsed.start_datetime || !parsed.end_datetime) {
    return { approved: false, content: "申請情報に不足があります。全項目を入力してください。" };
  }
  const hasAllRequired = Boolean(
  parsed.mcid &&
  parsed.nation &&
  parsed.purpose &&
  parsed.start_datetime &&
  parsed.end_datetime
);
  console.log("🏷️ joiners:", parsed.joiners);
  console.log("🏷️ joinerDiscordIds:", parsed.joinerDiscordIds);
  console.log("🏷️ hasAllRequired:", hasAllRequired);

  if (parsed.joinerDiscordIds.length > 0 && hasAllRequired) {
  return {
  approved: false,
  confirmJoiner: true,
  discordId: String(parsed.joinerDiscordIds[0]),
  parsed,
  content: '合流者の確認中'    // ← ここを追加
};
} 
  return { approved: true, content: parsed };
}

async function doApproval(interaction, parsed, session) {
  const data = parsed;
  const today = (new Date()).toISOString().slice(0,10);
  const safeReplace = s => typeof s === "string" ? s.replace(/__TODAY__/g, today) : s;

  // embed①：申請者への通知
  const embed = new EmbedBuilder()
    .setTitle("一時入国審査結果")
    .setColor(0x3498db)
    .setDescription(
      "自動入国審査システムです。\n" +
      `> 審査結果：**承認**`
    )
    .addFields([
      { name: "申請者", value: data.mcid, inline: true },
      { name: "申請日", value: today, inline: true },
      { name: "入国目的", value: safeReplace(data.purpose), inline: true },
      { name: "入国期間", value: safeReplace(`${data.start_datetime} ～ ${data.end_datetime}`), inline: false },
      { name: "同行者", value:
          Array.isArray(data.companions) && data.companions.length
            ? data.companions.map(c => typeof c==="string"?c:c.mcid).join(", ")
            : "なし",
        inline: false
      },
      { name: "合流者", value:
          Array.isArray(data.joiners) && data.joiners.length
            ? data.joiners.join(", ")
            : "なし",
        inline: false
      },
      {
        name: "【留意事項】",
        value:
          "・在留期間の延長が予定される場合、速やかにこのチャンネルでお知らせください。合計31日を超える場合は再申請が必要です。\n" +
          "・申請内容に誤りがあった場合や法令違反時は承認が取り消される場合があります。\n" +
          "・あなたの入国情報は適切な範囲で国民に共有されます。\n" +
          "コムザール連邦共和国へようこそ。"
      }
    ]);

  // ① ユーザーへの編集済み返信
  await interaction.editReply({ embeds: [embed], components: [] });

  // embed②：公示用
  const publishEmbed = new EmbedBuilder()
    .setTitle("【一時入国審査に係る入国者の公示】")
    .setColor(0x27ae60)
    .setDescription("以下の外国籍プレイヤーの入国が承認された為、以下の通り公示いたします。(外務省入管部)")
    .addFields([
      { name: "申請者", value: data.mcid, inline: true },
      { name: "国籍", value: data.nation, inline: true },
      { name: "申請日", value: today, inline: true },
      { name: "入国目的", value: safeReplace(data.purpose), inline: true },
      { name: "入国期間", value: safeReplace(`${data.start_datetime} ～ ${data.end_datetime}`), inline: false },
      { name: "同行者", value:
          Array.isArray(data.companions) && data.companions.length
            ? data.companions.map(c => typeof c==="string"?c:c.mcid).join(", ")
            : "なし",
        inline: false
      },
      { name: "合流者", value:
          Array.isArray(data.joiners) && data.joiners.length
            ? data.joiners.join(", ")
            : "なし",
        inline: false
      }
    ]);

  // ② 公示用チャンネルに送信
  const publishChannelId = config.publishChannelId || config.logChannelId || LOG_CHANNEL_ID;
  const publishChannel = bot.channels.cache.get(publishChannelId);
  if (publishChannel?.isTextBased()) {
    await publishChannel.send({ embeds: [publishEmbed] });
  } else {
    console.error("公示用チャンネルが見つかりません。ID:", publishChannelId);
  }
}

  
// ── コンポーネント応答ハンドラ
bot.on('interactionCreate', async interaction => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isChatInputCommand()) return;
  if (interaction.isButton()) {
    const id = interaction.customId ?? "";
    // 「プレフィックス-セッションID」という形式でないものはスキップ
    if (!/^(start|cancel|confirm|edit)-/.test(id)) {
      return;
    }
  }
  try {
    // ① SelectMenuの処理（ON/OFF 切り替え）
   if (
     interaction.isStringSelectMenu() &&
     interaction.customId.startsWith('rolepost-choose-')
   ) {
      const roleId = interaction.values[0];
      embedPost.setActive(interaction.channelId, interaction.user.id, roleId);
      await interaction.update({
        content: `役職発言モードを **ON** にしました。（${ROLE_CONFIG[roleId].embedName}）`,
        components: [],
      });
      return;
    }
    
    // ① Chat-Input（Slash）コマンドのハンドル
if (interaction.isChatInputCommand()) {
  const cmd = bot.commands.get(interaction.commandName);
  if (cmd) {
    await cmd.execute(interaction);
    return;
  }
}
    // ② 既存の SlashCommand／Button の処理
    const handled = await handleCommands(interaction);
    if (handled) return;
  
      // DEBUG出力は省略可
      console.log(
        `[DEBUG] interactionCreate: type=${interaction.type}, ` +
        `isSelectMenu=${interaction.isStringSelectMenu?.()}, ` +
        `isButton=${interaction.isButton?.()}, customId=${interaction.customId}`
      );
  
      // ボタン処理
      if (interaction.isButton()) {
        const parts = interaction.customId.split('-');
        const type = parts[0];
        const sessionId = parts.slice(1).join('-');
        const session = sessions.get(sessionId);
        if (!session) {
          await interaction.reply({
            content: "このセッションは存在しないか期限切れです。最初からやり直してください。",
            ephemeral: true
          });
          return;
        }
        session.lastAction = Date.now();
  
        if (type === 'start') {
          session.logs.push(`[${nowJST()}] 概要同意: start`);
          const row = new ActionRowBuilder().addComponents(
            new SelectMenuBuilder()
              .setCustomId(`version-${session.id}`)
              .setPlaceholder('どちらのゲームエディションですか？')
              .addOptions([
                { label: 'Java', value: 'java' },
                { label: 'Bedrock', value: 'bedrock' },
              ])
          );
          return interaction.update({ content: 'ゲームエディションを選択してください。', components: [row] });
        }
  
        if (type === 'cancel') {
          session.logs.push(`[${nowJST()}] ユーザーが途中キャンセル`);
          await interaction.update({ content: '申請をキャンセルしました。', components: [] });
          return endSession(session.id, 'キャンセル');
        }
  
        // 確定ボタン押下後の処理
        // ── 進捗表示込みの confirm 処理 ──
        if (type === 'confirm') {
          await interaction.deferReply();
          session.logs.push(`[${nowJST()}] 確定ボタン押下`);

  // --- 進捗メッセージ用 ---
          let progressMsg = "申請内容を確認中…";
          await interaction.editReply({ content: progressMsg, components: [] });

  // タイムアウト監視Promise
          let isTimeout = false;
          const timeoutPromise = new Promise(resolve => {
            setTimeout(() => {
              isTimeout = true;
              resolve({
                approved: false,
                content: "システムが混雑しています。60秒以上応答がなかったため、タイムアウトとして処理を中断しました。"
              });
            }, 60000);
          });

  // runInspection実行Promise
          const inputText = [
            `MCID: ${session.data.mcid}`,
            `国籍: ${session.data.nation}`,
            `目的・期間: ${session.data.period}`,
            session.data.companions?.length
            ? `同行者: ${session.data.companions.join(', ')}`
      : '',
            session.data.joiner ? `合流者: ${session.data.joiner}` : ''
          ].filter(Boolean).join('\n');
          const inspectionPromise = (async () => {
            progressMsg = "申請内容のAI解析中…";
            await interaction.editReply({ content: progressMsg, components: [] });
            try {
              return await runInspection(inputText, session, async step => {
                progressMsg = step;
                await interaction.editReply({ content: progressMsg, components: [] });
              });
            } catch (err) {
              console.error('[ERROR] runInspection:', err);
              return { approved: false, content: '審査中にエラーが発生しました。' };
            }
          })();

  // どちらか早い方を採用
          const result = await Promise.race([timeoutPromise, inspectionPromise]);
          if (isTimeout) {
            await interaction.editReply({
              content: "⏳ 60秒間応答がなかったため、処理をタイムアウトで中断しました。再度申請してください。",
              components: []
            });
            session.logs.push(`[${nowJST()}] タイムアウトエラー`);
            return endSession(session.id, "タイムアウト");
          }

  // 保留：合流者確認が必要
          if (result.confirmJoiner) {
            const dmUser = await bot.users.fetch(result.discordId);
            const dm     = await dmUser.createDM();
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`joiner-yes-${session.id}`).setLabel('はい').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`joiner-no-${session.id}`).setLabel('いいえ').setStyle(ButtonStyle.Danger)
            );
            await dm.send({
              content: `${session.data.mcid} さんからあなたが合流者だと申請がありました。これは正しいですか？`,
              components: [row],
            });
            await interaction.editReply({
              content: '申請を受け付けました。しばらくお待ちください。',
              components: []
            });
            return;
          }

  // 却下
          if (result.approved === false) {
            await interaction.editReply({ content: result.content, components: [] });
            session.logs.push(`[${nowJST()}] 却下`);
            return endSession(session.id, '却下');
          }

  // 承認
          session.logs.push(`[${nowJST()}] 承認処理開始`);
          await doApproval(interaction, session.data.parsed, session);
          return endSession(session.id, '承認');
        }          
      } // ←このif(interaction.isButton())ブロック、ここで終わり！
  
      // --- セレクトメニュー処理 ---
      if (interaction.isStringSelectMenu()) {
          if (interaction.customId.startsWith('rolepost-choose-')) {
    return;
  }
        const parts = interaction.customId.split('-');
        const type = parts[0];
        const sessionId = parts.slice(1).join('-');
        const session = sessions.get(sessionId);
        if (!session) {
          console.error('[WARN] invalid sessionId:', sessionId);
          return;
        }
  
        session.lastAction = Date.now();
  
        if (type === 'version') {
          session.data.version = interaction.values[0];
          session.logs.push(`[${nowJST()}] 版選択: ${interaction.values[0]}`);
          session.step = 'mcid';
          return interaction.update({ content: 'MCID又はゲームタグを入力してください。("BE_"を付ける必要はありません。)', components: [] });
        }
      }
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "その操作にはまだ対応していません。",
        ephemeral: true,
      });
    }
        } catch (error) {
          // ── try ブロックをここで閉じる ↑↑↑
          console.error("❌ interactionCreate handler error:", error);
          // エラー通知は reply⇔followUp を振り分け
          try {
            if (interaction.deferred || interaction.replied) {
              await interaction.followUp({
                content: "エラーが発生しました。",
                flags: 1 << 6, // Ephemeral
              });
            } else {
              await interaction.reply({
                content: "エラーが発生しました。",
                flags: 1 << 6,
              });
            }
            return true;
          } catch (notifyErr) {
            console.error("❌ Failed to send error notification:", notifyErr);
          }
        }
      });

// ── メッセージ処理ハンドラ

     
  // ドロップダウンで保存された roleId を最優先
bot.on('messageCreate', async (m) =>  {
  if (!m.guild || !m.member) return;
  let roleId = embedPost.getRoleId(m.channel.id, m.author.id);
  // state がなければ、メンバーのロール一覧からフォールバック
  if (!roleId) {
    roleId = Object.keys(ROLE_CONFIG)
      .find(r => m.member.roles.cache.has(r));
  }
    if (roleId) {
      try {
        const hook = await getOrCreateHook(m.channel, roleId);

        const files = [...m.attachments.values()]
          .map(att => ({ attachment: att.url }));
        const firstImg = files.find(f =>
          /\.(png|jpe?g|gif|webp)$/i.test(f.attachment));

        await hook.send({
          embeds: [
            embedPost.makeEmbed(
              m.content || '(無言)',
              roleId,
              ROLE_CONFIG,
              firstImg?.attachment
            )
          ],
          files,
          allowedMentions: { users: [], roles: [roleId] },
        });

        await m.delete().catch(() => {});
 } catch (err) {
   console.error('[rolepost] resend error:', err);
 }
      return;
    }
  console.log('parentId:', m.channel.parentId, '（型：', typeof m.channel.parentId, '）');
  console.log('TICKET_CAT:', TICKET_CAT, '（型：', typeof TICKET_CAT, '）');
  console.log('mentions.has(bot.user):', m.mentions.has(bot.user));
  console.log('content:', m.content);

  if (m.content.trim() === ADMIN_KEYWORD) {
    const reportEmbed = new EmbedBuilder()
      .setTitle('管理レポート')
      .addFields(
        { name: '未完了セッション数', value: `${sessions.size}` },
      );
    return m.channel.send({ embeds: [reportEmbed] });
  }

  if (
  m.mentions.has(bot.user) &&
  String(m.channel.parentId) === String(TICKET_CAT) &&
  /ID:CAS/.test(m.content)
) {
    const session = startSession(m.channel.id, m.author.id);
    session.logs.push(`[${nowJST()}] セッション開始`);
    const introEmbed = new EmbedBuilder()
      .setTitle("自動入国審査システムです。")
      .setDescription(
        "こちらのチケットでは、旅行、取引、労働等を行うために一時的に入国を希望される方に対し、許可証を自動で発行しております。\n" +
        "審査は24時間365日いつでも受けられ、最短数分で許可証が発行されます。\n" +
        "以下の留意事項をよくお読みの上、次に進む場合は「進む」、申請を希望しない場合は「終了」をクリックしてください。"
      )
      .addFields({ name: '【留意事項】', value:
        "・入国が承認されている期間中、申告内容に誤りがあることが判明したり、[コムザール連邦共和国の明示する法令](https://comzer-gov.net/laws/) に違反した場合は承認が取り消されることがあります。\n" +
        "・法令の不知は理由に抗弁できません。\n" +
        "・損害を与えた場合、行政省庁は相当の対応を行う可能性があります。\n" +
        "・入国情報は適切な範囲で国民に共有されます。"
      });
    const introRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`start-${session.id}`).setLabel('進む').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cancel-${session.id}`).setLabel('終了').setStyle(ButtonStyle.Danger)
    );
    return m.reply({ embeds: [introEmbed], components: [introRow] });
  }

  // －－メッセージハンドラ
  for (const session of sessions.values()) {
    if (session.channelId === m.channel.id && session.userId === m.author.id) {
      session.lastAction = Date.now();
      if (session.step === 'mcid') {
        session.data.mcid = m.content.trim();
        session.logs.push(`[${nowJST()}] MCID入力: ${session.data.mcid}`);
        session.step = 'nation';
        return m.reply('国籍を入力してください。');
      }
      if (session.step === 'nation') {
        const raw = m.content.trim();
        session.data.nation = raw;
        session.logs.push(`[${nowJST()}] 国籍入力: ${session.data.nation}`);
        session.step = 'period';
        return m.reply('一時入国期間と目的を入力してください。（例: 観光で10日間）');
}
      if (session.step === 'period') {
        session.data.period = m.content.trim();
        session.logs.push(`[${nowJST()}] 期間・目的入力: ${session.data.period}`);
        session.step = 'companions';  // ←ここでcompanionsに遷移！
        return m.reply('同じ国籍で同行者がいる場合、MCIDをカンマ区切りで入力してください（例:user1,BE_user2）。いなければ「なし」と入力してください。');
      }

      if (session.step === 'companions') {
        const comp = m.content.trim();
        if (comp === 'なし' || comp === 'ナシ' || comp.toLowerCase() === 'none') {
          session.data.companions = [];
        } else {
          session.data.companions = comp.split(',').map(x => x.trim()).filter(Boolean);
        }
        session.logs.push(`[${nowJST()}] 同行者入力: ${comp}`);
        session.step = 'joiner';
        return m.reply('コムザール連邦共和国に国籍を有する者で、入国後合流者がいる場合はお名前(MCID,DIscordID等)を、いなければ「なし」と入力してください。');
      }
      if (session.step === 'joiner') {
        session.data.joiner = m.content.trim() !== 'なし' ? m.content.trim() : null;
        session.logs.push(`[${nowJST()}] 合流者入力: ${session.data.joiner || 'なし'}`);
        session.step = 'confirm';
        const summary = [
          `ゲームバージョン: ${session.data.version}`,
          `MCID: ${session.data.mcid}`,
          `国籍: ${session.data.nation}`,
          `期間: ${session.data.period}`,
          `同行者: ${session.data.companions && session.data.companions.length > 0 ? session.data.companions.join(', ') : 'なし'}`,
          `合流者: ${session.data.joiner || 'なし'}`
        ].join('\n');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`confirm-${session.id}`).setLabel('確定').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`edit-${session.id}`).setLabel('修正').setStyle(ButtonStyle.Secondary)
        );
        return m.reply({ content: `以下の内容で審査を実行しますか？\n${summary}`, components: [row] });
      }  
      }
  })


// ── Bot 起動
bot.login(DISCORD_TOKEN);
