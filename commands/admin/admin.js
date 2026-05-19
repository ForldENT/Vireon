const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  createAsset, deleteAsset, forceSetPrice,
  loadConfig, saveConfig,
} = require('../../utils/marketManager');
const { runDailyMarketUpdate, runHourlyTasks } = require('../../scheduler/marketScheduler');
const { adminCreateEmbed, C } = require('../../utils/stockEmbeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('🔧 관리자 전용 명령어')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    // 종목 생성
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('새 주식/코인 종목을 생성합니다')
      .addStringOption(o => o.setName('ticker').setDescription('티커 (예: APPLE)').setRequired(true))
      .addStringOption(o => o.setName('name').setDescription('회사/코인 이름').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('타입').setRequired(true).addChoices(
        { name: '🇰🇷 국내주식', value: 'domestic' },
        { name: '🌍 해외주식', value: 'foreign' },
        { name: '🚀 우주주식', value: 'space' },
        { name: '🪙 코인', value: 'coin' },
      ))
      .addStringOption(o => o.setName('sector').setDescription('섹터 (예: 기술, IT, 게임)').setRequired(true))
      .addIntegerOption(o => o.setName('price').setDescription('초기 가격 (원)').setRequired(true).setMinValue(1))
      .addStringOption(o => o.setName('description').setDescription('설명').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('이모지').setRequired(false))
    )

    // 종목 삭제
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('종목을 삭제합니다')
      .addStringOption(o => o.setName('ticker').setDescription('티커').setRequired(true))
    )

    // 가격 설정
    .addSubcommand(sub => sub
      .setName('setprice')
      .setDescription('종목 가격을 강제 설정합니다')
      .addStringOption(o => o.setName('ticker').setDescription('티커').setRequired(true))
      .addIntegerOption(o => o.setName('price').setDescription('새 가격').setRequired(true).setMinValue(1))
    )

    // 수동 업데이트
    .addSubcommand(sub => sub
      .setName('update')
      .setDescription('수동으로 시장을 업데이트합니다 (뉴스 포함)')
    )

    // 채널 설정
    .addSubcommand(sub => sub
      .setName('setchannel')
      .setDescription('봇 발송 채널을 설정합니다')
      .addStringOption(o => o.setName('type').setDescription('채널 타입').setRequired(true).addChoices(
        { name: '📰 뉴스 채널', value: 'news' },
        { name: '📊 시장 현황 채널', value: 'stock' },
      ))
      .addChannelOption(o => o.setName('channel').setDescription('채널 선택').setRequired(true))
    )

    // 잔액 설정
    .addSubcommand(sub => sub
      .setName('setbalance')
      .setDescription('유저 잔액을 설정합니다')
      .addUserOption(o => o.setName('user').setDescription('대상 유저').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('설정할 금액').setRequired(true).setMinValue(0))
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(C.bear).setDescription('❌ 관리자 권한이 필요해요.')],
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    // ── 종목 생성 ─────────────────────────────────────
    if (sub === 'create') {
      const typeValue = interaction.options.getString('type');
      const isCoin = typeValue === 'coin';

      const options = {
        ticker: interaction.options.getString('ticker').toUpperCase(),
        name: interaction.options.getString('name'),
        type: isCoin ? 'coin' : 'stock',
        category: isCoin ? 'crypto' : typeValue,
        sector: interaction.options.getString('sector'),
        price: interaction.options.getInteger('price'),
        description: interaction.options.getString('description'),
        emoji: interaction.options.getString('emoji') || (isCoin ? '🪙' : '🏢'),
      };

      const result = createAsset(options);
      if (!result.success) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(C.bear).setDescription(`❌ ${result.message}`)],
          ephemeral: true,
        });
      }

      const categoryLabel = {
        domestic: '🇰🇷 국내주식',
        foreign: '🌍 해외주식',
        space: '🚀 우주주식',
        crypto: '🪙 코인',
      }[options.category] || options.category;

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.admin)
          .setTitle('🔧 신규 종목 생성 완료!')
          .addFields(
            { name: '티커', value: `\`${options.ticker}\``, inline: true },
            { name: '이름', value: options.name, inline: true },
            { name: '카테고리', value: categoryLabel, inline: true },
            { name: '섹터', value: options.sector, inline: true },
            { name: '이모지', value: options.emoji, inline: true },
            { name: '초기가', value: `${options.price.toLocaleString()}원`, inline: true },
            { name: '설명', value: options.description },
          )
          .setTimestamp()
        ],
      });
    }

    // ── 종목 삭제 ─────────────────────────────────────
    if (sub === 'delete') {
      const ticker = interaction.options.getString('ticker').toUpperCase();
      const result = deleteAsset(ticker);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(result.success ? C.bull : C.bear)
          .setDescription(result.success ? `✅ **${ticker}** 종목이 삭제되었어요.` : `❌ ${result.message}`)
        ],
        ephemeral: true,
      });
    }

    // ── 가격 설정 ─────────────────────────────────────
    if (sub === 'setprice') {
      const ticker = interaction.options.getString('ticker').toUpperCase();
      const price = interaction.options.getInteger('price');
      const result = forceSetPrice(ticker, price);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(result.success ? C.admin : C.bear)
          .setDescription(result.success
            ? `🔧 **${ticker}** 가격을 **${price.toLocaleString()}원**으로 설정했어요.`
            : `❌ ${result.message}`)
        ],
        ephemeral: true,
      });
    }

    // ── 수동 업데이트 ─────────────────────────────────
    if (sub === 'update') {
      await interaction.deferReply();
      try {
        const result = await runHourlyTasks();
        const count = result?.results?.length || 0;
        const newsCount = result?.news?.length || 0;
return interaction.editReply({
  embeds: [new EmbedBuilder()
    .setColor(C.admin)
    .setTitle('🔧 수동 시장 업데이트 완료')
    .setDescription(`📊 가격 업데이트 완료\n📰 뉴스 생성 완료`)
    .setTimestamp()
  ],
});
      } catch (e) {
        return interaction.editReply({ content: `❌ 오류: ${e.message}` });
      }
    }

    // ── 채널 설정 ─────────────────────────────────────
    if (sub === 'setchannel') {
      const type = interaction.options.getString('type');
      const channel = interaction.options.getChannel('channel');
      const config = loadConfig();
      if (type === 'news') config.newsChannelId = channel.id;
      else if (type === 'stock') config.stockChannelId = channel.id;
      saveConfig(config);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.admin)
          .setDescription(`✅ ${type === 'news' ? '📰 뉴스' : '📊 시장 현황'} 채널을 <#${channel.id}>으로 설정했어요.`)
        ],
        ephemeral: true,
      });
    }

    // ── 잔액 설정 ─────────────────────────────────────
    if (sub === 'setbalance') {
      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const { loadUsers, saveUsers, ensureUser } = require('../../utils/marketManager');
      ensureUser(targetUser.id);
      const users = loadUsers();
      users[targetUser.id].balance = amount;
      saveUsers(users);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.admin)
          .setDescription(`🔧 **${targetUser.username}**의 잔액을 **${amount.toLocaleString()}원**으로 설정했어요.`)
        ],
        ephemeral: true,
      });
    }
  },
};
