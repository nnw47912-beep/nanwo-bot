const http = require('http');
const TelegramBot = require('node-telegram-bot-api');

http.createServer((req, res) => {
  res.write("Bot is running!");
  res.end();
}).listen(process.env.PORT || 3000);

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, {
  polling: {
    interval: 2000,
    autoStart: true,
    params: { timeout: 10 }
  }
});

bot.on('polling_error', (err) => console.log(err.message));

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "أهلاً بك! البوت يعمل الآن بنجاح.");
});

bot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    bot.sendMessage(msg.chat.id, "تم استلام رسالتك: " + msg.text);
  }
});
