const cron = require('node-cron');
const { applyDailyUpdate, loadConfig } = require('../utils/marketManager');
const { generateDailyNews } = require('../utils/newsGenerator');
const { newsEmbed, marketOverviewEmbed } = require('../utils/stockEmbeds');
const { loadMarket } = require('../utils/marketManager');
const {
  autoListStock,
  autoListCoin,
  triggerBankruptcyWarning,
  triggerCoinDelist,
  processPendingDelists,
  payDividends,
} = require('../utils/autoMarket');

let client = null;

function setClient(discordClient) {
  client = discordClient;
}

// ── 채널 가져오기 헬퍼 ───────────────────────────────
async function getChannels() {
  const config = loadConfig();
  const news = config.newsChannelId ? await client.channels.fetch(config.newsChannelId).catch(() => null) : null;
  const stock = config.stockChannelId ? await client.channels.fetch(config.stockChannelId).catch(() => null) : null;
  return { news, stock };
}

// ── 1시간마다 실행 ────────────────────────────────────
async function runHourlyTasks() {
  if (!client) return;
  console.log('⏰ [1시간] 자동화 작업 시작');

  const { news: newsCh, stock: stockCh } = await getChannels();
  const { EmbedBuilder } = require('discord.js');

  // ── 1. 뉴스 업데이트 ──────────────────────────────
  try {
    const { news, impacts } = generateDailyNews();
    applyDailyUpdate(impacts);

    if (newsCh && news.length > 0) {
      await newsCh.send({ embeds: [newsEmbed(news)] });
      console.log(`📰 뉴스 ${news.length}건 발송`);
    }
  } catch (e) {
    console.error('뉴스 오류:', e.message);
  }

  // ── 2. 주식 자동 상장 (2% 확률) ──────────────────
  try {
    if (Math.random() < 0.02) {
      const result = autoListStock();
      if (result && newsCh) {
        await newsCh.send({
          embeds: [new EmbedBuilder()
            .setColor(0x00D26A)
            .setTitle(`🎉 신규 상장! ${result.categoryEmoji} ${result.category}`)
            .setDescription(`**${result.emoji} ${result.name}** (${result.ticker}) 이(가) 상장되었습니다!`)
            .addFields(
              { name: '💰 공모가', value: `**${result.price.toLocaleString()}원**`, inline: true },
              { name: '🏭 섹터', value: result.sector, inline: true },
              { name: '📂 카테고리', value: result.category, inline: true },
            )
            .setFooter({ text: '💡 /stock info ' + result.ticker + ' 로 상세 정보 확인!' })
            .setTimestamp()
          ]
        });
        console.log(`📈 신규 상장: ${result.ticker}`);
      }
    }
  } catch (e) {
    console.error('주식 상장 오류:', e.message);
  }

  // ── 3. 주식 부도 위기 (0.001% 확률) ─────────────
  try {
    if (Math.random() < 0.00001) {
      const result = triggerBankruptcyWarning();
      if (result && newsCh) {
        await newsCh.send({
          embeds: [new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(`⚠️ 긴급 뉴스 — 부도 위기`)
            .setDescription(`**${result.emoji} ${result.name}** (${result.ticker}) 부도 위기!`)
            .addFields(
              { name: '📋 사유', value: result.reason, inline: false },
              { name: '📉 주가 하락', value: `-${result.dropRate.toFixed(1)}%`, inline: true },
              { name: '⏰ 예상 상장폐지', value: `약 **${result.daysUntilDelist}일** 후`, inline: true },
            )
            .setFooter({ text: '⚠️ 보유 중이라면 매도를 고려하세요!' })
            .setTimestamp()
          ]
        });
        console.log(`⚠️ 부도 위기: ${result.ticker}`);
      }
    }
  } catch (e) {
    console.error('부도 위기 오류:', e.message);
  }

  // ── 4. 코인 자동 상장 (10% 확률) ─────────────────
  try {
    if (Math.random() < 0.10) {
      const result = autoListCoin();
      if (result && newsCh) {
        await newsCh.send({
          embeds: [new EmbedBuilder()
            .setColor(0xF7931A)
            .setTitle('🪙 신규 코인 상장!')
            .setDescription(`**${result.emoji} ${result.name}** (${result.ticker}) 이(가) 상장되었습니다!`)
            .addFields(
              { name: '💰 초기가', value: `**${result.price.toLocaleString()}원**`, inline: true },
              { name: '🏷️ 섹터', value: result.sector, inline: true },
            )
            .setTimestamp()
          ]
        });
        console.log(`🪙 코인 상장: ${result.ticker}`);
      }
    }
  } catch (e) {
    console.error('코인 상장 오류:', e.message);
  }

  // ── 5. 만료된 부도 처리 ───────────────────────────
  try {
    const delisted = processPendingDelists();
    for (const item of delisted) {
      if (newsCh) {
        await newsCh.send({
          embeds: [new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('📛 상장 폐지')
            .setDescription(`**${item.emoji} ${item.name}** (${item.ticker}) 이(가) 상장 폐지되었습니다.`)
            .addFields({ name: '📋 사유', value: item.reason })
            .setFooter({ text: '보유 주식은 자동으로 처리되었습니다.' })
            .setTimestamp()
          ]
        });
        console.log(`📛 상장 폐지: ${item.ticker}`);
      }
    }
  } catch (e) {
    console.error('부도 처리 오류:', e.message);
  }

  console.log('✅ [1시간] 자동화 작업 완료');
}

// ── 1분마다 실행 (코인 폐지) ──────────────────────────
async function runMinuteTasks() {
  if (!client) return;

  const { EmbedBuilder } = require('discord.js');
  const { news: newsCh } = await getChannels();

  // 코인 일반 폐지 (0.01% 확률)
  try {
    if (Math.random() < 0.0001) {
      const result = triggerCoinDelist(false);
      if (result && newsCh) {
        await newsCh.send({
          embeds: [new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('🪙 코인 상장 폐지')
            .setDescription(`**${result.emoji} ${result.name}** (${result.ticker}) 이(가) 운영을 종료했습니다.`)
            .addFields(
              { name: '📋 사유', value: '운영팀 자체 판단으로 서비스 종료', inline: false },
              { name: '💰 최종가', value: `${result.lastPrice.toLocaleString()}원`, inline: true },
            )
            .setTimestamp()
          ]
        });
      }
    }
  } catch (e) {
    console.error('코인 폐지 오류:', e.message);
  }

  // 코인 먹튀 (0.001% 확률)
  try {
    if (Math.random() < 0.00001) {
      const result = triggerCoinDelist(true);
      if (result && newsCh) {
        await newsCh.send({
          embeds: [new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('🚨 긴급! 코인 먹튀 사건 발생!')
            .setDescription(`**${result.emoji} ${result.name}** (${result.ticker})\n\n💥 **${result.reason}**`)
            .addFields(
              { name: '💰 최종가', value: `${result.lastPrice.toLocaleString()}원 → **0원**`, inline: true },
              { name: '⚠️ 주의', value: '보유 자산이 모두 소멸되었습니다!', inline: false },
            )
            .setTimestamp()
          ]
        });
      }
    }
  } catch (e) {
    console.error('먹튀 처리 오류:', e.message);
  }
}

// ── 7일마다 배당금 지급 ───────────────────────────────
async function runDividends() {
  if (!client) return;
  console.log('💸 [배당금] 지급 시작');

  const results = payDividends();
  if (results.length === 0) return;

  const { EmbedBuilder } = require('discord.js');
  const { stock: stockCh } = await getChannels();

  if (stockCh) {
    const topLines = results
      .sort((a, b) => b.totalDividend - a.totalDividend)
      .slice(0, 5)
      .map(r => {
        const user = client.users.cache.get(r.userId);
        const name = user ? user.username : `유저 ${r.userId.slice(-4)}`;
        return `💼 **${name}** — **+${r.totalDividend.toLocaleString()}원**`;
      }).join('\n');

    await stockCh.send({
      embeds: [new EmbedBuilder()
        .setColor(0xF39C12)
        .setTitle('💸 주식 배당금 지급!')
        .setDescription(`보유 주식의 **1%** 배당금이 지급되었습니다!\n\n${topLines}`)
        .setFooter({ text: `총 ${results.length}명에게 배당금 지급` })
        .setTimestamp()
      ]
    });
  }

  console.log(`✅ [배당금] ${results.length}명 지급 완료`);
}

// ── 일일 시장 업데이트 ────────────────────────────────
async function runDailyMarketUpdate() {
  console.log('⏰ [일일] 시장 업데이트');
  try {
    const market = loadMarket();
    if (!client) return;
    const { stock: stockCh } = await getChannels();
    if (stockCh) {
      await stockCh.send({
        content: '📊 **오늘의 시장 현황**',
        embeds: [marketOverviewEmbed(market)],
      });
    }
  } catch (e) {
    console.error('일일 업데이트 오류:', e.message);
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

// ── 스케줄 등록 ───────────────────────────────────────
function startScheduler() {
  // 1분마다 — 코인 폐지 체크
  cron.schedule('* * * * *', () => {
    runMinuteTasks();
  });

  // 1시간마다 — 뉴스, 주식/코인 상장, 부도 처리
  cron.schedule('0 * * * *', () => {
    console.log('⏰ [CRON] 1시간 자동화 실행');
    runHourlyTasks();
  });

  // 매일 09:00 KST = UTC 00:00 — 시장 현황 발송
  cron.schedule('0 0 * * *', () => {
    console.log('⏰ [CRON] 일일 시장 현황');
    runDailyMarketUpdate();
  });

  // 매일 16:00 KST = UTC 07:00 — 장 마감
  cron.schedule('0 7 * * *', () => {
    console.log('⏰ [CRON] 장 마감');
    sendClosingBell();
  });

  // 매주 월요일 09:00 KST — 배당금
  cron.schedule('0 0 * * 1', () => {
    console.log('💸 [CRON] 배당금 지급');
    runDividends();
  });

  console.log('⏰ [스케줄러] 등록 완료');
  console.log('  - 매분: 코인 폐지 체크');
  console.log('  - 매시: 뉴스 + 상장/폐지 자동화');
  console.log('  - 매일 09:00: 시장 현황');
  console.log('  - 매일 16:00: 장 마감');
  console.log('  - 매주 월요일: 배당금 지급');
}

module.exports = { startScheduler, runDailyMarketUpdate, runHourlyTasks, setClient };
