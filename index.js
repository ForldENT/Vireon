require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Events, EmbedBuilder } = require('discord.js');
const { setClient, startScheduler } = require('./scheduler/marketScheduler');
const { buyAsset, sellAsset } = require('./utils/marketManager');
const { marketOverviewEmbed, rankingEmbed, C } = require('./utils/stockEmbeds');
const { loadMarket, getRankings } = require('./utils/marketManager');
const { marketControlRow } = require('./utils/stockEmbeds');

// ── 클라이언트 초기화 ─────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

client.commands = new Collection();

// ── 커맨드 로드 (재귀) ────────────────────────────────
function loadCommandsFrom(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommandsFrom(fullPath);
    } else if (entry.name.endsWith('.js')) {
      const mod = require(fullPath);
      // 단일 커맨드
      if (mod.data && mod.execute) {
        client.commands.set(mod.data.name, mod);
        console.log(`✅ 커맨드 로드: /${mod.data.name}`);
      }
      // 복수 커맨드 (buyCommand, sellCommand 등)
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

// ── 봇 준비 ───────────────────────────────────────────
client.once(Events.ClientReady, async (c) => {
  console.log(`\n📊 ${c.user.tag} 가상 주식 봇 시작!`);
  console.log(`📋 ${client.commands.size}개 커맨드 로드\n`);

  c.user.setActivity('📈 /stock market', { type: 3 }); // Watching

  // 스케줄러 시작
  setClient(c);
  startScheduler();
});

// ── 슬래시 커맨드 처리 ────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {

  // 🎮 버튼 처리
  if (interaction.isButton()) {
    await handleButton(interaction);
    return;
  }

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

// ── 버튼 인터랙션 핸들러 ──────────────────────────────
async function handleButton(interaction) {
  const id = interaction.customId;

  // 시장 새로고침
  if (id === 'market_refresh') {
    await interaction.deferUpdate();
    const market = loadMarket();
    return interaction.editReply({
      embeds: [marketOverviewEmbed(market)],
      components: [marketControlRow()],
    });
  }

  // 주식만 보기
  if (id === 'market_stocks') {
    await interaction.deferUpdate();
    const market = loadMarket();
    const companies = Object.values(market.companies);
    const lines = companies.map(a => {
      const arr = a.changePercent > 0 ? '▲' : a.changePercent < 0 ? '▼' : '━';
      const color = a.changePercent > 0 ? '🟢' : a.changePercent < 0 ? '🔴' : '⚪';
      return `${color} \`${a.id.padEnd(8)}\` ${a.emoji} **${a.name}**\n> ${a.price.toLocaleString()}원 ${arr} ${a.changePercent > 0 ? '+' : ''}${a.changePercent}%`;
    }).join('\n');
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(C.stock).setTitle('🏢 주식 현황').setDescription(lines).setTimestamp()],
      components: [marketControlRow()],
    });
  }

  // 코인만 보기
  if (id === 'market_coins') {
    await interaction.deferUpdate();
    const market = loadMarket();
    const coins = Object.values(market.coins);
    const lines = coins.map(a => {
      const arr = a.changePercent > 0 ? '▲' : a.changePercent < 0 ? '▼' : '━';
      const color = a.changePercent > 0 ? '🟢' : a.changePercent < 0 ? '🔴' : '⚪';
      return `${color} \`${a.id.padEnd(8)}\` ${a.emoji} **${a.name}**\n> ${a.price.toLocaleString()}원 ${arr} ${a.changePercent > 0 ? '+' : ''}${a.changePercent}%`;
    }).join('\n');
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(C.coin).setTitle('🪙 코인 현황').setDescription(lines).setTimestamp()],
      components: [marketControlRow()],
    });
  }

  // 랭킹
  if (id === 'market_ranking') {
    await interaction.deferReply({ ephemeral: true });
    const rankings = getRankings(interaction.client);
    return interaction.editReply({ embeds: [rankingEmbed(rankings, interaction.client)] });
  }

  // 매수 확인
  if (id.startsWith('buy_confirm_')) {
    const parts = id.split('_');
    const ticker = parts[2];
    const qty = parseInt(parts[3]);
    await interaction.deferUpdate();
    const result = buyAsset(interaction.user.id, ticker, qty);
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(result.success ? C.bull : C.bear)
        .setDescription(result.message)
      ],
      components: [],
    });
  }

  // 매수 취소
  if (id === 'buy_cancel') {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(C.neutral).setDescription('❌ 매수가 취소되었어요.')],
      components: [],
    });
  }

  // 매도 확인
  if (id.startsWith('sell_confirm_')) {
    const parts = id.split('_');
    const ticker = parts[2];
    const qty = parseInt(parts[3]);
    await interaction.deferUpdate();
    const result = sellAsset(interaction.user.id, ticker, qty);
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(result.success ? (result.pnl >= 0 ? C.bull : C.bear) : C.bear)
        .setDescription(result.message)
      ],
      components: [],
    });
  }

  // 매도 취소
  if (id === 'sell_cancel') {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(C.neutral).setDescription('❌ 매도가 취소되었어요.')],
      components: [],
    });
  }
}

process.on('unhandledRejection', err => console.error('Unhandled:', err));
client.login(process.env.DISCORD_TOKEN);
