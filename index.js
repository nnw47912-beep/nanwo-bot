const http = require('http');
const TelegramBot = require('node-telegram-bot-api');

const token = (process.env.BOT_TOKEN || '').trim();
const port = process.env.PORT || 3000;
const rpcUrl = (process.env.SOLANA_RPC_URL || 'https://publicnode.com').trim();

const bot = new TelegramBot(token);

async function callSolanaRPC(method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

async function checkSolanaToken(mintAddress) {
  const accountInfo = await callSolanaRPC('getAccountInfo', [
    mintAddress,
    { encoding: 'jsonParsed' }
  ]);

  if (!accountInfo || !accountInfo.value) {
    return '❌ لم يتم العثور على هذا العنوان على شبكة Solana Mainnet. تأكد من صحة عنوان العملة.';
  }

  const parsed = accountInfo.value.data?.parsed;
  if (!parsed || parsed.type !== 'mint') {
    return '⚠️ هذا العنوان ليس عقد عملة (Token Mint Address). يرجى إرسال عنوان عملة صحيح.';
  }

  const info = parsed.info;
  const decimals = info.decimals || 0;
  const rawSupply = Number(info.supply || 0);
  const totalSupply = rawSupply / Math.pow(10, decimals);

  const mintAuth = info.mintAuthority;
  const freezeAuth = info.freezeAuthority;

  let top10Text = 'غير متاح';
  let holdersWarning = '';

  try {
    const largest = await callSolanaRPC('getTokenLargestAccounts', [mintAddress]);
    if (largest && Array.isArray(largest.value) && rawSupply > 0) {
      const top10 = largest.value.slice(0, 10);
      const top10Sum = top10.reduce((sum, acc) => sum + Number(acc.amount || 0), 0);
      const top10Percent = ((top10Sum / rawSupply) * 100).toFixed(2);
      top10Text = `${top10Percent}%`;
      if (Number(top10Percent) > 50) {
        holdersWarning = '\n⚠️ *تنبيه تركز:* أكبر 10 محافظ تسيطر على أكثر من 50% من المعروض!';
      }
    }
  } catch (e) {
    top10Text = 'تعذر جلب المحافظ';
  }

  const mintStatus = mintAuth
    ? `⚠️ مفعّلة (يمكن طباعة عملات)\n\`${mintAuth}\``
    : '✅ ملغاة (Revoked)';

  const freezeStatus = freezeAuth
    ? `⚠️ مفعّلة (يمكن تجميد المحافظ)\n\`${freezeAuth}\``
    : '✅ ملغاة (Revoked)';

  const securityAlert = (mintAuth || freezeAuth)
    ? '🚨 *تحذير:* جهة مركزية لا تزال تملك صلاحيات التحكم في العملة.'
    : '🛡️ *آمن مبدئياً:* صلاحيات الصك والتجميد ملغاة بالكامل.';

  return (
    `🔍 *تقرير فحص عملة سولانا*\n\n` +
    `📌 *العنوان:*\n\`${mintAddress}\`\n\n` +
    `💰 *إجمالي المعروض (Supply):*\n${totalSupply.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n\n` +
    `🏭 *صلاحية الصك (Mint Authority):*\n${mintStatus}\n\n` +
    `❄️ *صلاحية التجميد (Freeze Authority):*\n${freezeStatus}\n\n` +
    `🐋 *استحواذ أكبر 10 محافظ:* ${top10Text}${holdersWarning}\n\n` +
    `${securityAlert}`
  );
}

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
    res.end('Solana Checker Bot is running!');
  }
}).listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (text === '/start') {
    return bot.sendMessage(
      chatId,
      '👋 أهلاً بك في بوت فحص عملات سولانا!\n\nأرسل لي *عنوان أي عملة (Token Mint Address)* وسأفحص لك صلاحيات الصك والتجميد وأكبر 10 محافظ فوراً.',
      { parse_mode: 'Markdown' }
    );
  }

  const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (solanaAddressRegex.test(text)) {
    const waitMsg = await bot.sendMessage(chatId, '⏳ جاري فحص العملة على شبكة سولانا...');
    try {
      const report = await checkSolanaToken(text);
      await bot.editMessageText(report, {
        chat_id: chatId,
        message_id: waitMsg.message_id,
        parse_mode: 'Markdown'
      });
    } catch (err) {
      await bot.editMessageText(`❌ حدث خطأ أثناء الاتصال بالشبكة: ${err.message}`, {
        chat_id: chatId,
        message_id: waitMsg.message_id
      });
    }
  } else {
    bot.sendMessage(chatId, 'يرجى إرسال عنوان عقد عملة سولانا صحيح (Mint Address) لفحصه.');
  }
});
