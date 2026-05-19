const cron = require('node-cron');
const { applyDailyUpdate, loadConfig, loadMarket } = require('../utils/marketManager');
const { generateDailyNews } = require('../utils/newsGenerator');
const { newsEmbed, marketOverviewEmbed, marketControlRow } = require('../utils/stockEmbeds');

let client = null;

function setClient(discordClient) {
  client = discordClient;
}

// ── 일일 시장 업데이트 실행 ───────────────────────────
async function runDailyMarketUpdate() {
  console.log('⏰ [스케줄러] 일일 시장 업데이트 시작...');

  try {
    // 1. 뉴스 생성
    const { news, impacts } = generateDailyNews();
    console.log(`📰 뉴스 ${news.length}건 생성`);

    // 2. 가격 업데이트
    const results = applyDailyUpdate(impacts);
    console.log(`📊 ${results.length}개 종목 가격 업데이트 완료`);

    // 3. Discord 채널에 발송
    if (!client) return;
    const config = loadConfig();

    // 뉴스 발송
    if (config.newsChannelId) {
      const newsChannel = await client.channels.fetch(config.newsChannelId).catch(() => null);
      if (newsChannel && news.length > 0) {
        await newsChannel.send({ embeds: [newsEmbed(news)] });
      }
    }

    // 주가 업데이트 발송
    if (config.stockChannelId) {
      const stockChannel = await client.channels.fetch(config.stockChannelId).catch(() => null);
      if (stockChannel) {
        const market = loadMarket();
        await stockChannel.send({
          content: '📊 **오늘의 시장 업데이트**',
          embeds: [marketOverviewEmbed(market)],
        });

        // 변동 요약 발송
        const topGainers = results.filter(r => r.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 3);
        const topLosers = results.filter(r => r.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 3);

        if (topGainers.length > 0 || topLosers.length > 0) {
          const { EmbedBuilder } = require('discord.js');
          const summaryEmbed = new EmbedBuilder()
            .setColor(0x2F3136)
            .setTitle('📈📉 오늘의 상승/하락 TOP 3')
            .addFields(
              {
                name: '🔺 상승 TOP 3',
                value: topGainers.map(r =>
                  `**${r.ticker}** ${r.oldPrice.toLocaleString()} → **${r.newPrice.toLocaleString()}원** (+${r.changePercent.toFixed(2)}%)`
                ).join('\n') || '없음',
                inline: true,
              },
              {
                name: '🔻 하락 TOP 3',
                value: topLosers.map(r =>
                  `**${r.ticker}** ${r.oldPrice.toLocaleString()} → **${r.newPrice.toLocaleString()}원** (${r.changePercent.toFixed(2)}%)`
                ).join('\n') || '없음',
                inline: true,
              }
            )
            .setTimestamp();
          await stockChannel.send({ embeds: [summaryEmbed] });
        }
      }
    }

    console.log('✅ [스케줄러] 일일 업데이트 완료');
    return { news, results };

  } catch (err) {
    console.error('❌ [스케줄러] 오류:', err);
  }
}

// ── 스케줄 등록 ───────────────────────────────────────
function startScheduler() {
  // 매일 오전 9시 (한국 시간 기준, UTC+9이면 00:00 UTC)
  // KST 09:00 = UTC 00:00
  cron.schedule('0 0 * * *', () => {
    console.log('⏰ [CRON] 일일 09:00 시장 업데이트 실행');
    runDailyMarketUpdate();
  }, { timezone: 'Asia/Seoul' });

  // 매일 오후 6시 장 마감 요약 (선택)
  cron.schedule('0 18 * * *', () => {
    console.log('⏰ [CRON] 장 마감 알림');
    sendClosingBell();
  }, { timezone: 'Asia/Seoul' });

  console.log('⏰ [스케줄러] 등록 완료 (매일 09:00 시장 업데이트 / 18:00 마감 알림)');
}

async function sendClosingBell() {
  if (!client) return;
  const config = loadConfig();
  if (!config.stockChannelId) return;

  const channel = await client.channels.fetch(config.stockChannelId).catch(() => null);
  if (!channel) return;

  const { EmbedBuilder } = require('discord.js');
  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0xFF6B35)
      .setTitle('🔔 장 마감 알림')
      .setDescription('오늘 가상 시장의 거래가 마감되었습니다.\n내일 오전 9시에 새로운 뉴스와 함께 시장이 열립니다!')
      .setTimestamp()
    ]
  });
}

module.exports = { startScheduler, runDailyMarketUpdate, setClient };
