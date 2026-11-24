const http = require('http');
const TelegramBot = require('node-telegram-bot-api');

const token = (process.env.BOT_TOKEN || '').trim();
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
  } else if (req.url === '/on') {
    bot.setWebHook(`${url}/bot${token}`)
      .then(() => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1 style="font-size:40px;color:green;text-align:center;margin-top:50px;">تم تفعيل البوت بنجاح! افتح تيليجرام الآن</h1>');
      })
      .catch((err) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1 style="font-size:30px;color:red;text-align:center;margin-top:50px;">خطأ: ${err.message}</h1>`);
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
