// logger.js

//  標準モジュール読み込み
import https from 'https';
import { URL } from 'url';

const { WEBHOOK_URL } = process.env;

// Discord Webhook に送信する関数
function sendToWebhook(message) {
  if (!WEBHOOK_URL) return;

  const payload = JSON.stringify({
    content: `\`\`\`\n${message}\n\`\`\``,
  });

  const url = new URL(WEBHOOK_URL);
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

// 除外キーワード：これらを含む行は送らない
const excludeKeywords = [
  'parentId:',
  'TICKET_CAT:',
  'mentions.has(',
  'content:',
];

// ログをフィルタして Discord に送る共通処理
function filterAndSend(rawText) {
  const lines = rawText
    .split('\n')
    .filter(line => !excludeKeywords.some(kw => line.includes(kw)));

  const cleaned = lines.join('\n').trim();
  if (cleaned) sendToWebhook(cleaned);
}

// 5. console.log フック
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
