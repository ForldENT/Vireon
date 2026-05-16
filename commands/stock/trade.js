const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { buyAsset, sellAsset, getAsset, getPortfolio, ensureUser } = require('../../utils/marketManager');
const { C, formatPrice } = require('../../utils/stockEmbeds');

// ── /buy 커맨드 ───────────────────────────────────────
const buyCommand = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('🟦 종목 매수')
    .addStringOption(o => o.setName('ticker').setDescription('종목 티커 (예: NXCORP, NXCOIN)').setRequired(true))
    .addIntegerOption(o => o.setName('qty').setDescription('매수 수량').setRequired(true).setMinValue(1))
    .addBooleanOption(o => o.setName('confirm').setDescription('확인 없이 바로 매수').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const ticker = interaction.options.getString('ticker').toUpperCase();
    const qty = interaction.options.getInteger('qty');
    const skipConfirm = interaction.options.getBoolean('confirm') || false;

    const asset = getAsset(ticker);
    if (!asset) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(C.bear).setDescription(`❌ **${ticker}** 종목을 찾을 수 없어요.`)]
      });
    }

    const user = ensureUser(interaction.user.id);
    const totalCost = asset.price * qty;

    // 잔액 부족 선체크
    if (user.balance < totalCost) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.bear)
          .setTitle('❌ 잔액 부족')
          .addFields(
            { name: '필요 금액', value: `**${totalCost.toLocaleString()}원**`, inline: true },
            { name: '현재 잔액', value: `**${user.balance.toLocaleString()}원**`, inline: true },
            { name: '부족금액', value: `**${(totalCost - user.balance).toLocaleString()}원**`, inline: true },
          )
        ]
      });
    }

    // 확인 없이 바로 매수
    if (skipConfirm) {
      const result = buyAsset(interaction.user.id, ticker, qty);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(result.success ? C.bull : C.bear)
          .setDescription(result.message)
        ]
      });
    }

    // 확인 메시지
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`buy_confirm_${ticker}_${qty}`).setLabel(`✅ ${qty.toLocaleString()}주 매수 확정`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('buy_cancel').setLabel('❌ 취소').setStyle(ButtonStyle.Danger),
    );

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(C.stock)
        .setTitle(`🟦 매수 확인`)
        .setDescription(`**${asset.emoji} ${asset.name} (${ticker})**`)
        .addFields(
          { name: '💰 현재가', value: formatPrice(asset.price), inline: true },
          { name: '📦 수량', value: `${qty.toLocaleString()}주`, inline: true },
          { name: '💵 총 비용', value: `**${totalCost.toLocaleString()}원**`, inline: true },
          { name: '🏦 매수 후 잔액', value: `${(user.balance - totalCost).toLocaleString()}원`, inline: true },
        )
      ],
      components: [confirmRow],
    });
  }
};

// ── /sell 커맨드 ──────────────────────────────────────
const sellCommand = {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('🟧 종목 매도')
    .addStringOption(o => o.setName('ticker').setDescription('종목 티커 (예: NXCORP)').setRequired(true))
    .addIntegerOption(o => o.setName('qty').setDescription('매도 수량 (0 = 전량 매도)').setRequired(true).setMinValue(0))
    .addBooleanOption(o => o.setName('confirm').setDescription('확인 없이 바로 매도').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const ticker = interaction.options.getString('ticker').toUpperCase();
    let qty = interaction.options.getInteger('qty');
    const skipConfirm = interaction.options.getBoolean('confirm') || false;

    const asset = getAsset(ticker);
    if (!asset) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(C.bear).setDescription(`❌ **${ticker}** 종목을 찾을 수 없어요.`)]
      });
    }

    const portfolio = getPortfolio(interaction.user.id);
    const pos = portfolio.positions.find(p => p.ticker === ticker);

    if (!pos || pos.qty === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(C.bear).setDescription(`❌ **${ticker}** 보유 수량이 없어요.`)]
      });
    }

    // 전량 매도
    if (qty === 0) qty = pos.qty;

    if (qty > pos.qty) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.bear)
          .setDescription(`❌ 매도 수량 초과! 보유: **${pos.qty}주** / 요청: **${qty}주**`)
        ]
      });
    }

    const totalGain = asset.price * qty;
    const costBasis = pos.avgPrice * qty;
    const pnl = totalGain - costBasis;
    const pnlPct = ((pnl / costBasis) * 100).toFixed(2);
    const pnlEmoji = pnl >= 0 ? '📈' : '📉';

    if (skipConfirm) {
      const result = sellAsset(interaction.user.id, ticker, qty);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(result.success ? (pnl >= 0 ? C.bull : C.bear) : C.bear)
          .setDescription(result.message)
        ]
      });
    }

    // 확인 메시지
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sell_confirm_${ticker}_${qty}`).setLabel(`✅ ${qty.toLocaleString()}주 매도 확정`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('sell_cancel').setLabel('❌ 취소').setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(pnl >= 0 ? C.bull : C.bear)
        .setTitle('🟧 매도 확인')
        .setDescription(`**${asset.emoji} ${asset.name} (${ticker})**`)
        .addFields(
          { name: '💰 현재가', value: formatPrice(asset.price), inline: true },
          { name: '📦 수량', value: `${qty.toLocaleString()}주`, inline: true },
          { name: '💵 매도금액', value: `**${totalGain.toLocaleString()}원**`, inline: true },
          { name: '📊 평균단가', value: formatPrice(pos.avgPrice), inline: true },
          { name: `${pnlEmoji} 예상 손익`, value: `**${pnl >= 0 ? '+' : ''}${pnl.toLocaleString()}원** (${pnl >= 0 ? '+' : ''}${pnlPct}%)`, inline: true },
          { name: '─', value: '─', inline: true },
        )
      ],
      components: [confirmRow],
    });
  }
};

module.exports = { buyCommand, sellCommand };
