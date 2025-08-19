// index.js

const express = require('express');
const bodyParser = require('body-parser');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.use(bodyParser.json());

// Discord client 初期化
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: ['CHANNEL']
});
client.login(process.env.DISCORD_TOKEN);

// APIエンドポイント
app.get('/', (_, res) => res.send('OK')); // ← keep-alive用に / をOK返すだけで十分

app.post('/api/notify', (req, res) => {
  const data = req.body;
  console.log('通知受信:', data);

  const message = `
申請ID: ${data.request_id}
種類: ${data.request_name}
内容: ${data.request_content}
作成日時: ${data.created_at}
部署: ${data.department}
決定: ${data.decision_event} (${data.decision_datetime})
備考: ${data.notice}
`;
  queue.push({ discord_id: data.discord_id, message });
  processQueue();
  res.json({ status: 'queued' });
});

// listen はこれだけ
const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
