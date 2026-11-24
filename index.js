const http = require('http');
const TelegramBot = require('node-telegram-bot-api');

const token = (process.env.BOT_TOKEN || '').trim();
const port = process.env.PORT || 3000;

const rpcEndpoints = [
  process.env.SOLANA_RPC_URL,
  'https://' + ['api', 'mainnet-beta', 'solana', 'com'].join('.'),
  'https://' + ['solana', 'drpc', 'org'].join('.')
].filter(Boolean);

const bot = new TelegramBot(token);

async function callSolanaRPC(method, params) {
  let lastError = 'فشل الاتصال بالشبكة';
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

async function getMarketData(mintAddress) {
  try {
    const dexApi = ['https:', '', ['api', 'dexscreener', 'com'].join('.'), 'latest', 'dex', 'tokens', mintAddress].join('/');
    const res = await fetch(dexApi);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.pairs || data.pairs.length === 0) return null;
    const pair = data.pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)).at(0);
    return {
      name: pair.baseToken?.name || 'غير معروف',
      symbol: pair.baseToken?.symbol || '',
      priceUsd: pair.priceUsd ? `$${Number(pair.priceUsd).toFixed(8).replace(/\.?0+$/, '')}` : 'غير متاح',
      liquidity: pair.liquidity?.usd ? `$${Number(pair.liquidity.usd).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : 'غير متاح',
      marketCap: pair.marketCap ? `$${Number(pair.marketCap).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : 'غير متاح',
      priceChange1h: pair.priceChange?.h1 ?? 0,
      buys1h: pair.txns?.h1?.buys ?? 0,
      sells1h: pair.txns?.h1?.sells ?? 0
    };
  } catch (e) {
    return null;
  }
}

async function scanMomentumTokens() {
  const boostsUrl = ['https:', '', ['api', 'dexscreener', 'com'].join('.'), 'token-boosts', 'top', 'v1'].join('/');
  const res = await fetch(boostsUrl);
  if (!res.ok) throw new Error('تعذر الوصول لبيانات السوق حالياً');
  const boosts = await res.json();

  const solanaMints = [...new Set(
    (Array.isArray(boosts) ? boosts : [])
      .filter(item => item.chainId === 'solana' && item.tokenAddress)
      .map(item => item.tokenAddress)
  )].slice(0, 12);

  if (solanaMints.length === 0) {
    return '⚠️ لم يتم العثور على عملات نشطة في هذه اللحظة، حاول مرة أخرى بعد دقائق.';
  }

  const tokensUrl = ['https:', '', ['api', 'dexscreener', 'com'].join('.'), 'latest', 'dex', 'tokens', solanaMints.join(',')].join('/');
  const pairsRes = await fetch(tokensUrl);
  const pairsData = await pairsRes.json();
  const pairs = Array.isArray(pairsData.pairs) ? pairsData.pairs : [];

  const bestByMint = new Map();
  for (const p of pairs) {
    if (p.chainId !== 'solana') continue;
    const mint = p.baseToken?.address;
    if (!mint) continue;
    const existing = bestByMint.get(mint);
    if (!existing || (p.liquidity?.usd || 0) > (existing.liquidity?.usd || 0)) {
      bestByMint.set(mint, p);
    }
  }

  const candidates = [...bestByMint.values()]
    .filter(p => {
      const liq = p.liquidity?.usd || 0;
      const vol24 = p.volume?.h24 || 0;
      const buys1h = p.txns?.h1?.buys || 0;
      const sells1h = p.txns?.h1?.sells || 0;
      return liq >= 5000 && vol24 >= liq && buys1h > sells1h;
    })
    .sort((a, b) => (b.priceChange?.h1 || 0) - (a.priceChange?.h1 || 0))
    .slice(0, 4);

  if (candidates.length === 0) {
    return '📭 لا توجد عملات تطابق شروط الزخم والسيولة (سيولة +$5,000 وضغط شرائي) في هذه اللحظة. جرب البحث بعد قليل.';
  }

  const results = [];
  for (let i = 0; i < candidates.length; i++) {
    const p = candidates.at(i);
    const mint = p.baseToken.address;
    let authBadge = '⚪ غير مفحوص';
    try {
      const infoRes = await callSolanaRPC('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
      const info = infoRes?.value?.data?.parsed?.info;
      if (info) {
        authBadge = (!info.mintAuthority && !info.freezeAuthority) ? '🛡️ الصك والتجميد ملغاة' : '⚠️ توجد صلاحيات تحكم';
      }
    } catch (e) {}

    const liq = `$${Number(p.liquidity.usd).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    const mc = p.marketCap ? `$${Number(p.marketCap).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : 'غير متاح';
    const ch1h = p.priceChange?.h1 ?? 0;
    const buys = p.txns?.h1?.buys ?? 0;
    const sells = p.txns?.h1?.sells ?? 0;

    results.push(
      `*${i + 1}. ${p.baseToken.name} (${p.baseToken.symbol})*\n` +
      `📌 \`${mint}\`\n` +
      `💧 السيولة: ${liq} | 📈 MC: ${mc}\n` +
      `⚡ تغير الساعة: *${ch1h > 0 ? '+' : ''}${ch1h}%* (شراء ${buys} / بيع ${sells})\n` +
      `🔐 الأمان: ${authBadge}`
    );
  }

  return (
    `🚀 *عملات سولانا ذات زخم شرائي وسيولة نشطة*\n` +
    `_(اضغط على أي عنوان لنسخه وإرساله للفحص التفصيلي)_\n\n` +
    results.join('\n\n')
  );
}

async function checkSolanaToken(mintAddress) {
  const [accountInfo, market] = await Promise.all([
    callSolanaRPC('getAccountInfo', [mintAddress, { encoding: 'jsonParsed' }]),
    getMarketData(mintAddress)
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
        return `${i + 1}. \`${acc.address}\` — *${pct}%*`;
      }).join('\n');

      holdersSection = `*${top10Percent}%* من إجمالي العملة (اضغط على أي عنوان لنسخه):\n${listLines}`;

      if (Number(top10Percent) > 50) {
        holdersWarning = '\n⚠️ *تنبيه تركز:* أكبر 10 محافظ تسيطر على أكثر من 50% من المعروض!';
      }
    }
  } catch (e) {
    holdersSection = 'تعذر جلب قائمة المحافظ حالياً';
  }

  const marketHeader = market
    ? `🪙 *العملة:* ${market.name} (${market.symbol})\n💵 *السعر:* ${market.priceUsd} | 💧 *السيولة:* ${market.liquidity}\n📈 *القيمة السوقية (MC):* ${market.marketCap}\n\n`
    : '';

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
    `${marketHeader}` +
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
      '👋 أهلاً بك في بوت فحص واكتشاف عملات سولانا!\n\n' +
      '🔹 أرسل *عنوان أي عملة (Mint Address)* لفحص أمانها وأكبر 10 محافظ.\n' +
      '🔹 أو أرسل كلمة *بحث* أو `/scan` لاكتشاف العملات ذات الزخم الشرائي والسيولة النشطة الآن.',
      { parse_mode: 'Markdown' }
    );
  }

  if (text === '/scan' || text === 'بحث' || text === 'اكتشاف') {
    const waitMsg = await bot.sendMessage(chatId, '🔎 جاري مسح السوق وفلترة العملات ذات السيولة والضغط الشرائي...');
    try {
      const scanReport = await scanMomentumTokens();
      await bot.editMessageText(scanReport, {
        chat_id: chatId,
        message_id: waitMsg.message_id,
        parse_mode: 'Markdown'
      });
    } catch (err) {
      await bot.editMessageText(`❌ تعذر مسح السوق حالياً (${err.message})، حاول مرة أخرى.`, {
        chat_id: chatId,
        message_id: waitMsg.message_id
      });
    }
    return;
  }

  const match = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  if (match) {
    const mintAddress = match.at(0);
    const waitMsg = await bot.sendMessage(chatId, '⏳ جاري فحص العملة وبيانات السوق...');
