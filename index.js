require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Client, GatewayIntentBits, Collection, Events, EmbedBuilder } = require('discord.js');
const { setClient, startScheduler } = require('./scheduler/marketScheduler');
const { buyAsset, sellAsset, loadMarket, getRankings, loadUsers, loadNews } = require('./utils/marketManager');
const { marketOverviewEmbed, rankingEmbed, C } = require('./utils/stockEmbeds');
const { marketControlRow } = require('./utils/stockEmbeds');
const { mine } = require('./utils/miningManager');
const { processOverdueLoans } = require('./utils/bankManager');

// ── HTTP 서버 (웹 대시보드 + API) ─────────────────────
const server = http.createServer((req, res) => {
  const url = req.url;

  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // ── API: 시장 데이터 ─────────────────────────────────
  if (url === '/api/market') {
    try {
      const market = loadMarket();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(market));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── API: 뉴스 데이터 ─────────────────────────────────
  if (url === '/api/news') {
    try {
      const news = loadNews();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(news.slice(0, 20)));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }

  // ── API: 랭킹 데이터 ─────────────────────────────────
  if (url === '/api/rankings') {
    try {
      const users = loadUsers();
      const market = loadMarket();
      const rankings = Object.entries(users)
        .filter(([id]) => !id.startsWith('_'))
        .map(([userId, userData]) => {
          let portfolioValue = 0;
          const portfolio = userData.portfolio || {};
          for (const [ticker, pos] of Object.entries(portfolio)) {
            const asset = market.companies[ticker] || market.coins[ticker];
            if (asset) portfolioValue += asset.price * pos.qty;
          }
          return {
            userId,
            username: userData.username || `유저 ${userId.slice(-4)}`,
            balance: userData.balance || 0,
            portfolioValue,
            totalAssets: (userData.balance || 0) + portfolioValue,
          };
        })
        .sort((a, b) => b.totalAssets - a.totalAssets)
        .slice(0, 10);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(rankings));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }

  // ── 웹 대시보드 ──────────────────────────────────────
  if (url === '/' || url === '/dashboard') {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(htmlPath, 'utf8'));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK - Vireon Bot Running');
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`🌐 웹 서버 시작: port ${process.env.PORT || 3000}`);
});

// ── Discord 클라이언트 ────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.commands = new Collection();

function loadCommandsFrom(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommandsFrom(fullPath);
    } else if (entry.name.endsWith('.js')) {
      const mod = require(fullPath);
      if (mod.data && mod.execute) {
        client.commands.set(mod.data.name, mod);
        console.log(`✅ 커맨드 로드: /${mod.data.name}`);
      }
      for (const key of Object.keys(mod)) {
        if (mod[key]?.data && mod[key]?.execute) {
          client.commands.set(mod[key].data.name, mod[key]);
          console.log(`✅ 커맨드 로드: /${mod[key].data.name}`);
        }
      }
    }
  }
}

loadCommandsFrom(path.join(__dirname, 'commands'));

client.once(Events.ClientReady, async (c) => {
  console.log(`\n📊 ${c.user.tag} 봇 시작!`);
  console.log(`📋 ${client.commands.size}개 커맨드 로드\n`);
  c.user.setActivity('📈 /stock market', { type: 3 });
  setClient(c);
  startScheduler();

  // 5분마다 가격 변동
  setInterval(async () => {
    try {
      const { applyDailyUpdate } = require('./utils/marketManager');
      const { generateDailyNews } = require('./utils/newsGenerator');
      const { news, impacts } = generateDailyNews();
      applyDailyUpdate(impacts);
    } catch (e) {
      console.error('5분 업데이트 오류:', e.message);
    }
  }, 5 * 60 * 1000);

  // 1시간마다 연체 체크
  setInterval(async () => {
    try { processOverdueLoans(); } catch (e) {}
  }, 60 * 60 * 1000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) { await handleButton(interaction); return; }
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`커맨드 오류 (/${interaction.commandName}):`, err);
    const errEmbed = new EmbedBuilder().setColor(C.bear).setDescription('❌ 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [errEmbed], ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ embeds: [errEmbed], ephemeral: true }).catch(() => {});
    }
  }
});

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === 'market_refresh') {
    await interaction.deferUpdate();
    return interaction.editReply({ embeds: [marketOverviewEmbed(loadMarket())], components: [marketControlRow()] });
  }
  if (id === 'market_stocks') {
    await interaction.deferUpdate();
    const market = loadMarket();
    const lines = Object.values(market.companies).map(a => {
      const arr = a.changePercent > 0 ? '▲' : a.changePercent < 0 ? '▼' : '━';
      const color = a.changePercent > 0 ? '🟢' : a.changePercent < 0 ? '🔴' : '⚪';
      return `${color} \`${a.id.padEnd(8)}\` ${a.emoji} **${a.name}**\n> ${a.price.toLocaleString()}원 ${arr} ${a.changePercent > 0 ? '+' : ''}${a.changePercent}%`;
    }).join('\n');
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.stock).setTitle('🏢 주식 현황').setDescription(lines).setTimestamp()], components: [marketControlRow()] });
  }
  if (id === 'market_coins') {
    await interaction.deferUpdate();
    const market = loadMarket();
    const lines = Object.values(market.coins).map(a => {
      const arr = a.changePercent > 0 ? '▲' : a.changePercent < 0 ? '▼' : '━';
      const color = a.changePercent > 0 ? '🟢' : a.changePercent < 0 ? '🔴' : '⚪';
      return `${color} \`${a.id.padEnd(8)}\` ${a.emoji} **${a.name}**\n> ${a.price.toLocaleString()}원 ${arr} ${a.changePercent > 0 ? '+' : ''}${a.changePercent}%`;
    }).join('\n');
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.coin).setTitle('🪙 코인 현황').setDescription(lines).setTimestamp()], components: [marketControlRow()] });
  }
  if (id === 'market_ranking') {
    await interaction.deferReply({ ephemeral: true });
    return interaction.editReply({ embeds: [rankingEmbed(getRankings(interaction.client), interaction.client)] });
  }
  if (id.startsWith('buy_confirm_')) {
    const parts = id.split('_'); const ticker = parts[2]; const qty = parseInt(parts[3]);
    await interaction.deferUpdate();
    const result = buyAsset(interaction.user.id, ticker, qty);
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(result.success ? C.bull : C.bear).setDescription(result.message)], components: [] });
  }
  if (id === 'buy_cancel') {
    return interaction.update({ embeds: [new EmbedBuilder().setColor(C.neutral).setDescription('❌ 매수가 취소되었어요.')], components: [] });
  }
  if (id.startsWith('sell_confirm_')) {
    const parts = id.split('_'); const ticker = parts[2]; const qty = parseInt(parts[3]);
    await interaction.deferUpdate();
    const result = sellAsset(interaction.user.id, ticker, qty);
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(result.success ? (result.pnl >= 0 ? C.bull : C.bear) : C.bear).setDescription(result.message)], components: [] });
  }
  if (id === 'sell_cancel') {
    return interaction.update({ embeds: [new EmbedBuilder().setColor(C.neutral).setDescription('❌ 매도가 취소되었어요.')], components: [] });
  }
  if (id === 'mine_again') {
    await interaction.deferReply();
    const result = mine(interaction.user.id);
    if (!result.success) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription(result.message)] });
    const { grade, item, gradeData, stockDrop, tool } = result;
    const GRADE_COLORS = { SSS: 16711680, SS: 16737792, S: 16766720, A: 10179002, B: 3447003, C: 9868950 };
    const embed = new EmbedBuilder().setColor(GRADE_COLORS[grade]).setTitle(`${gradeData.emoji} 채굴 완료! [${grade}등급]`).setDescription(`**${item.name}** 을(를) 발견했어요!\n💰 기본가: ${item.basePrice.toLocaleString()}원`).setTimestamp();
    if (stockDrop) embed.addFields({ name: '🎰 보너스!', value: `${stockDrop.emoji} **${stockDrop.name}** 1주 획득!` });
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('mine_again').setLabel('⛏️ 다시 채굴').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('mine_inventory').setLabel('🎒 인벤토리').setStyle(ButtonStyle.Secondary),
    );
    return interaction.editReply({ embeds: [embed], components: [row] });
  }
  if (id === 'mine_inventory') {
    const { getInventory, loadMiningData } = require('./utils/miningManager');
    const userData = getInventory(interaction.user.id);
    const miningData = loadMiningData();
    if (Object.keys(userData.minerals).length === 0) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x95A5A6).setDescription('📦 인벤토리가 비어있어요!')], ephemeral: true });
    const gradeOrder = ['SSS', 'SS', 'S', 'A', 'B', 'C'];
    const lines = Object.entries(userData.minerals).sort((a, b) => gradeOrder.indexOf(a[1].grade) - gradeOrder.indexOf(b[1].grade)).map(([id, m]) => `${miningData.minerals[m.grade].emoji} **[${m.grade}] ${m.name}** × ${m.count}개`).join('\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ECC71).setTitle('🎒 광물 인벤토리').setDescription(lines)], ephemeral: true });
  }
}

process.on('unhandledRejection', err => console.error('Unhandled:', err));
client.login(process.env.DISCORD_TOKEN);
