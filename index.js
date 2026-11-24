const http = require('http');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const url = 'https://nanwo-bot.onrender.com';
const port = process.env.PORT || 3000;

const bot = new TelegramBot(token);

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === `/bot${token}`) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        bot.processUpdate(JSON.parse(body));
      } catch (e) {
        console.error(e);
      }
      res.writeHead(200);
      res.end();
    });
  } else if (req.url === '/setup') {
    res.writeHead(302, {
      'Location': `https://telegram.org{token}/setWebhook?url=${url}/bot${token}`
    });
    res.end();
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running via Webhook!');
  }
}).listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "يعمل الآن بنجاح!");
});
