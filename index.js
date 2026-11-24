const http = require('http');
const TelegramBot = require('node-telegram-bot-api');

const token = (process.env.BOT_TOKEN || '').trim();
const port = process.env.PORT || 3000;

const rpcEndpoints = [
  process.env.SOLANA_RPC_URL,
  'https://' + ['api', 'mainnet-beta', 'solana', 'com'].join('.'),
  'https://' + ['solana', 'drpc', 'org'].join('.'),
  'https://' + ['api', 'mainnet', 'solana', 'com'].join('.')
].filter(Boolean);

const bot = new TelegramBot(token);

async function callSolanaRPC(method, params) {
  let lastError = 'فشل الاتصال بجميع الخوادم';
  for (const url of rpcEndpoints) {
    try {
      const response = await fetch(url.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const data = await response.json();
      if (data.error) {
        lastError = data.error.message;
        continue;
      }
      return data.result;
    } catch (err) {
      lastError = err.message;
    }
  }
  throw new Error(lastError);
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

  let holdersSection = 'غير متاح';
  let holdersWarning = '';

  try {
    const largest = await callSolanaRPC('getTokenLargestAccounts', [mintAddress]);
    if (largest && Array.isArray(largest.value) && rawSupply > 0) {
      const top10 = largest.value.slice(0, 10);
      const top10Sum = top10.reduce((sum, acc) => sum + Number(acc.amount || 0), 0);
      const top10Percent = ((top10Sum / rawSupply) * 100).toFixed(2);

      const listLines = top10.map((acc, i) => {
        const pct = ((Number(acc.amount || 0) / rawSupply) * 100).toFixed(2);
        const shortAddr = `${acc.address.slice(0, 4)}...${acc.address.slice(-4)}`;
        return `${i + 1}. \`${shortAddr}\` — *${pct}%*`;
      }).join('\n');

      holdersSection = `*${top10Percent}%* من إجمالي العملة:\n${listLines}`;

      if (Number(top10Percent) > 50) {
        holdersWarning = '\n⚠️ *تنبيه تركز:* أكبر 10 محافظ تسيطر على أكثر من 50% من المعروض!';
      }
    }
  } catch (e) {
    holdersSection = 'تعذر جلب قائمة المحافظ حالياً';
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
    `💰 *إجمالي المعروض:* ${totalSupply.toLocaleString('en-US', { maximumFractionDigits: 2 })}\n\n` +
    `🏭 *صلاحية الصك (Mint):*\n${mintStatus}\n\n` +
    `❄️ *صلاحية التجميد (Freeze):*\n${freezeStatus}\n\n` +
    `🐋 *أكبر 10 محافظ تستحوذ على* ${holdersSection}${holdersWarning}\n\n` +
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
      '👋 أهلاً بك في بوت فحص عملات سولانا!\n\nأرسل لي *عنوان أي عملة (Mint Address)* وسأفحص لك صلاحيات الصك والتجميد وأكبر 10 محافظ فوراً.',
      { parse_mode: 'Markdown' }
    );
  }

  const match = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  if (match) {
    const mintAddress = match.at(0);
    const waitMsg = await bot.sendMessage(chatId, '⏳ جاري فحص العملة وجلب أكبر 10 محافظ...');
    try {
      const report = await checkSolanaToken(mintAddress);
      const solscanUrl = ['https:', '', ['solscan', 'io'].join('.'), 'token', mintAddress].join('/');
      const dexUrl = ['https:', '', ['dexscreener', 'com'].join('.'), 'solana', mintAddress].join('/');
      await bot.editMessageText(report, {
        chat_id: chatId,
        message_id: waitMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔎 Solscan', url: solscanUrl },
            { text: '📊 DexScreener', url: dexUrl }
          ]]
        }
      });
    } catch (err) {
      await bot.editMessageText(`❌ تعذر الفحص حالياً (${err.message})، حاول مرة أخرى بعد قليل.`, {
        chat_id: chatId,
        message_id: waitMsg.message_id
      });
    }
  } else {
    bot.sendMessage(chatId, 'يرجى إرسال عنوان عقد عملة سولانا (Mint Address) لفحصه.');
  }
});
