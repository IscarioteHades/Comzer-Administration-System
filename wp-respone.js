// wp-respone.js (改良版)
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { Client, GatewayIntentBits } = require('discord.js');

const BOT_TOKEN = process.env.DISCORD_TOKEN;
const CZR_SECRET = process.env.CASBOT_API_SECRET; // WP と共有するシークレット（必須）
const PORT = process.env.PORT || 4040;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required in env');
  process.exit(1);
}
if (!CZR_SECRET) {
  console.warn('CZR_SECRET is not set. Signature verification will be skipped (NOT RECOMMENDED).');
}

const client = new Client({
  intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.Guilds],
  partials: ['CHANNEL'],
});

let clientReady = false;
client.once('ready', () => {
  clientReady = true;
  console.log(`Discord client ready as ${client.user.tag}`);
});

client.on('error', (err) => {
  console.error('Discord client error:', err);
});

client.login(BOT_TOKEN).catch(err => {
  console.error('Failed to login Discord client:', err);
  process.exit(1);
});

const app = express();
app.use(bodyParser.json({ limit: '100kb' }));

function computeExpectedSig(reqBody, sigSrcHeader) {
  // If WP sets header X-CZR-SIGN-SRC: plain:request_id|user_id|discord_id|status|reason
  if (sigSrcHeader && sigSrcHeader.startsWith('plain:')) {
    // Build exactly same one-line string as WP's hardcoded implementation:
    const reason = (reqBody.reason || '').toString().replace(/\n/g, '\\n');
    const parts = [
      reqBody.request_id ?? '',
      reqBody.user_id ?? '',
      reqBody.discord_id ?? '',
      reqBody.status ?? '',
      reason
    ];
    const src = parts.join('|');
    return crypto.createHmac('sha256', CZR_SECRET).update(src).digest('hex');
  } else {
    // Default: use exact JSON stringification (this requires WP to use same stringify)
    const payload = JSON.stringify(reqBody);
    return crypto.createHmac('sha256', CZR_SECRET).update(payload).digest('hex');
  }
}

function verifySignature(req, res, next) {
  const sig = (req.get('X-CZR-SIGN') || '').trim();
  const sigSrcHeader = (req.get('X-CZR-SIGN-SRC') || '').trim();

  if (!CZR_SECRET) {
    // 署名がない設定なら警告だけ出して通す（本番では拒否推奨）
    console.warn('CZR_SECRET not configured — skipping signature verification');
    return next();
  }

  if (!sig) {
    return res.status(401).json({ ok: false, error: 'missing signature' });
  }

  try {
    const expected = computeExpectedSig(req.body, sigSrcHeader);
    if (sig !== expected) {
      console.warn('signature mismatch', { received: sig, expected: expected.slice(0,8)+'...' });
      return res.status(401).json({ ok: false, error: 'invalid signature' });
    }
    next();
  } catch (err) {
    console.error('verifySignature error', err);
    return res.status(400).json({ ok: false, error: 'signature verification failed' });
  }
}

app.post('/api/notify-dm', verifySignature, async (req, res) => {
  try {
    if (!clientReady) {
      return res.status(503).json({ ok: false, error: 'discord client not ready' });
    }

    const { discord_id, request_id, status, reason } = req.body;
    if (!discord_id) return res.status(400).json({ ok: false, error: 'discord_id required' });

    // fetch user
    let user;
    try {
      user = await client.users.fetch(discord_id);
    } catch (fetchErr) {
      console.warn('users.fetch failed', fetchErr);
      return res.status(404).json({ ok: false, error: 'discord user not found' });
    }

    const title = (status === 'approved') ? '承認されました' : '却下されました';
    const content = `あなたの申請 (ID: ${request_id}) は **${status}** 。\n理由: ${reason || 'なし'}`;

    try {
      await user.send(`${title}\n\n${content}`);
      return res.json({ ok: true });
    } catch (sendErr) {
      // DM が拒否されているなどの理由で送信できないケース
      console.warn('user.send failed', sendErr);
      // DiscordAPIError や RateLimit の可能性がある
      return res.status(422).json({ ok: false, error: 'cannot deliver dm', detail: sendErr.message });
    }
  } catch (err) {
    console.error('notify-dm error', err);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
});

app.listen(PORT, () => {
  console.log(`notify server listening ${PORT}`);
});
