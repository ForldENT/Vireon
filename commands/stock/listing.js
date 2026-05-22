const { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { createAsset, loadUsers, saveUsers, ensureUser, getAsset } = require('../../utils/marketManager');

const LISTING_COST = 2000000; // 200만원
const MIN_PRICE = 100; // 최소 단가 100원

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listing')
    .setDescription('📋 주식 상장 신청 (200만원)')
    .addSubcommand(sub => sub
      .setName('apply')
      .setDescription('새 주식을 상장합니다 (수수료: 200만원)')
      .addStringOption(o => o.setName('ticker').setDescription('티커 (영문 대문자 4~6자, 예: APPLE)').setRequired(true))
      .addStringOption(o => o.setName('name').setDescription('회사 이름').setRequired(true))
      .addIntegerOption(o => o.setName('price').setDescription('초기 주가 (최소 100원)').setRequired(true).setMinValue(MIN_PRICE))
      .addStringOption(o => o.setName('sector').setDescription('섹터 (예: 기술, 게임, 식품)').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('회사 설명').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('이모지 (선택)').setRequired(false))
      .addStringOption(o => o.setName('category').setDescription('카테고리').setRequired(false).addChoices(
        { name: '🇰🇷 국내주식', value: 'domestic' },
        { name: '🌍 해외주식 (미국)', value: 'us' },
        { name: '🚀 우주주식', value: 'space' },
      ))
    )
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('상장 신청 안내')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── 안내 ──────────────────────────────────────────
    if (sub === 'info') {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📋 주식 상장 신청 안내')
          .setDescription('누구나 200만원을 내고 주식을 상장할 수 있어요!')
          .addFields(
            { name: '💰 상장 수수료', value: '**2,000,000원**', inline: true },
            { name: '📉 최소 주가', value: '**100원**', inline: true },
            { name: '🏷️ 티커 규칙', value: '영문 대문자 4~6자', inline: true },
            { name: '📋 신청 방법', value: '`/listing apply` 명령어 사용', inline: false },
            { name: '⚠️ 주의사항', value: '• 상장 후 다른 유저들이 매수/매도 가능\n• 가격은 자동으로 변동됨\n• 상장 취소 불가', inline: false },
          )
          .setTimestamp()
        ]
      });
    }

    // ── 상장 신청 ─────────────────────────────────────
    if (sub === 'apply') {
      await interaction.deferReply();

      const ticker = interaction.options.getString('ticker').toUpperCase();
      const name = interaction.options.getString('name');
      const price = interaction.options.getInteger('price');
      const sector = interaction.options.getString('sector');
      const description = interaction.options.getString('description');
      const emoji = interaction.options.getString('emoji') || '🏢';
      const category = interaction.options.getString('category') || 'domestic';

      // 티커 규칙 체크
      if (!/^[A-Z]{4,6}$/.test(ticker)) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4757)
            .setDescription('❌ 티커는 영문 대문자 4~6자여야 해요! (예: APPLE, KAKAO)')
          ]
        });
      }

      // 중복 티커 체크
      const existing = getAsset(ticker);
      if (existing) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4757)
            .setDescription(`❌ **${ticker}** 티커가 이미 존재해요!`)
          ]
        });
      }

      // 잔액 체크
      ensureUser(interaction.user.id);
      const users = loadUsers();
      const user = users[interaction.user.id];
      if (user.balance < LISTING_COST) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4757)
            .setTitle('❌ 잔액 부족')
            .setDescription(`상장 수수료가 부족해요!\n필요: **${LISTING_COST.toLocaleString()}원** / 보유: **${user.balance.toLocaleString()}원**`)
          ]
        });
      }

      // 수수료 차감
      users[interaction.user.id].balance -= LISTING_COST;
      saveUsers(users);

      // 주식 생성
      const result = createAsset({
        ticker,
        name,
        type: 'stock',
        sector,
        emoji,
        price,
        description,
        category,
      });

      if (!result.success) {
        // 실패 시 환불
        users[interaction.user.id].balance += LISTING_COST;
        saveUsers(users);
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription(`❌ ${result.message}`)]
        });
      }

      const categoryLabel = {
        domestic: '🇰🇷 국내주식',
        us: '🇺🇸 미국주식',
        space: '🚀 우주주식',
      }[category];

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x00D26A)
          .setTitle('🎉 주식 상장 완료!')
          .setDescription(`**${emoji} ${name} (${ticker})** 이(가) 상장되었습니다!`)
          .addFields(
            { name: '💰 공모가', value: `**${price.toLocaleString()}원**`, inline: true },
            { name: '🏷️ 섹터', value: sector, inline: true },
            { name: '📂 카테고리', value: categoryLabel, inline: true },
            { name: '📋 설명', value: description, inline: false },
            { name: '💸 차감된 수수료', value: `${LISTING_COST.toLocaleString()}원`, inline: true },
            { name: '🏦 남은 잔액', value: `${(user.balance - LISTING_COST).toLocaleString()}원`, inline: true },
          )
          .setFooter({ text: `상장자: ${interaction.user.username}` })
          .setTimestamp()
        ]
      });
    }
  }
};
