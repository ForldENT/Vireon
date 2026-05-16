const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  createAsset, deleteAsset, forceSetPrice,
  loadConfig, saveConfig, applyDailyUpdate,
} = require('../../utils/marketManager');
const { generateDailyNews } = require('../../utils/newsGenerator');
const { runDailyMarketUpdate } = require('../../scheduler/marketScheduler');
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
      .addStringOption(o => o.setName('ticker').setDescription('티커 (예: APPLE, MYTOKEN)').setRequired(true))
      .addStringOption(o => o.setName('name').setDescription('회사/코인 이름').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('타입').setRequired(true).addChoices(
        { name: '🏢 주식 (Stock)', value: 'stock' },
        { name: '🪙 코인 (Coin)', value: 'coin' },
      ))
      .addStringOption(o => o.setName('sector').setDescription('섹터 (예: 기술, IT, 게임, DeFi)').setRequired(true))
      .addIntegerOption(o => o.setName('price').setDescription('초기 가격 (원)').setRequired(true).setMinValue(1))
      .addStringOption(o => o.setName('description').setDescription('회사/코인 설명').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('이모지 (기본: 🏢/🪙)').setRequired(false))
    )

    // 종목 삭제
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('종목을 삭제합니다')
      .addStringOption(o => o.setName('ticker').setDescription('티커').setRequired(true))
    )

    // 강제 가격 설정
    .addSubcommand(sub => sub
      .setName('setprice')
      .setDescription('종목 가격을 강제 설정합니다')
      .addStringOption(o => o.setName('ticker').setDescription('티커').setRequired(true))
      .addIntegerOption(o => o.setName('price').setDescription('새 가격 (원)').setRequired(true).setMinValue(1))
    )

    // 수동 시장 업데이트
    .addSubcommand(sub => sub
      .setName('update')
      .setDescription('수동으로 시장 가격을 업데이트합니다 (뉴스 포함)')
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

    // 시드머니 조정
    .addSubcommand(sub => sub
      .setName('setbalance')
      .setDescription('특정 유저의 잔액을 설정합니다')
      .addUserOption(o => o.setName('user').setDescription('대상 유저').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('설정할 금액').setRequired(true).setMinValue(0))
    ),

  async execute(interaction) {
    // 관리자 권한 확인
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(C.bear).setDescription('❌ 관리자 권한이 필요해요.')],
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    // ── 종목 생성 ─────────────────────────────────────
    if (sub === 'create') {
      const options = {
        ticker: interaction.options.getString('ticker').toUpperCase(),
        name: interaction.options.getString('name'),
        type: interaction.options.getString('type'),
        sector: interaction.options.getString('sector'),
        price: interaction.options.getInteger('price'),
        description: interaction.options.getString('description'),
        emoji: interaction.options.getString('emoji') || null,
      };

      const result = createAsset(options);
      if (!result.success) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(C.bear).setDescription(`❌ ${result.message}`)],
          ephemeral: true,
        });
      }

      return interaction.reply({
        embeds: [adminCreateEmbed(options)
          .setDescription(`✅ 종목이 성공적으로 생성되었습니다!\n\n> 투자자들이 \`/stock info ${options.ticker}\`로 확인할 수 있습니다.`)
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

    // ── 강제 가격 설정 ────────────────────────────────
    if (sub === 'setprice') {
      const ticker = interaction.options.getString('ticker').toUpperCase();
      const price = interaction.options.getInteger('price');
      const result = forceSetPrice(ticker, price);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(result.success ? C.admin : C.bear)
          .setDescription(result.success
            ? `🔧 **${ticker}** 가격을 **${price.toLocaleString()}원**으로 강제 설정했어요.`
            : `❌ ${result.message}`)
        ],
        ephemeral: true,
      });
    }

    // ── 수동 시장 업데이트 ────────────────────────────
    if (sub === 'update') {
      await interaction.deferReply();
      try {
        const result = await runDailyMarketUpdate();
        const count = result?.results?.length || 0;
        const newsCount = result?.news?.length || 0;
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.admin)
            .setTitle('🔧 수동 시장 업데이트 완료')
            .setDescription(`📊 **${count}**개 종목 가격 업데이트\n📰 **${newsCount}**건의 뉴스 생성`)
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
