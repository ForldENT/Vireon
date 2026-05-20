const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getAllRates, loadCurrency, krwToForeign, foreignToKrw, formatPrice } = require('../../utils/currencyManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('exchange')
    .setDescription('💱 환율 정보')
    .addSubcommand(sub => sub
      .setName('rates')
      .setDescription('📊 현재 환율 현황 보기')
    )
    .addSubcommand(sub => sub
      .setName('convert')
      .setDescription('💰 금액 환전 계산')
      .addIntegerOption(o => o.setName('amount').setDescription('금액').setRequired(true))
      .addStringOption(o => o.setName('from').setDescription('변환할 통화').setRequired(true).addChoices(
        { name: '🇰🇷 KRW (원)', value: 'KRW' },
        { name: '🇺🇸 USD (달러)', value: 'USD' },
        { name: '🇯🇵 JPY (엔)', value: 'JPY' },
        { name: '🇨🇳 CNY (위안)', value: 'CNY' },
        { name: '🇪🇺 EUR (유로)', value: 'EUR' },
        { name: '🇬🇧 GBP (파운드)', value: 'GBP' },
      ))
      .addStringOption(o => o.setName('to').setDescription('목표 통화').setRequired(true).addChoices(
        { name: '🇰🇷 KRW (원)', value: 'KRW' },
        { name: '🇺🇸 USD (달러)', value: 'USD' },
        { name: '🇯🇵 JPY (엔)', value: 'JPY' },
        { name: '🇨🇳 CNY (위안)', value: 'CNY' },
        { name: '🇪🇺 EUR (유로)', value: 'EUR' },
        { name: '🇬🇧 GBP (파운드)', value: 'GBP' },
      ))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const data = loadCurrency();

    // ── 환율 현황 ─────────────────────────────────────
    if (sub === 'rates') {
      const rates = getAllRates();
      const lastUpdate = data.lastUpdate
        ? `<t:${Math.floor(new Date(data.lastUpdate).getTime() / 1000)}:R>`
        : '아직 업데이트 없음';

      const lines = Object.entries(rates).map(([code, info]) => {
        const arrow = code === 'USD' ? '━' : '';
        return `${info.emoji} **${info.name}** (${code})\n> 1 USD = **${info.rate.toLocaleString()} ${code}** ${arrow}`;
      }).join('\n\n');

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle('💱 실시간 환율 현황')
          .setDescription(`> 기준 통화: 🇺🇸 **USD (미국 달러)**\n> 마지막 업데이트: ${lastUpdate}\n\n${lines}`)
          .setFooter({ text: '💡 매일 오전 9시에 환율이 변경됩니다!' })
          .setTimestamp()
        ]
      });
    }

    // ── 환전 계산 ─────────────────────────────────────
    if (sub === 'convert') {
      const amount = interaction.options.getInteger('amount');
      const from = interaction.options.getString('from');
      const to = interaction.options.getString('to');

      // from → KRW → to 변환
      const krwAmount = from === 'KRW' ? amount : foreignToKrw(amount, from);
      const result = to === 'KRW' ? krwAmount : krwToForeign(krwAmount, to);

      const fromInfo = data.rates[from];
      const toInfo = data.rates[to];

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x3498DB)
          .setTitle('💱 환전 계산')
          .addFields(
            { name: '💵 입력', value: `${fromInfo.emoji} **${formatPrice(amount, from)}**`, inline: true },
            { name: '➡️', value: '환전', inline: true },
            { name: '💰 결과', value: `${toInfo.emoji} **${formatPrice(result, to)}**`, inline: true },
            { name: '📊 적용 환율', value: `1 USD = ${data.rates[from].rate} ${from}\n1 USD = ${data.rates[to].rate} ${to}`, inline: false },
          )
          .setTimestamp()
        ]
      });
    }
  }
};
