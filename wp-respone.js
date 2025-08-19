const express = require('express');
const bodyParser = require('body-parser');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const PORT = process.env.PORT || 3000; // fallbackはローカル用だけ
app.use(bodyParser.json());

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
    partials: ['CHANNEL']
});
client.login(process.env.DISCORD_TOKEN);

// 通知キュー
const queue = [];
let processing = false;

async function processQueue() {
    if (processing || queue.length === 0) return;
    processing = true;

    while (queue.length > 0) {
        const item = queue.shift();
        try {
            const user = await client.users.fetch(item.discord_id);
            if (user) await user.send(item.message);
        } catch (err) {
            console.error('DM送信エラー:', err);
        }
        await new Promise(res => setTimeout(res, 1500)); // 1.5秒間隔
    }

    processing = false;
}

// APIエンドポイント
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

// listen はここで一回だけ！
app.listen(PORT, () => console.log(`Notify server listening on port ${PORT}`));
