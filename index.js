const http = require('http');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const url = 'https://onrender.com';
const port = process.env.PORT || 3000;

// إنشاء البوت بدون polling
const bot = new TelegramBot(token);

// ربط البوت برابط موقعك على Render
bot.setWebHook(`${url}/bot${token}`);

// استقبال الرسائل من تيليجرام ومعالجة فحص السيرفر
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
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running via Webhook!');
  }
}).listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// أوامر البوت
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "يعمل الآن بنجاح!");
});
