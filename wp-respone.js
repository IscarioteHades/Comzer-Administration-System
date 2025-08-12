// bot.js
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const retry = require('async-retry'); // optional: install async-retry for backoff
const debug = require('debug')('casbot:bot');

/**
 * ボットモジュールを初期化してエクスポートする
 *
 * exports:
 *  - readyPromise: Promise that resolves when discord client is ready
 *  - notifyUser(discordId, request, status, memo, opts)
 *  - getClient() // optional: raw client
 */

let client = null;
let readyPromise = null;
let isReady = false;

/**
 * 初期化（呼び出し時に1回）
 * @param {object} opts
 *  - token: Discord bot token
 *  - logger: optional logger (console-like)
 */
function init(opts = {}) {
  if (client) return { client, readyPromise };

  const token = opts.token || process.env.DISCORD_BOT_TOKEN;
  const logger = opts.logger || console;

  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN is required');
  }

  client = new Client({
    intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.Guilds],
    partials: [Partials.Channel], // DMチャンネルへアクセスするために必要
  });

  readyPromise = new Promise((resolve, reject) => {
    client.once('ready', () => {
      isReady = true;
      logger.log(`Discord client ready: ${client.user.tag}`);
      resolve(client);
    });
    client.once('error', (err) => {
      logger.error('Discord client error:', err);
      // do not reject here -- allow reconnects; but surface for debug
    });
    client.once('shardError', (err) => {
      logger.error('Shard error:', err);
    });

    // login
    client.login(token).catch(err => {
      logger.error('Failed to login Discord client:', err);
      reject(err);
    });

    // graceful shutdown
    process.on('SIGINT', async () => {
      logger.log('SIGINT received, destroying Discord client...');
      try { await client.destroy(); } catch(e) {}
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      logger.log('SIGTERM received, destroying Discord client...');
      try { await client.destroy(); } catch(e) {}
      process.exit(0);
    });
  });

  return { client, readyPromise };
}

/**
 * DMを送信する低レベル実装（再試行ロジックあり）
 * @param {string} discordId
 * @param {string} message
 */
async function sendDM(discordId, message, opts = {}) {
  const maxAttempts = opts.maxAttempts || 4;
  const logger = opts.logger || console;

  if (!client) throw new Error('Client not initialized. call init() first.');

  // use async-retry for exponential backoff (install: npm i async-retry)
  return retry(async (bail, attempt) => {
    logger.debug && logger.debug(`sendDM attempt=${attempt} to ${discordId}`);
    // fetch user
    const user = await client.users.fetch(discordId, { force: true });
    if (!user) {
      // 取得できないケースは再試行しても意味がない -> bail
      bail(new Error('Discord user not found'));
      return;
    }
    // send DM
    await user.send(message);
    return true;
  }, {
    retries: maxAttempts - 1,
    minTimeout: 1000, // 1s
    factor: 2,
    onRetry: (err, attempt) => {
      logger.warn && logger.warn(`sendDM retry #${attempt} for ${discordId}: ${err.message}`);
    }
  });
}

/**
 * 公開 API: 申請結果を申請者に通知する
 * 保証: client の ready を待ってから送信する
 *
 * @param {string} discordId
 * @param {object} request {id, type, type_label, user_display, ...}
 * @param {string} status 'approved'|'rejected'
 * @param {string} memo optional
 * @param {object} opts optional
 */
async function notifyUser(discordId, request = {}, status = 'approved', memo = '', opts = {}) {
  const logger = opts.logger || console;
  if (!discordId || String(discordId).trim() === '') {
    logger.warn('notifyUser: missing discordId, nothing to send.', { requestId: request.id });
    return { success: false, reason: 'missing_discord_id' };
  }

  // Ensure client ready
  if (!isReady) {
    try {
      await readyPromise;
    } catch (err) {
      logger.error('Discord client failed to be ready:', err);
      return { success: false, reason: 'client_not_ready', err: String(err) };
    }
  }

  const statusLabel = status === 'approved' ? '承認されました' : '却下されました';
  const typeLabel = request.type_label || request.type || '申請';
  let content = `CAS自動送信システムです。\nあなたの申請(ID: ${request.id})「${typeLabel}」が${statusLabel}。\n`;
  if (memo) {
    content += `\n【備考】\n${memo}\n`;
  }
  content += '\n---\nComzer Administration Bot';

  try {
    await sendDM(discordId, content, { logger, maxAttempts: opts.maxAttempts || 4 });
    logger.log(`notifyUser: sent to ${discordId} request=${request.id} status=${status}`);
    return { success: true };
  } catch (err) {
    logger.error('notifyUser: failed to send DM', err);
    // 送信失敗の理由を返す（WP側で保存できるように）
    return { success: false, reason: 'send_failed', err: String(err) };
  }
}

function getClient() {
  return client;
}

module.exports = {
  init,
  notifyUser,
  getClient,
  get readyPromise() { return readyPromise; }
};
