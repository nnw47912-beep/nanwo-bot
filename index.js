const http = require('http');
const TelegramBot = require('node-telegram-bot-api');

const token = (process.env.BOT_TOKEN || '').trim();
const port = process.env.PORT || 3000;

const bot = new TelegramBot(token);

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === `/bot${token}`) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const update = JSON.parse(body);
        console.log('Message received:', update.message?.text);
        bot.processUpdate(update);
      } catch (e) {
        console.error(e);
      }
      res.writeHead(200);
      res.end();
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running!');
  }
}).listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

bot.on('message', (msg) => {
  bot.sendMessage(msg.chat.id, "أهلاً بك! البوت يعمل الآن بنجاح: " + (msg.text || ''));
});
