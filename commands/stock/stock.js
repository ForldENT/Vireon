const { checkChannel, getChannelErrorMessage } = require('../../utils/channelCheck');
const { SlashCommandBuilder } = require('discord.js');
const { getAllAssets, getAsset, getPortfolio, getRankings, ensureUser, loadConfig } = require('../../utils/marketManager');
const { getRecentNews, getNewsByTicker } = require('../../utils/newsGenerator');
const {
  marketOverviewEmbed, assetDetailEmbed, portfolioEmbed,
  transactionEmbed, rankingEmbed, newsEmbed, singleNewsEmbed, marketControlRow,
} = require('../../utils/stockEmbeds');
const { loadMarket } = require('../../utils/marketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stock')
    .setDescription('📊 가상 주식 시장')
    .addSubcommand(sub => sub
      .setName('start')
      .setDescription('💰 투자 시작! 초기 자금 1,000만원을 받습니다'))
    .addSubcommand(sub => sub
      .setName('market')
      .setDescription('📊 전체 시장 현황 보기'))
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('🔍 특정 종목 상세 정보')
      .addStringOption(o => o.setName('ticker').setDescription('종목 티커 (예: NXCORP)').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('portfolio')
      .setDescription('💼 내 포트폴리오 조회')
      .addUserOption(o => o.setName('user').setDescription('조회할 유저 (기본: 본인)')))
    .addSubcommand(sub => sub
      .setName('history')
      .setDescription('📋 내 거래 내역'))
    .addSubcommand(sub => sub
      .setName('rank')
      .setDescription('🏆 투자자 랭킹'))
    .addSubcommand(sub => sub
      .setName('news')
      .setDescription('📰 최근 뉴스 보기')
      .addStringOption(o => o.setName('ticker').setDescription('특정 종목 뉴스 (선택)').setRequired(false))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── 투자 시작 ─────────────────────────────────────
    if (sub === 'start') {
      const user = ensureUser(interaction.user.id);
      const config = loadConfig();
      const { EmbedBuilder } = require('discord.js');
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x00D26A)
          .setTitle('🎉 가상 투자 시작!')
          .setDescription(`**${interaction.user.username}**님, 환영합니다!\n초기 자금 **${config.startingBalance.toLocaleString()}원**이 지급되었어요.`)
          .addFields(
            { name: '💵 현재 잔액', value: `**${user.balance.toLocaleString()}원**`, inline: true },
            { name: '📌 사용 방법', value: '`/buy [티커] [수량]` 로 매수\n`/sell [티커] [수량]` 로 매도\n`/stock market` 로 시장 현황 확인', inline: false },
          )
          .setTimestamp()
        ],
      });
    }

    // ── 시장 현황 ─────────────────────────────────────
    if (sub === 'market') {
      await interaction.deferReply();
      const market = loadMarket();
      return interaction.editReply({
        embeds: [marketOverviewEmbed(market)],
        components: [marketControlRow()],
      });
    }

    // ── 종목 정보 ─────────────────────────────────────
    if (sub === 'info') {
      await interaction.deferReply();
      const ticker = interaction.options.getString('ticker').toUpperCase();
      const asset = getAsset(ticker);
      if (!asset) {
        const { EmbedBuilder } = require('discord.js');
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription(`❌ **${ticker}** 종목을 찾을 수 없어요.`)]
        });
      }
      const relatedNews = getNewsByTicker(ticker);
      const embeds = [assetDetailEmbed(asset)];
      if (relatedNews.length > 0) {
        embeds.push(new (require('discord.js').EmbedBuilder)()
          .setColor(0x9B59B6)
          .setTitle(`📰 ${asset.name} 관련 최근 뉴스`)
          .setDescription(relatedNews.slice(0, 3).map(n =>
            `${n.isPositive ? '📈' : '📉'} **${n.title}**\n> <t:${Math.floor(new Date(n.publishedAt).getTime() / 1000)}:R>`
          ).join('\n\n'))
        );
      }
      return interaction.editReply({ embeds });
    }

    // ── 포트폴리오 ────────────────────────────────────
    if (sub === 'portfolio') {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const portfolio = getPortfolio(targetUser.id);
      return interaction.editReply({
        embeds: [portfolioEmbed(portfolio, targetUser.username)],
      });
    }

    // ── 거래 내역 ─────────────────────────────────────
    if (sub === 'history') {
      await interaction.deferReply();
      const portfolio = getPortfolio(interaction.user.id);
      return interaction.editReply({ embeds: [transactionEmbed(portfolio.transactions)] });
    }

    // ── 랭킹 ─────────────────────────────────────────
    if (sub === 'rank') {
      await interaction.deferReply();
      const rankings = getRankings(interaction.client);
      return interaction.editReply({ embeds: [rankingEmbed(rankings, interaction.client)] });
    }

    // ── 뉴스 ─────────────────────────────────────────
    if (sub === 'news') {
      const ticker = interaction.options.getString('ticker');
      if (ticker) {
        const news = getNewsByTicker(ticker);
        if (!news.length) {
          return interaction.reply({ content: `📰 **${ticker.toUpperCase()}** 관련 뉴스가 없어요.` });
        }
        return interaction.reply({ embeds: news.slice(0, 3).map(n => singleNewsEmbed(n)) });
      }
      const recent = getRecentNews(5);
      if (!recent.length) {
        return interaction.reply({ content: '📰 아직 뉴스가 없어요!' });
      }
      return interaction.reply({ embeds: [newsEmbed(recent)] });
    }
  },
};
