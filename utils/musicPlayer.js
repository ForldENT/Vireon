const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Player, QueryType } = require('discord-player');
const { YoutubeiExtractor } = require('discord-player-youtubei');

let playerInstance = null;

// ── Player 초기화 ─────────────────────────────────────
async function initPlayer(client) {
  if (playerInstance) return playerInstance;

  playerInstance = new Player(client, {
    ytdlOptions: {
      quality: 'highestaudio',
      highWaterMark: 1 << 25,
    },
  });

  // YoutubeiExtractor 등록 (봇 차단 우회)
  await playerInstance.extractors.register(YoutubeiExtractor, {});
  await playerInstance.extractors.loadDefault((ext) => ext !== 'YouTubeExtractor');

  // 이벤트 핸들러
  playerInstance.events.on('playerStart', (queue, track) => {
    const channel = queue.metadata?.textChannel;
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle('🎵 지금 재생 중')
      .setDescription(`**[${track.title}](${track.url})**`)
      .addFields(
        { name: '⏱️ 길이', value: track.duration || '알 수 없음', inline: true },
        { name: '👤 요청자', value: track.requestedBy ? `<@${track.requestedBy.id}>` : '알 수 없음', inline: true },
        { name: '📋 대기열', value: `${queue.tracks.size}곡 남음`, inline: true }
      )
      .setTimestamp();

    if (track.thumbnail) embed.setThumbnail(track.thumbnail);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music_skip').setLabel('⏭️ 스킵').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_stop').setLabel('⏹️ 정지').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('music_queue').setLabel('📋 대기열').setStyle(ButtonStyle.Primary),
    );

    channel.send({ embeds: [embed], components: [row] }).catch(() => {});
  });

  playerInstance.events.on('emptyQueue', (queue) => {
    const channel = queue.metadata?.textChannel;
    if (channel) {
      channel.send({
        embeds: [new EmbedBuilder().setColor(0x5865F2).setDescription('⏹️ 대기열의 모든 곡을 재생했어요!')]
      }).catch(() => {});
    }
  });

  playerInstance.events.on('playerError', (queue, error) => {
    console.error('플레이어 오류:', error.message);
    const channel = queue.metadata?.textChannel;
    if (channel) {
      channel.send({
        embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription(`❌ 재생 오류: ${error.message}`)]
      }).catch(() => {});
    }
  });

  playerInstance.events.on('error', (queue, error) => {
    console.error('대기열 오류:', error.message);
  });

  console.log('✅ discord-player 초기화 완료');
  return playerInstance;
}

function getPlayerInstance() {
  return playerInstance;
}

// ── 음악 재생 / 대기열 추가 ───────────────────────────
async function playMusic(interaction, query) {
  const voiceChannel = interaction.member.voice?.channel;
  if (!voiceChannel) throw new Error('음성 채널에 먼저 입장해주세요! 🎙️');

  const player = getPlayerInstance();
  if (!player) throw new Error('플레이어가 초기화되지 않았어요.');

  const queue = player.nodes.create(interaction.guild, {
    metadata: { textChannel: interaction.channel },
    selfDeaf: true,
    volume: 80,
    leaveOnEmpty: true,
    leaveOnEmptyCooldown: 10000,
    leaveOnEnd: true,
    leaveOnEndCooldown: 10000,
  });

  // 음성 채널 연결
  if (!queue.connection) {
    await queue.connect(voiceChannel);
  }

  // 트랙 검색
  const result = await player.search(query, {
    requestedBy: interaction.user,
    searchEngine: QueryType.AUTO,
  });

  if (!result.hasTracks()) throw new Error('검색 결과가 없어요. 다른 검색어를 시도해보세요.');

  // 플레이리스트인 경우
  if (result.playlist) {
    queue.addTrack(result.tracks);
    if (!queue.isPlaying()) await queue.node.play();
    return { isPlaylist: true, count: result.tracks.length, title: result.playlist.title };
  }

  // 단일 트랙
  const track = result.tracks[0];
  queue.addTrack(track);
  if (!queue.isPlaying()) await queue.node.play();

  return {
    isPlaylist: false,
    track: {
      title: track.title,
      url: track.url,
      duration: track.duration,
      thumbnail: track.thumbnail,
    },
    isPlaying: queue.tracks.size > 1,
    queueSize: queue.tracks.size,
  };
}

// ── 스킵 ──────────────────────────────────────────────
function skipMusic(guildId) {
  const player = getPlayerInstance();
  const queue = player?.nodes.get(guildId);
  if (!queue || !queue.isPlaying()) return false;
  queue.node.skip();
  return true;
}

// ── 정지 ──────────────────────────────────────────────
function stopMusic(guildId) {
  const player = getPlayerInstance();
  const queue = player?.nodes.get(guildId);
  if (!queue) return false;
  queue.delete();
  return true;
}

// ── 현재 상태 조회 ────────────────────────────────────
function getMusicState(guildId) {
  const player = getPlayerInstance();
  const queue = player?.nodes.get(guildId);
  if (!queue) return null;

  return {
    isPlaying: queue.isPlaying(),
    currentTrack: queue.currentTrack,
    tracks: queue.tracks.toArray(),
  };
}

module.exports = {
  initPlayer,
  getPlayerInstance,
  playMusic,
  skipMusic,
  stopMusic,
  getMusicState,
};
