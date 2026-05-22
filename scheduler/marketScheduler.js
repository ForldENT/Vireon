const cron = require('node-cron');
const { applyDailyUpdate, loadConfig, loadMarket } = require('../utils/marketManager');
const { generateDailyNews } = require('../utils/newsGenerator');
const { newsEmbed, marketOverviewEmbed, marketControlRow } = require('../utils/stockEmbeds');
const { updateExchangeRates } = require('../utils/currencyManager');

let client = null;

function setClient(discordClient) {
  client = discordClient;
}

// ── 일일 시장 업데이트 ────────────────────────────────
async function runDailyMarketUpdate() {
  console.log('⏰ [스케줄러] 일일 시장 업데이트 시작...');
  try {
    const { news, impacts } = generateDailyNews();
    const results = applyDailyUpdate(impacts);

    if (!client) return { news, results };
    const config = loadConfig();

    if (config.newsChannelId) {
      const ch = await client.channels.fetch(config.newsChannelId).catch(() => null);
      if (ch && news.length > 0) await ch.send({ embeds: [newsEmbed(news)] });
    }

    if (config.stockChannelId) {
      const ch = await client.channels.fetch(config.stockChannelId).catch(() => null);
      if (ch) {
        const market = loadMarket();
        await ch.send({ content: '📊 **오늘의 시장 업데이트**', embeds: [marketOverviewEmbed(market)] });

        const { EmbedBuilder } = require('discord.js');
        const topGainers = results.filter(r => r.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 3);
        const topLosers = results.filter(r => r.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 3);

        if (topGainers.length > 0 || topLosers.length > 0) {
          await ch.send({
            embeds: [new EmbedBuilder()
              .setColor(0x2F3136)
              .setTitle('📈📉 오늘의 상승/하락 TOP 3')
              .addFields(
                { name: '🔺 상승 TOP 3', value: topGainers.map(r => `**${r.ticker}** → **${r.newPrice.toLocaleString()}** (+${r.changePercent.toFixed(2)}%)`).join('\n') || '없음', inline: true },
                { name: '🔻 하락 TOP 3', value: topLosers.map(r => `**${r.ticker}** → **${r.newPrice.toLocaleString()}** (${r.changePercent.toFixed(2)}%)`).join('\n') || '없음', inline: true }
              ).setTimestamp()
            ]
          });
        }
      }
    }

    console.log('✅ [스케줄러] 일일 업데이트 완료');
    return { news, results };
  } catch (err) {
    console.error('❌ [스케줄러] 오류:', err);
    return { news: [], results: [] };
  }
}

// ── 환율 업데이트 ─────────────────────────────────────
async function runCurrencyUpdate() {
  console.log('💱 [스케줄러] 환율 업데이트 시작...');
  try {
    const changes = updateExchangeRates();
    if (!client) return;

    const config = loadConfig();
    if (!config.newsChannelId) return;

    const ch = await client.channels.fetch(config.newsChannelId).catch(() => null);
    if (!ch) return;

    const { EmbedBuilder } = require('discord.js');
    const lines = changes.map(c => {
      const arrow = c.changePct > 0 ? '▲' : c.changePct < 0 ? '▼' : '━';
      const color = c.changePct > 0 ? '🟢' : c.changePct < 0 ? '🔴' : '⚪';
      return `${color} ${c.emoji} **${c.name}** (${c.code})\n> 1 USD = **${c.newRate.toLocaleString()} ${c.code}** ${arrow} ${c.changePct > 0 ? '+' : ''}${c.changePct}%`;
    }).join('\n\n');

    await ch.send({
      embeds: [new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('💱 오늘의 환율 업데이트')
        .setDescription(lines)
        .setFooter({ text: '기준: USD (미국 달러)' })
        .setTimestamp()
      ]
    });

    console.log('✅ [스케줄러] 환율 업데이트 완료');
  } catch (err) {
    console.error('❌ [스케줄러] 환율 오류:', err);
  }
}

// ── 장 마감 알림 ──────────────────────────────────────
async function sendClosingBell() {
  if (!client) return;
  const config = loadConfig();
  if (!config.stockChannelId) return;
  const ch = await client.channels.fetch(config.stockChannelId).catch(() => null);
  if (!ch) return;
  const { EmbedBuilder } = require('discord.js');
  await ch.send({
    embeds: [new EmbedBuilder()
      .setColor(0xFF6B35)
      .setTitle('🔔 장 마감 알림')
      .setDescription('오늘 가상 시장의 거래가 마감되었습니다.\n내일 오전 9시에 새로운 뉴스와 함께 시장이 열립니다!\n\n> 🕐 거래 시간: 오전 9시 ~ 오후 4시')
      .setTimestamp()
    ]
  });
}


// ── 매일 아침 랜덤 주식 이벤트 ───────────────────────
async function runDailyStockEvent() {
  if (!client) return;
  console.log('🎁 [이벤트] 랜덤 주식 지급 시작');

  try {
    const { loadUsers, saveUsers, loadMarket, loadConfig } = require('../utils/marketManager');
    const { EmbedBuilder } = require('discord.js');

    const users = loadUsers();
    const market = loadMarket();
    const config = loadConfig();

    // 유저 목록 (최소 1명 이상)
    const userIds = Object.keys(users).filter(id => !id.startsWith('_'));
    if (userIds.length === 0) return;

    // 랜덤 유저 1명 선택
    const luckyUserId = userIds[Math.floor(Math.random() * userIds.length)];

    // 랜덤 주식 1개 선택 (주식만, 코인 제외)
    const stocks = Object.values(market.companies);
    if (stocks.length === 0) return;
    const luckyStock = stocks[Math.floor(Math.random() * stocks.length)];

    // 주식 1주 지급
    if (!users[luckyUserId].portfolio[luckyStock.id]) {
      users[luckyUserId].portfolio[luckyStock.id] = {
        qty: 0, avgPrice: luckyStock.price, totalInvested: 0, currency: 'KRW'
      };
    }
    users[luckyUserId].portfolio[luckyStock.id].qty += 1;
    users[luckyUserId].transactions = users[luckyUserId].transactions || [];
    users[luckyUserId].transactions.unshift({
      type: 'EVENT',
      ticker: luckyStock.id,
      quantity: 1,
      price: luckyStock.price,
      total: luckyStock.price,
      date: new Date().toISOString(),
    });
    saveUsers(users);

    // 채널에 발표
    if (config.stockChannelId) {
      const ch = await client.channels.fetch(config.stockChannelId).catch(() => null);
      if (ch) {
        // 유저 멘션용 Discord 유저 조회
        const luckyUser = await client.users.fetch(luckyUserId).catch(() => null);
        const userName = luckyUser ? `<@${luckyUserId}>` : `유저 ${luckyUserId.slice(-4)}`;

        await ch.send({
          embeds: [new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('🎁 오늘의 행운 주식 이벤트!')
            .setDescription(`오늘의 행운아는 **${userName}** 님입니다! 🎉`)
            .addFields(
              { name: '🎰 당첨 주식', value: `${luckyStock.emoji} **${luckyStock.name}** (${luckyStock.id})`, inline: true },
              { name: '💰 현재가', value: `**${luckyStock.price.toLocaleString()}원**`, inline: true },
              { name: '📦 지급 수량', value: '**1주**', inline: true },
            )
            .setFooter({ text: '매일 아침 9시, 랜덤 유저에게 주식 1주가 지급됩니다!' })
            .setTimestamp()
          ]
        });
        console.log(`🎁 [이벤트] ${luckyUserId}에게 ${luckyStock.id} 1주 지급 완료`);
      }
    }
  } catch (e) {
    console.error('🎁 [이벤트] 오류:', e.message);
  }
}

// ── 스케줄 등록 ───────────────────────────────────────
function startScheduler() {
  // 매일 09:00 KST = UTC 00:00 — 시장 업데이트 + 환율 업데이트 + 이벤트
  cron.schedule('0 0 * * *', () => {
    console.log('⏰ [CRON] 일일 09:00 실행');
    runDailyMarketUpdate();
    runCurrencyUpdate();
    runDailyStockEvent();
  });

  // 매일 16:00 KST = UTC 07:00 — 장 마감
  cron.schedule('0 7 * * *', () => {
    console.log('⏰ [CRON] 장 마감');
    sendClosingBell();
  });

  console.log('⏰ [스케줄러] 등록 완료');
  console.log('  - 매일 09:00: 시장 업데이트 + 환율 업데이트 + 랜덤 주식 이벤트');
  console.log('  - 매일 16:00: 장 마감 알림');
}

module.exports = { startScheduler, runDailyMarketUpdate, runCurrencyUpdate, runDailyStockEvent, setClient };
