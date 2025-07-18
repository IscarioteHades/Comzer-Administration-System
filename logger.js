// logger.js

//  標準モジュール読み込み
import https from 'https';
import { URL } from 'url';

const { DISCORD_WEBHOOK_URL } = process.env;

// Discord Webhook に送信する関数
function sendToWebhook(message) {
  if (!DISCORD_WEBHOOK_URL) return;

  const payload = JSON.stringify({
    content: `\`\`\`\n${message}\n\`\`\``,
  });

  const url = new URL(DISCORD_WEBHOOK_URL);
  const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const req = https.request(options, (res) => {
    if (res.statusCode >= 400) {
      console.error(`[WebhookError] Failed to send log: ${res.statusCode}`);
    }
  });

  req.on('error', (err) => {
    console.error('[WebhookError]', err);
  });

  req.write(payload);
  req.end();
}

// 除外キーワード：先頭行にこれらを含むログは丸ごと送らない
const excludeKeywords = [
  'parentId:',
  'TICKET_CAT:',
  'mentions.has(',
  'content:',
];

// ログをフィルタして Discord に送る共通処理
function filterAndSend(rawText) {
  // 先頭行だけを取り出し
  const firstLine = rawText.split('\n', 1)[0].trim();
  // 先頭行に除外キーワードが含まれていれば何もしない
  if (excludeKeywords.some(kw => firstLine.includes(kw))) {
    return;
  }
  // 含まれていなければ、rawText 全体をそのまま送信
  const cleaned = rawText.trim();
  if (cleaned) sendToWebhook(cleaned);
}

// console.log フック
const originalLog = console.log;
console.log = (...args) => {
  originalLog(...args);
  filterAndSend(args.map(String).join(' '));
};

// console.error フック
const originalError = console.error;
console.error = (...args) => {
  originalError(...args);

  const raw = args
    .map(arg => {
      if (arg instanceof Error) return arg.stack || arg.message;
      if (typeof arg === 'object') {
        try { return JSON.stringify(arg, null, 2); }
        catch { return String(arg); }
      }
      return String(arg);
    })
    .join('\n');

  filterAndSend(raw);
};
