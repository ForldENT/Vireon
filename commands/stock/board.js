const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('board')
    .setDescription('📊 현황판 채널에 현황판을 게시합니다')
    .addSubcommand(sub => sub
      .setName('stock')
      .setDescription('주식현황판 채널에 현황판 게시')
    )
    .addSubcommand(sub => sub
      .setName('news')
      .setDescription('vireon-news 채널에 뉴스 게시')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { updateStockBoard, updateNewsBoard } = require('../../scheduler/marketScheduler');

    await interaction.deferReply({ ephemeral: true });

    if (sub === 'stock') {
      await updateStockBoard();
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x2ECC71)
          .setDescription('✅ **#주식현황판** 채널에 현황판을 게시했어요!')
        ]
      });
    }

    if (sub === 'news') {
      // DB에서 직접 뉴스 로드 후 캐시 갱신
      try {
        const db = require('../../utils/database');
        const { saveNews } = require('../../utils/marketManager');
        const newsFromDB = await db.getNews();
        if (newsFromDB && newsFromDB.length > 0) {
          saveNews(newsFromDB);
        }
      } catch (e) {
        console.error('뉴스 강제 로드 오류:', e.message);
      }
      await updateNewsBoard();
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x2ECC71)
          .setDescription('✅ **#vireon-news** 채널에 뉴스를 게시했어요!')
        ]
      });
    }
  }
};
