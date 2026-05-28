// ── 채널 제한 유틸리티 ────────────────────────────────
// 각 기능을 특정 채널에서만 사용 가능하게 제한

const CHANNEL_RULES = {
  // 주식/코인 관련 채널
  stock: ['주식-코인-시장', '주식코인시장', '주식-코인-시장'],
  // 광산 채널
  mining: ['광산', '광산채널', '⛏광산', '⛏️광산'],
  // 은행 채널
  bank: ['은행', '은행채널', '🏦은행'],
};

/**
 * 채널 제한 체크
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {'stock'|'mining'|'bank'} type
 * @returns {boolean} 허용 여부
 */
function checkChannel(interaction, type) {
  const channel = interaction.channel;
  if (!channel) return true; // DM은 허용
  const chName = channel.name?.toLowerCase() || '';

  const allowed = CHANNEL_RULES[type];
  const isAllowed = allowed.some(name => chName.includes(name.toLowerCase()));

  return isAllowed;
}

/**
 * 채널 제한 메시지 반환
 */
function getChannelErrorMessage(type) {
  const { EmbedBuilder } = require('discord.js');
  const messages = {
    stock: '📈 주식/코인 관련 명령어는 **#주식-코인-시장** 채널에서만 사용할 수 있어요!',
    mining: '⛏️ 채굴 관련 명령어는 **#광산** 채널에서만 사용할 수 있어요!',
    bank: '🏦 은행 관련 명령어는 **#은행** 채널에서만 사용할 수 있어요!',
  };

  return {
    embeds: [new EmbedBuilder()
      .setColor(0xFF4757)
      .setDescription(messages[type] || '이 채널에서는 사용할 수 없어요!')
    ],
    ephemeral: true,
  };
}

module.exports = { checkChannel, getChannelErrorMessage };
