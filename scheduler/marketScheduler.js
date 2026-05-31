const cron = require('node-cron');
const { applyDailyUpdate, loadConfig, loadMarket } = require('../utils/marketManager');
const { generateDailyNews } = require('../utils/newsGenerator');
const { newsEmbed, marketOverviewEmbed, marketControlRow } = require('../utils/stockEmbeds');
const { updateExchangeRates } = require('../utils/currencyManager');
const {
  autoListStock, autoListCoin,
  triggerBankruptcyWarning, triggerCoinDelist,
  processPendingDelists, payDividends,
  loadPendingDelistAsync,
} = require('../utils/autoMarket');

let client = null;
let boardMessages = {};
let newsBoardMessages = {};

function setClient(discordClient) {
  client = discordClient;
}

// ── 뉴스 현황판 채널 자동 업데이트 ──────────────────
let newsBoardMessageId = null;
let newsBoardPage = 0;

async function updateNewsBoard() {
  if (!client) return;
  try {
    const { loadNews, loadConfig } = require('../utils/marketManager');
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const config = loadConfig();

    // 모든 서버에서 vireon-news 채널 찾기
    const newsChannels = [];
    for (const [, guild] of client.guilds.cache) {
      const ch = guild.channels.cache.find(c =>
        c.name === 'vireon-news' || c.name === 'Vireon News' ||
        c.name === 'vireon news' || c.name === 'VireonNews'
      );
      if (ch) newsChannels.push(ch);
    }
    if (newsChannels.length === 0) return;

    const allNews = loadNews();
    console.log(`[뉴스보드] 뉴스 수: ${allNews.length}`);
    if (allNews.length === 0) { console.log('[뉴스보드] 뉴스 없어서 종료'); return; }

    const PAGE_SIZE = 8;
    const totalPages = Math.ceil(allNews.length / PAGE_SIZE);
    const page = Math.min(newsBoardPage, totalPages - 1);
    const pageNews = allNews.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    const lines = pageNews.map(n => {
      const time = `<t:${Math.floor(new Date(n.publishedAt).getTime() / 1000)}:R>`;
      const badge = n.isFake ? '⚠️' : n.isPositive ? '📈' : '📉';
      // 제목 40자로 자르기
      const title = n.title.length > 40 ? n.title.slice(0, 40) + '...' : n.title;
      return `${badge} **[${n.ticker}]** ${title} ${time}`;
    }).join('\n');

    // 4096자 제한
    const safeLines = lines.length > 3900 ? lines.slice(0, 3900) + '\n...' : lines;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📰 Vireon 뉴스')
      .setDescription(safeLines || '뉴스가 없어요.')
      .setFooter({ text: `${page + 1} / ${totalPages} 페이지 • 총 ${allNews.length}건` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('news_prev')
        .setLabel('◀ 이전')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('news_next')
        .setLabel('다음 ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId('news_refresh')
        .setLabel('🔄 새로고침')
        .setStyle(ButtonStyle.Primary),
    );

    // 모든 채널에 전송
    for (const newsChannel of newsChannels) {
      try {
        const chId = newsChannel.id;
        if (!newsBoardMessages) newsBoardMessages = {};
        
        if (newsBoardMessages[chId]) {
          try {
            const msg = await newsChannel.messages.fetch(newsBoardMessages[chId]);
            await msg.edit({ embeds: [embed], components: [row] });
            continue;
          } catch (e) {
            delete newsBoardMessages[chId];
          }
        }

        const messages = await newsChannel.messages.fetch({ limit: 10 });
        const existing = messages.find(m => m.author.id === client.user.id);
        if (existing) {
          newsBoardMessages[chId] = existing.id;
          await existing.edit({ embeds: [embed], components: [row] });
        } else {
          const sent = await newsChannel.send({ embeds: [embed], components: [row] });
          newsBoardMessages[chId] = sent.id;
        }
      } catch (e) {
        console.error('[뉴스보드] 전송 실패:', e.message);
      }
    }
  } catch (e) {
    console.error('[뉴스보드] 전체 오류:', e.message);
  }
}

// ── 주식 현황판 채널 자동 업데이트 ───────────────────
async function updateStockBoard() {
  if (!client) return;
  try {
    const { loadMarket, loadConfig } = require('../utils/marketManager');
    const { marketOverviewEmbed } = require('../utils/stockEmbeds');
    const { marketControlRow } = require('../utils/stockEmbeds');
    const config = loadConfig();

    // 모든 서버에서 주식현황판 채널 찾기
    const boardChannels = [];
    for (const [, guild] of client.guilds.cache) {
      const ch = guild.channels.cache.find(c =>
        c.name === '주식-현황판' || c.name === '주식 현황판' || c.name === '주식현황판'
      );
      if (ch) boardChannels.push(ch);
    }

    if (boardChannels.length === 0) return;

    const market = loadMarket();
    const embed = marketOverviewEmbed(market);
    const row = marketControlRow();

    if (!boardMessages) boardMessages = {};

    for (const boardChannel of boardChannels) {
      try {
        const chId = boardChannel.id;
        if (boardMessages[chId]) {
          try {
            const msg = await boardChannel.messages.fetch(boardMessages[chId]);
            await msg.edit({ embeds: [embed], components: [row] });
            continue;
          } catch (e) {
            delete boardMessages[chId];
          }
        }
        const messages = await boardChannel.messages.fetch({ limit: 10 });
        const existing = messages.find(m => m.author.id === client.user.id);
        if (existing) {
          boardMessages[chId] = existing.id;
          await existing.edit({ embeds: [embed], components: [row] });
        } else {
          const sent = await boardChannel.send({ embeds: [embed], components: [row] });
          boardMessages[chId] = sent.id;
        }
      } catch (e) {
        console.error('현황판 전송 실패:', e.message);
      }
    }
  } catch (e) {
    console.error('현황판 업데이트 오류:', e.message);
  }
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
// ── 1원 코인 자동 상장폐지 ───────────────────────────
async function removeDeadCoins() {
  if (!client) return;
  try {
    const { loadMarket, saveMarket } = require('../utils/marketManager');
    const { EmbedBuilder } = require('discord.js');
    const config = loadConfig();
    const market = loadMarket();
    const deadCoins = Object.entries(market.coins).filter(([, a]) => a.price <= 1);

    if (deadCoins.length === 0) return;

    const ch = config.newsChannelId
      ? await client.channels.fetch(config.newsChannelId).catch(() => null)
      : null;

    for (const [ticker, coin] of deadCoins) {
      delete market.coins[ticker];
      console.log(`📛 [자동폐지] ${ticker} 가격 1원으로 상장폐지`);
      if (ch) {
        await ch.send({
          embeds: [new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('📛 코인 상장폐지')
            .setDescription(`**${coin.emoji} ${coin.name}** (${ticker}) 가격 하락으로 상장폐지되었습니다.`)
            .addFields({ name: '💰 최종가', value: '1원' })
            .setTimestamp()
          ]
        });
      }
    }
    saveMarket(market);
  } catch (e) {
    console.error('자동폐지 오류:', e.message);
  }
}

// ── 1시간마다 자동화 ──────────────────────────────────
async function runHourlyTasks() {
  if (!client) return;
  console.log('⏰ [1시간] 자동화 작업 시작');
  const { EmbedBuilder } = require('discord.js');
  const config = loadConfig();
  const newsCh = config.newsChannelId
    ? await client.channels.fetch(config.newsChannelId).catch(() => null)
    : null;

  // 2% 확률 주식 자동 상장
  try {
    if (Math.random() < 0.02) {
      const result = autoListStock();
      if (result && newsCh) {
        await newsCh.send({
          embeds: [new EmbedBuilder()
            .setColor(0x00D26A)
            .setTitle(`🎉 신규 주식 상장!`)
            .setDescription(`**${result.emoji} ${result.name}** (${result.ticker}) 상장!`)
            .addFields(
              { name: '💰 공모가', value: `${result.price.toLocaleString()}원`, inline: true },
              { name: '🏭 섹터', value: result.sector, inline: true },
            ).setTimestamp()
          ]
        });
      }
    }
  } catch (e) { console.error('주식상장 오류:', e.message); }

  // 코인 30개 미만이면 무조건 상장, 30개 이상이면 10% 확률
  try {
    const { loadMarket } = require('../utils/marketManager');
    const market = loadMarket();
    const coinCount = Object.keys(market.coins || {}).length;
    const shouldList = coinCount < 30 ? true : Math.random() < 0.10;
    if (shouldList) {
      const result = autoListCoin();
      if (result && newsCh) {
        await newsCh.send({
          embeds: [new EmbedBuilder()
            .setColor(0xF7931A)
            .setTitle('🪙 신규 코인 상장!')
            .setDescription(`**${result.emoji} ${result.name}** (${result.ticker}) 상장!`)
            .addFields({ name: '💰 초기가', value: `${result.price.toLocaleString()}원`, inline: true })
            .setTimestamp()
          ]
        });
      }
    }
  } catch (e) { console.error('코인상장 오류:', e.message); }

  // 0.001% 확률 부도 위기
  try {
    if (Math.random() < 0.00001) {
      const result = triggerBankruptcyWarning();
      if (result && newsCh) {
        await newsCh.send({
          embeds: [new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle('⚠️ 긴급! 부도 위기')
            .setDescription(`**${result.emoji} ${result.name}** 부도 위기!`)
            .addFields(
              { name: '📋 사유', value: result.reason },
              { name: '⏰ 예상 폐지', value: `${result.daysUntilDelist}일 후` },
            ).setTimestamp()
          ]
        });
      }
    }
  } catch (e) { console.error('부도위기 오류:', e.message); }

  // 만료된 부도 처리
  try {
    const delisted = processPendingDelists();
    for (const item of delisted) {
      if (newsCh) {
        await newsCh.send({
          embeds: [new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('📛 상장폐지')
            .setDescription(`**${item.name}** 상장폐지`)
            .setTimestamp()
          ]
        });
      }
    }
  } catch (e) { console.error('부도처리 오류:', e.message); }

  // 1원 코인 자동폐지
  await removeDeadCoins();

  console.log('✅ [1시간] 완료');
}

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
  // 5분마다 — 주식/뉴스 현황판 자동 업데이트
  cron.schedule('*/5 * * * *', () => {
    updateStockBoard();
    updateNewsBoard();
  });

  // 1분마다 — 코인 폐지 체크 (0.01% 확률)
  cron.schedule('* * * * *', async () => {
    if (Math.random() < 0.0001) {
      const result = triggerCoinDelist(false);
      if (result) {
        const config = loadConfig();
        const { EmbedBuilder } = require('discord.js');
        if (config.newsChannelId && client) {
          const ch = await client.channels.fetch(config.newsChannelId).catch(() => null);
          if (ch) await ch.send({
            embeds: [new EmbedBuilder().setColor(0xED4245)
              .setTitle('🪙 코인 폐지').setDescription(`**${result.emoji} ${result.name}** 운영 종료`).setTimestamp()]
          });
        }
      }
    }
    // 먹튀 (0.001% 확률)
    if (Math.random() < 0.00001) {
      const result = triggerCoinDelist(true);
      if (result) {
        const config = loadConfig();
        const { EmbedBuilder } = require('discord.js');
        if (config.newsChannelId && client) {
          const ch = await client.channels.fetch(config.newsChannelId).catch(() => null);
          if (ch) await ch.send({
            embeds: [new EmbedBuilder().setColor(0xFF0000)
              .setTitle('🚨 코인 먹튀!').setDescription(`**${result.emoji} ${result.name}**
💥 ${result.reason}`).setTimestamp()]
          });
        }
      }
    }
  });

  // 1시간마다 — 자동 상장/폐지 + 이자 지급
  cron.schedule('0 * * * *', () => {
    console.log('⏰ [CRON] 1시간 자동화');
    runHourlyTasks();
    // 저축 이자 지급
    try {
      const { applyInterest } = require('../utils/bankManager');
      const results = applyInterest();
      if (results.length > 0) console.log(`💰 이자 지급: ${results.length}명`);
    } catch (e) { console.error('이자 지급 오류:', e.message); }
  });

  // 매주 월요일 09:00 KST — 배당금
  cron.schedule('0 0 * * 1', () => {
    console.log('💸 [CRON] 배당금 지급');
    const results = payDividends();
    console.log(`배당금 ${results.length}명 지급 완료`);
  });

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
  console.log('  - 5분마다: 주식 현황판 자동 업데이트');
  console.log('  - 매일 09:00: 시장 업데이트 + 환율 업데이트 + 랜덤 주식 이벤트');
  console.log('  - 매일 16:00: 장 마감 알림');

  // 봇 시작 후 30초 뒤 초기 현황판 업데이트
  setTimeout(() => { updateStockBoard(); updateNewsBoard(); }, 30000);
}

module.exports = { startScheduler, runDailyMarketUpdate, runHourlyTasks, runCurrencyUpdate, runDailyStockEvent, updateStockBoard, updateNewsBoard, setClient, getNewsBoardState: () => ({ newsBoardPage, newsBoardMessageId }), setNewsBoardPage: (p) => { newsBoardPage = p; } };
