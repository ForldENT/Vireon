const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

const C = {
  bull: 0x00D26A,    // 상승 초록
  bear: 0xFF4757,    // 하락 빨강
  neutral: 0xFFA502, // 보합 주황
  info: 0x2F3136,    // 다크
  gold: 0xFFD700,    // 골드 (랭킹)
  coin: 0xF7931A,    // 비트코인 주황 (코인)
  stock: 0x1E90FF,   // 파랑 (주식)
  news: 0x9B59B6,    // 보라 (뉴스)
  admin: 0xFF6B35,   // 관리자 주황
};

function priceArrow(pct) {
  if (pct > 0) return '▲';
  if (pct < 0) return '▼';
  return '━';
}

function pctColor(pct) {
  return pct > 0 ? C.bull : pct < 0 ? C.bear : C.neutral;
}

function formatPrice(p) {
  if (p >= 1000) return p.toLocaleString() + '원';
  return p.toLocaleString() + '원';
}

function formatPct(p) {
  const sign = p > 0 ? '+' : '';
  return `${sign}${Number(p).toFixed(2)}%`;
}

function miniChart(history) {
  if (!history || history.length < 2) return '─────';
  const bars = ['▁','▂','▃','▄','▅','▆','▇','█'];
  const slice = history.slice(-10);
  const min = Math.min(...slice);
  const max = Math.max(...slice);
  const range = max - min || 1;
  return slice.map(v => bars[Math.floor(((v - min) / range) * 7)]).join('');
}

// ── 시장 현황 Embed ───────────────────────────────────
function marketOverviewEmbed(market) {
  const companies = Object.values(market.companies);
  const coins = Object.values(market.coins);

  // 카테고리별 주식 분류
  const catMap = {
    domestic: { label: '🇰🇷 국내주식', items: [] },
    us: { label: '🇺🇸 미국주식', items: [] },
    europe: { label: '🇪🇺 유럽주식', items: [] },
    uk: { label: '🇬🇧 영국주식', items: [] },
    japan: { label: '🇯🇵 일본주식', items: [] },
    china: { label: '🇨🇳 중국주식', items: [] },
    space: { label: '🚀 우주주식', items: [] },
  };

  for (const a of companies) {
    const cat = a.category || 'domestic';
    if (catMap[cat]) catMap[cat].items.push(a);
    else catMap['domestic'].items.push(a);
  }

  function makeLines(assets) {
    return assets.map(a => {
      const arr = priceArrow(a.changePercent);
      const color = a.changePercent > 0 ? '🟢' : a.changePercent < 0 ? '🔴' : '⚪';
      return `${color} ${a.emoji} **${a.name}**\n> ${formatPrice(a.price)} ${arr} ${formatPct(a.changePercent)}`;
    }).join('\n');
  }

  // 코인 두 줄로 나누기 (11개씩)
  const coinHalf1 = coins.slice(0, 11);
  const coinHalf2 = coins.slice(11);

  function makeCoinLines(assets) {
    return assets.map(a => {
      const arr = priceArrow(a.changePercent);
      const color = a.changePercent > 0 ? '🟢' : a.changePercent < 0 ? '🔴' : '⚪';
      return `${color} ${a.emoji} **${a.name}**\n> ${formatPrice(a.price)} ${arr} ${formatPct(a.changePercent)}`;
    }).join('\n');
  }

  const lastUpdate = market.lastUpdate
    ? `<t:${Math.floor(new Date(market.lastUpdate).getTime() / 1000)}:R>`
    : '아직 업데이트 없음';

  const embed = new EmbedBuilder()
    .setColor(C.info)
    .setTitle('📊 가상 주식 시장 현황판')
    .setDescription(`> 🕐 마지막 업데이트: ${lastUpdate} | 거래일 **${market.totalTradingDays || 0}일차**`);

  // 주식 필드 추가 (종목 있는 카테고리만)
  for (const [, cat] of Object.entries(catMap)) {
    if (cat.items.length > 0) {
      const lines = makeLines(cat.items);
      if (lines.length <= 1024) {
        embed.addFields({ name: cat.label, value: lines });
      }
    }
  }

  // 코인 필드 (둘로 나눠서)
  if (coinHalf1.length > 0) {
    embed.addFields({ name: '🪙 코인 (1)', value: makeCoinLines(coinHalf1) });
  }
  if (coinHalf2.length > 0) {
    embed.addFields({ name: '🪙 코인 (2)', value: makeCoinLines(coinHalf2) });
  }

  embed.setFooter({ text: '💡 /stock info [티커] | /buy [티커] [수량] | 버튼으로 필터링' })
    .setTimestamp();

  return embed;
}

// ── 종목 상세 Embed ───────────────────────────────────
function assetDetailEmbed(asset) {
  const isUp = asset.changePercent > 0;
  const isDown = asset.changePercent < 0;
  const color = isUp ? C.bull : isDown ? C.bear : C.neutral;
  const arrow = priceArrow(asset.changePercent);

  const chart = miniChart(asset.history);
  const chartFull = asset.history ? asset.history.slice(-20).map((v, i, arr) => {
    const prev = arr[i-1] || v;
    return v > prev ? '▲' : v < prev ? '▽' : '─';
  }).join('') : '데이터 없음';

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${asset.emoji} ${asset.name} (${asset.id})`)
    .setDescription(`> ${asset.description}`)
    .addFields(
      { name: '💰 현재가', value: `**${formatPrice(asset.price)}** ${arrow} ${formatPct(asset.changePercent)}`, inline: true },
      { name: '📂 시작가', value: formatPrice(asset.open), inline: true },
      { name: '🏷️ 섹터', value: `${asset.type === 'coin' ? '🪙 코인' : '🏢 주식'} / ${asset.sector}`, inline: true },
      { name: '📈 고가', value: `**${formatPrice(asset.high)}**`, inline: true },
      { name: '📉 저가', value: `**${formatPrice(asset.low)}**`, inline: true },
      { name: '📊 거래량', value: `${(asset.volume || 0).toLocaleString()}주`, inline: true },
      { name: `📉 가격 추이 (최근 ${Math.min(asset.history?.length || 0, 20)}일)`, value: `\`\`\`${chartFull}\`\`\`` },
      { name: '🔢 히스토리 (숫자)', value: `\`${(asset.history || []).slice(-10).map(v => v.toLocaleString()).join(' → ')}\`` },
    )
    .setTimestamp();
}

// ── 포트폴리오 Embed ──────────────────────────────────
function portfolioEmbed(portfolio, username) {
  const { balance, totalValue, totalAssets, totalPnl, returnRate, positions } = portfolio;

  const positionLines = positions.length > 0
    ? positions.map(p => {
        const color = p.pnl >= 0 ? '🟢' : '🔴';
        const sign = p.pnl >= 0 ? '+' : '';
        return `${color} **${p.emoji}${p.ticker}** × ${p.qty.toLocaleString()}주\n> 현재가 ${formatPrice(p.currentPrice)} | 평균단가 ${formatPrice(p.avgPrice)} | **${sign}${p.pnl.toLocaleString()}원** (${formatPct(p.pnlPercent)})`;
      }).join('\n')
    : '> 보유 종목 없음';

  const totalColor = totalPnl >= 0 ? C.bull : C.bear;
  const returnEmoji = parseFloat(returnRate) >= 0 ? '📈' : '📉';

  return new EmbedBuilder()
    .setColor(totalColor)
    .setTitle(`💼 ${username}의 포트폴리오`)
    .addFields(
      { name: '💵 예수금(현금)', value: `**${balance.toLocaleString()}원**`, inline: true },
      { name: '📊 평가금액', value: `**${totalValue.toLocaleString()}원**`, inline: true },
      { name: '🏦 총 자산', value: `**${totalAssets.toLocaleString()}원**`, inline: true },
      { name: `${returnEmoji} 총 손익`, value: `**${totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString()}원**`, inline: true },
      { name: '📈 수익률', value: `**${formatPct(returnRate)}**`, inline: true },
      { name: '─', value: '─', inline: true },
      { name: '📋 보유 종목', value: positionLines },
    )
    .setTimestamp();
}

// ── 거래 내역 Embed ───────────────────────────────────
function transactionEmbed(transactions) {
  const lines = transactions.length > 0
    ? transactions.slice(0, 10).map(t => {
        const emoji = t.type === 'BUY' ? '🟦매수' : '🟧매도';
        const pnlStr = t.pnl !== undefined ? ` | 손익: ${t.pnl >= 0 ? '+' : ''}${t.pnl.toLocaleString()}원` : '';
        const date = new Date(t.date);
        const dateStr = `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2,'0')}`;
        return `**${emoji}** \`${t.ticker}\` ${t.quantity.toLocaleString()}주 @ ${formatPrice(t.price)}${pnlStr} \`${dateStr}\``;
      }).join('\n')
    : '거래 내역 없음';

  return new EmbedBuilder()
    .setColor(C.info)
    .setTitle('📋 최근 거래 내역')
    .setDescription(lines)
    .setTimestamp();
}

// ── 랭킹 Embed ────────────────────────────────────────
function rankingEmbed(rankings, client) {
  const medals = ['🥇', '🥈', '🥉'];
  const lines = rankings.map((r, i) => {
    const medal = medals[i] || `**${i + 1}.**`;
    const sign = parseFloat(r.returnRate) >= 0 ? '+' : '';
    const user = client?.users?.cache?.get(r.userId);
    const name = user ? user.username : `유저 ${r.userId.slice(-4)}`;
    return `${medal} **${name}** — ${r.totalAssets.toLocaleString()}원 \`${sign}${r.returnRate}%\``;
  }).join('\n');

  return new EmbedBuilder()
    .setColor(C.gold)
    .setTitle('🏆 투자자 수익률 랭킹 TOP 10')
    .setDescription(lines || '등록된 투자자 없음')
    .setFooter({ text: '💡 /stock start 로 1,000만원 시드머니와 함께 시작하세요!' })
    .setTimestamp();
}

// ── 뉴스 Embed ────────────────────────────────────────
function newsEmbed(newsItems) {
  const fields = newsItems.map(n => ({
    name: `${n.isPositive ? '📈' : '📉'} ${n.assetEmoji} ${n.title}`,
    value: `> ${n.body}\n> 영향 종목: **${n.assetName}** | 예상 변동: \`${n.impact > 0 ? '+' : ''}${(n.impact * 100).toFixed(1)}%\``,
  }));

  return new EmbedBuilder()
    .setColor(C.news)
    .setTitle('📰 오늘의 가상 시장 뉴스')
    .setDescription('> AI가 생성한 가상의 뉴스입니다. 뉴스에 따라 당일 주가가 변동됩니다!')
    .addFields(...fields.slice(0, 5))
    .setTimestamp();
}

// ── 단일 뉴스 Embed ───────────────────────────────────
function singleNewsEmbed(news) {
  return new EmbedBuilder()
    .setColor(news.isPositive ? C.bull : C.bear)
    .setTitle(`${news.isPositive ? '📈' : '📉'} ${news.assetEmoji} ${news.title}`)
    .setDescription(news.body)
    .addFields(
      { name: '🏷️ 관련 종목', value: `**${news.assetName}** (${news.ticker})`, inline: true },
      { name: '📊 예상 가격 영향', value: `\`${news.impact > 0 ? '+' : ''}${(news.impact * 100).toFixed(1)}%\``, inline: true },
    )
    .setTimestamp(new Date(news.publishedAt));
}

// ── 관리자 종목 생성 확인 Embed ───────────────────────
function adminCreateEmbed(options) {
  return new EmbedBuilder()
    .setColor(C.admin)
    .setTitle('🔧 관리자: 신규 종목 생성')
    .addFields(
      { name: '티커', value: options.ticker, inline: true },
      { name: '이름', value: options.name, inline: true },
      { name: '타입', value: options.type === 'coin' ? '🪙 코인' : '🏢 주식', inline: true },
      { name: '섹터', value: options.sector, inline: true },
      { name: '이모지', value: options.emoji, inline: true },
      { name: '초기 가격', value: formatPrice(options.price), inline: true },
      { name: '설명', value: options.description },
    );
}

// ── 버튼 컴포넌트 ─────────────────────────────────────
function marketControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('market_refresh').setLabel('🔄 새로고침').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('market_stocks').setLabel('🏢 주식만').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('market_coins').setLabel('🪙 코인만').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('market_ranking').setLabel('🏆 랭킹').setStyle(ButtonStyle.Success),
  );
}

module.exports = {
  marketOverviewEmbed,
  assetDetailEmbed,
  portfolioEmbed,
  transactionEmbed,
  rankingEmbed,
  newsEmbed,
  singleNewsEmbed,
  adminCreateEmbed,
  marketControlRow,
  C, formatPrice, formatPct, priceArrow,
};
