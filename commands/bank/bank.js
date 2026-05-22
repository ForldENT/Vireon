const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getCreditInfo, applyLoan, repayLoan, loadBankData } = require('../../utils/bankManager');

// ── /credit ───────────────────────────────────────────
const creditCommand = {
  data: new SlashCommandBuilder()
    .setName('credit')
    .setDescription('📊 신용등급 조회')
    .addUserOption(o => o.setName('user').setDescription('조회할 유저').setRequired(false)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const info = getCreditInfo(targetUser.id);
    const bankData = loadBankData();

    const allGrades = Object.values(bankData.creditGrades).map(g => {
      const isCurrent = g.grade === info.grade;
      return `${isCurrent ? '▶️' : '　'} ${g.emoji} **${g.grade}등급 ${g.name}** — 최대 ${g.maxLoan.toLocaleString()}원, 이자 ${(g.interestRate * 100).toFixed(0)}%`;
    }).join('\n');

    const loanInfo = info.activeLoan
      ? `💳 대출 중: **${info.activeLoan.remaining.toLocaleString()}원** 남음\n📅 만기일: <t:${Math.floor(new Date(info.activeLoan.dueDate).getTime() / 1000)}:D>`
      : '✅ 현재 대출 없음';

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(info.gradeInfo.color)
        .setTitle(`${info.gradeInfo.emoji} ${targetUser.username}의 신용 정보`)
        .addFields(
          { name: '📊 신용등급', value: `**${info.grade}등급 (${info.gradeInfo.name})**`, inline: true },
          { name: '🔢 신용점수', value: `**${info.score}점**`, inline: true },
          { name: '💰 최대 대출', value: `**${info.gradeInfo.maxLoan.toLocaleString()}원**`, inline: true },
          { name: '📈 이자율', value: `**${(info.gradeInfo.interestRate * 100).toFixed(0)}%**`, inline: true },
          { name: '✅ 정시 상환', value: `**${info.onTimeCount}회**`, inline: true },
          { name: '❌ 연체/부도', value: `**${info.defaultCount}회**`, inline: true },
          { name: '💳 대출 현황', value: loanInfo, inline: false },
          { name: '📋 전체 등급표', value: allGrades, inline: false },
        )
        .setFooter({ text: '💡 대출은 /bank loan | 상환은 /bank repay' })
        .setTimestamp()
      ]
    });
  }
};

// ── /bank ─────────────────────────────────────────────
const bankCommand = {
  data: new SlashCommandBuilder()
    .setName('bank')
    .setDescription('🏦 은행 서비스')
    .addSubcommand(sub => sub
      .setName('loan')
      .setDescription('대출 신청')
      .addIntegerOption(o => o.setName('amount').setDescription('대출 금액').setRequired(true).setMinValue(100000))
    )
    .addSubcommand(sub => sub
      .setName('repay')
      .setDescription('대출 상환')
      .addIntegerOption(o => o.setName('amount').setDescription('상환 금액 (0 = 전액 상환)').setRequired(true).setMinValue(0))
    )
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('은행 정보 및 내 대출 현황')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'loan') {
      const amount = interaction.options.getInteger('amount');
      const result = applyLoan(interaction.user.id, amount);

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(result.success ? 0x2ECC71 : 0xFF4757)
          .setTitle(result.success ? '🏦 대출 승인!' : '🏦 대출 거절')
          .setDescription(result.success ? result.message : `❌ ${result.message}`)
          .setTimestamp()
        ],
        ephemeral: !result.success,
      });
    }

    if (sub === 'repay') {
      let amount = interaction.options.getInteger('amount');
      const info = getCreditInfo(interaction.user.id);

      if (!info.activeLoan) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription('❌ 상환할 대출이 없어요!')],
          ephemeral: true,
        });
      }

      if (amount === 0) amount = info.activeLoan.remaining;

      const result = repayLoan(interaction.user.id, amount);

      if (!result.success) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription(`❌ ${result.message}`)],
          ephemeral: true,
        });
      }

      const embed = new EmbedBuilder()
        .setColor(result.isFullyRepaid ? 0x2ECC71 : 0x3498DB)
        .setTitle(result.isFullyRepaid ? '✅ 대출 완전 상환!' : '💳 일부 상환 완료')
        .addFields(
          { name: '💰 상환 금액', value: `**${result.repaid.toLocaleString()}원**`, inline: true },
          { name: '📊 남은 금액', value: `**${result.remaining.toLocaleString()}원**`, inline: true },
          { name: '⏰ 상환 시기', value: result.isOnTime ? '✅ 정시 상환' : '⚠️ 연체 상환', inline: true },
        )
        .setTimestamp();

      if (result.isFullyRepaid) {
        embed.setDescription(`🎉 대출을 모두 갚았어요!\n신용점수: **${result.newScore}점** (${result.newGrade}등급)`);
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'info') {
      const info = getCreditInfo(interaction.user.id);
      const { loadUsers } = require('../../utils/marketManager');
      const users = loadUsers();
      const balance = users[interaction.user.id]?.balance || 0;

      const loanDetails = info.activeLoan
        ? [
            { name: '💳 대출 원금', value: `${info.activeLoan.amount.toLocaleString()}원`, inline: true },
            { name: '💸 이자', value: `${info.activeLoan.interest.toLocaleString()}원`, inline: true },
            { name: '💰 남은 상환액', value: `**${info.activeLoan.remaining.toLocaleString()}원**`, inline: true },
            { name: '📅 만기일', value: `<t:${Math.floor(new Date(info.activeLoan.dueDate).getTime() / 1000)}:D>`, inline: true },
          ]
        : [{ name: '💳 대출 현황', value: '✅ 현재 대출 없음', inline: false }];

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(info.gradeInfo.color)
          .setTitle('🏦 내 은행 정보')
          .addFields(
            { name: '💵 현재 잔액', value: `**${balance.toLocaleString()}원**`, inline: true },
            { name: '📊 신용등급', value: `${info.gradeInfo.emoji} **${info.grade}등급 (${info.gradeInfo.name})**`, inline: true },
            { name: '💰 대출 가능액', value: `**${info.gradeInfo.maxLoan.toLocaleString()}원**`, inline: true },
            ...loanDetails,
          )
          .setTimestamp()
        ]
      });
    }
  }
};


// ── /bankruptcy ───────────────────────────────────────
const bankruptcyCommand = {
  data: new SlashCommandBuilder()
    .setName('bankruptcy')
    .setDescription('💸 파산 신청 — 자산 초기화 후 재시작 (신용등급 1단계 하락)'),

  async execute(interaction) {
    const { getCreditInfo } = require('../../utils/bankManager');
    const info = getCreditInfo(interaction.user.id);

    // 확인 버튼
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('bankruptcy_confirm')
        .setLabel('⚠️ 파산 신청 확정')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('bankruptcy_cancel')
        .setLabel('❌ 취소')
        .setStyle(ButtonStyle.Secondary),
    );

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xFF4757)
        .setTitle('💸 파산 신청')
        .setDescription('정말로 파산 신청을 하시겠어요?\n\n아래 내용을 확인하세요:')
        .addFields(
          { name: '✅ 유지되는 것', value: '⛏️ 광물 인벤토리\n📊 신용 기록', inline: true },
          { name: '❌ 초기화되는 것', value: '💰 잔액 → **5,000만원**\n📈 보유 주식/코인 전부\n💳 진행 중인 대출', inline: true },
          { name: '📉 페널티', value: `현재 신용등급 **${info.grade}등급** → **${Math.min(info.grade + 1, 7)}등급**`, inline: false },
        )
        .setFooter({ text: '⚠️ 이 작업은 되돌릴 수 없습니다!' })
      ],
      components: [row],
    });
  }
};

module.exports = { creditCommand, bankCommand, bankruptcyCommand };

