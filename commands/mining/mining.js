const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { mine, getInventory, sellMinerals, sellAllMinerals, buyTool, loadMiningData } = require('../../utils/miningManager');

const GRADE_COLORS = {
  SSS: 0xFF0000, SS: 0xFF6600, S: 0xFFD700,
  A: 0x9B59B6, B: 0x3498DB, C: 0x95A5A6,
};

// ── /mine ─────────────────────────────────────────────
const mineCommand = {
  data: new SlashCommandBuilder()
    .setName('mine')
    .setDescription('⛏️ 광산에서 채굴합니다 (1시간 쿨다운)'),

  async execute(interaction) {
    await interaction.deferReply();

    const result = mine(interaction.user.id);

    if (!result.success) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription(result.message)]
      });
    }

    const { grade, item, gradeData, stockDrop, tool } = result;

    const embed = new EmbedBuilder()
      .setColor(GRADE_COLORS[grade])
      .setTitle(`${gradeData.emoji} 채굴 완료! [${grade}등급]`)
      .setDescription(`**${item.name}** 을(를) 발견했어요!`)
      .addFields(
        { name: '💎 광물', value: `${gradeData.emoji} **${item.name}**`, inline: true },
        { name: '⭐ 등급', value: `**${grade}등급**`, inline: true },
        { name: '💰 기본가', value: `${item.basePrice.toLocaleString()}원`, inline: true },
        { name: '📖 설명', value: item.desc, inline: false },
        { name: '⛏️ 사용 도구', value: `${tool.emoji} ${tool.name} (보너스 ×${tool.bonus})`, inline: true },
      )
      .setFooter({ text: '💡 /junk sell 로 판매 | /inventory 로 인벤토리 확인' })
      .setTimestamp();

    if (stockDrop) {
      embed.addFields({
        name: '🎰 보너스! 주식 획득!',
        value: `${stockDrop.emoji} **${stockDrop.name}** (${stockDrop.ticker}) 1주 획득!`
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('mine_again').setLabel('⛏️ 다시 채굴').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('mine_inventory').setLabel('🎒 인벤토리').setStyle(ButtonStyle.Secondary),
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  }
};

// ── /inventory ────────────────────────────────────────
const inventoryCommand = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('🎒 광물 인벤토리를 확인합니다')
    .addUserOption(o => o.setName('user').setDescription('조회할 유저').setRequired(false)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const userData = getInventory(targetUser.id);
    const miningData = loadMiningData();

    if (Object.keys(userData.minerals).length === 0) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x95A5A6)
          .setDescription('📦 인벤토리가 비어있어요! `/mine` 으로 채굴해보세요!')
        ]
      });
    }

    // 등급별 정렬
    const gradeOrder = ['SSS', 'SS', 'S', 'A', 'B', 'C'];
    const sortedMinerals = Object.entries(userData.minerals)
      .sort((a, b) => gradeOrder.indexOf(a[1].grade) - gradeOrder.indexOf(b[1].grade));

    const lines = sortedMinerals.map(([id, mineral]) => {
      const gradeData = miningData.minerals[mineral.grade];
      return `${gradeData.emoji} **[${mineral.grade}] ${mineral.name}** × ${mineral.count}개 — ${mineral.basePrice.toLocaleString()}원/개`;
    }).join('\n');

    const totalValue = sortedMinerals.reduce((sum, [, m]) => sum + m.basePrice * m.count, 0);
    const tool = miningData.miningTools[userData.tool || 'basic'];

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle(`🎒 ${targetUser.username}의 광물 인벤토리`)
        .setDescription(lines)
        .addFields(
          { name: '💰 총 예상 가치', value: `**${totalValue.toLocaleString()}원**`, inline: true },
          { name: '⛏️ 현재 도구', value: `${tool.emoji} ${tool.name}`, inline: true },
          { name: '📊 총 채굴 횟수', value: `${userData.totalMined || 0}회`, inline: true },
        )
        .setFooter({ text: '/junk sell [광물ID] [수량] 또는 /junk sellall 로 전체 판매' })
        .setTimestamp()
      ]
    });
  }
};

// ── /junk (고물상) ────────────────────────────────────
const junkCommand = {
  data: new SlashCommandBuilder()
    .setName('junk')
    .setDescription('🏪 고물상에서 광물을 판매합니다')
    .addSubcommand(sub => sub
      .setName('sell')
      .setDescription('광물을 판매합니다')
      .addStringOption(o => o.setName('mineral_id').setDescription('광물 ID (인벤토리에서 확인)').setRequired(true))
      .addIntegerOption(o => o.setName('count').setDescription('판매 수량 (기본: 1)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub => sub
      .setName('sellall')
      .setDescription('인벤토리의 모든 광물을 판매합니다')
    )
    .addSubcommand(sub => sub
      .setName('prices')
      .setDescription('광물 시세표를 확인합니다')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const miningData = loadMiningData();

    if (sub === 'sell') {
      const mineralId = interaction.options.getString('mineral_id');
      const count = interaction.options.getInteger('count') || 1;
      const result = sellMinerals(interaction.user.id, mineralId, count);

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(result.success ? 0x2ECC71 : 0xFF4757)
          .setDescription(result.success
            ? `✅ **${result.mineralName}** ${result.count}개 판매!\n💰 **+${result.totalPrice.toLocaleString()}원** (개당 ${result.pricePerUnit.toLocaleString()}원)`
            : `❌ ${result.message}`)
        ]
      });
    }

    if (sub === 'sellall') {
      const result = sellAllMinerals(interaction.user.id);
      if (!result.success) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription(`❌ ${result.message}`)]
        });
      }

      const lines = result.soldItems.map(i => `• **${i.name}** × ${i.count}개 — ${i.price.toLocaleString()}원`).join('\n');
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle('🏪 고물상 전체 판매 완료!')
          .setDescription(lines)
          .addFields({ name: '💰 총 수익', value: `**+${result.totalPrice.toLocaleString()}원**` })
          .setTimestamp()
        ]
      });
    }

    if (sub === 'prices') {
      const gradeOrder = ['SSS', 'SS', 'S', 'A', 'B', 'C'];
      const fields = gradeOrder.map(grade => {
        const gradeData = miningData.minerals[grade];
        const items = gradeData.items.map(i => `• ${i.name}: **${i.basePrice.toLocaleString()}원**`).join('\n');
        return {
          name: `${gradeData.emoji} ${grade}등급 (확률: ${(gradeData.probability * 100).toFixed(4)}%)`,
          value: items,
        };
      });

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xF39C12)
          .setTitle('📋 고물상 광물 시세표')
          .addFields(...fields.slice(0, 5))
          .setTimestamp()
        ]
      });
    }
  }
};

// ── /tool (채굴 도구) ─────────────────────────────────
const toolCommand = {
  data: new SlashCommandBuilder()
    .setName('tool')
    .setDescription('⛏️ 채굴 도구 구매')
    .addSubcommand(sub => sub
      .setName('shop')
      .setDescription('도구 상점')
    )
    .addSubcommand(sub => sub
      .setName('buy')
      .setDescription('도구 구매')
      .addStringOption(o => o.setName('tool_id').setDescription('도구 ID').setRequired(true).addChoices(
        { name: '🔨 철 곡괭이 (50만원)', value: 'iron' },
        { name: '✨ 금 곡괭이 (200만원)', value: 'gold' },
        { name: '💎 다이아 곡괭이 (1000만원)', value: 'diamond' },
      ))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const miningData = loadMiningData();

    if (sub === 'shop') {
      const tools = Object.entries(miningData.miningTools).map(([id, tool]) => ({
        name: `${tool.emoji} ${tool.name}`,
        value: `채굴 보너스: ×${tool.bonus} | 가격: ${tool.price > 0 ? tool.price.toLocaleString() + '원' : '무료'}`,
        inline: false,
      }));

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xF39C12)
          .setTitle('⛏️ 채굴 도구 상점')
          .addFields(...tools)
          .setFooter({ text: '/tool buy [도구ID] 로 구매' })
        ]
      });
    }

    if (sub === 'buy') {
      const toolId = interaction.options.getString('tool_id');
      const result = buyTool(interaction.user.id, toolId);
      const tool = miningData.miningTools[toolId];

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(result.success ? 0x2ECC71 : 0xFF4757)
          .setDescription(result.success
            ? `✅ **${tool.emoji} ${tool.name}** 구매 완료!\n채굴 보너스: ×${tool.bonus}`
            : `❌ ${result.message}`)
        ]
      });
    }
  }
};

module.exports = { mineCommand, inventoryCommand, junkCommand, toolCommand };
