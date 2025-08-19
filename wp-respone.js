// server.js
const express = require('express');
const bodyParser = require('body-parser');

// 既存 Bot クライアントを import
const { client } = require('./bot'); // bot.js で client を export している想定

const app = express();
const PORT = process.env.PORT || 5000;

app.use(bodyParser.json());

app.post('/api/notify', async (req, res) => {
    const data = req.body;
    console.log('通知受信:', data);

    const discordId = data.discord_id;
    const message = `
申請ID: ${data.request_id}
種類: ${data.request_name}
内容: ${data.request_content}
作成日時: ${data.created_at}
部署: ${data.department}
決定: ${data.decision_event} (${data.decision_datetime})
備考: ${data.notice}
`;

    try {
        const user = await client.users.fetch(discordId);
        if (!user) return res.status(404).json({ error: 'Discord user not found' });

        await user.send(message);
        res.json({ status: 'success' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to send DM' });
    }
});

app.listen(PORT, () => {
    console.log(`Notification server running on port ${PORT}`);
});
