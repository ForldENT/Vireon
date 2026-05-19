const {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const playdl = require('play-dl');

// 서버별 플레이어 상태
const players = new Map();

function createGuildPlayer() {
  return {
    connection: null,
    audioPlayer: createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    }),
    queue: [],
    currentTrack: null,
    textChannel: null,
    isPlaying: false,
    controlMessage: null,
  };
}

function getPlayer(guildId) {
  if (!players.has(guildId)) {
    players.set(guildId, createGuildPlayer());
    setupPlayerEvents(guildId);
  }
  return players.get(guildId);
}

function setupPlayerEvents(guildId) {
  const guildPlayer = players.get(guildId);
  const { audioPlayer } = guildPlayer;

  audioPlayer.on(AudioPlayerStatus.Idle, () => {
    const player = players.get(guildId);
    if (!player) return;
    player.currentTrack = null;
    player.isPlaying = false;

    if (player.queue.length > 0) {
      playNextTrack(guildId);
    } else {
      if (player.textChannel) {
        const { EmbedBuilder } = require('discord.js');
        player.textChannel.send({
          embeds: [new EmbedBuilder()
            .setColor(0x5865F2)
            .setDescription('⏹️ 대기열의 모든 곡을 재생했어요!')
          ]
        });
      }
      if (player.controlMessage) {
        player.controlMessage.delete().catch(() => {});
        player.controlMessage = null;
      }
    }
  });

  audioPlayer.on('error', (error) => {
    console.error('오디오 오류:', error);
    const player = players.get(guildId);
    if (player?.queue.length > 0) {
      setTimeout(() => playNextTrack(guildId), 1000);
    }
  });
}

async function connectToVoiceChannel(voiceChannel, guildId) {
  const player = getPlayer(guildId);

  if (player.connection && player.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    return player.connection;
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    connection.subscribe(player.audioPlayer);
    player.connection = connection;

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        destroyMusicPlayer(guildId);
      }
    });

    return connection;
  } catch (error) {
    connection.destroy();
    throw new Error('음성 채널에 연결할 수 없어요.');
  }
}

async function getTrackInfo(query) {
  try {
    let url = query;

    if (!query.startsWith('http')) {
      const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 });
      if (results.length === 0) throw new Error('검색 결과가 없어요.');
      url = results[0].url;
    }

    const urlType = playdl.yt_validate(url);
    if (!urlType || urlType === 'search') throw new Error('올바른 YouTube URL이 아니에요.');

    const info = await playdl.video_info(url);
    const video = info.video_details;

    const duration = video.durationInSec
      ? `${Math.floor(video.durationInSec / 60)}:${String(video.durationInSec % 60).padStart(2, '0')}`
      : '알 수 없음';

    return {
      title: video.title || '제목 없음',
      url: video.url,
      duration,
      thumbnail: video.thumbnails?.[0]?.url || null,
      durationInSec: video.durationInSec || 0,
    };
  } catch (error) {
    throw new Error(`트랙 정보를 가져올 수 없어요: ${error.message}`);
  }
}

async function playNextTrack(guildId) {
  const player = players.get(guildId);
  if (!player || player.queue.length === 0) return;

  const track = player.queue.shift();
  player.currentTrack = track;
  player.isPlaying = true;

  try {
    const stream = await playdl.stream(track.url, { quality: 2 });
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    player.audioPlayer.play(resource);

    if (player.textChannel) {
      if (player.controlMessage) {
        await player.controlMessage.delete().catch(() => {});
      }

      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle('🎵 지금 재생 중')
        .setDescription(`**[${track.title}](${track.url})**`)
        .addFields(
          { name: '⏱️ 길이', value: track.duration || '알 수 없음', inline: true },
          { name: '👤 요청자', value: `<@${track.requestedBy}>`, inline: true },
          { name: '📋 대기열', value: `${player.queue.length}곡 남음`, inline: true }
        )
        .setTimestamp();

      if (track.thumbnail) embed.setThumbnail(track.thumbnail);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_skip').setLabel('⏭️ 스킵').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_stop').setLabel('⏹️ 정지').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('music_queue').setLabel('📋 대기열').setStyle(ButtonStyle.Primary),
      );

      const msg = await player.textChannel.send({ embeds: [embed], components: [row] });
      player.controlMessage = msg;
    }
  } catch (error) {
    console.error('재생 오류:', error);
    player.isPlaying = false;
    player.currentTrack = null;
    if (player.queue.length > 0) setTimeout(() => playNextTrack(guildId), 1000);
  }
}

async function addToQueue(guildId, track, voiceChannel, textChannel) {
  const player = getPlayer(guildId);
  player.textChannel = textChannel;
  await connectToVoiceChannel(voiceChannel, guildId);
  player.queue.push(track);

  if (!player.isPlaying) {
    await playNextTrack(guildId);
    return 0;
  }
  return player.queue.length;
}

function skipTrack(guildId) {
  const player = players.get(guildId);
  if (!player || !player.isPlaying) return false;
  player.audioPlayer.stop();
  return true;
}

function stopAndLeave(guildId) {
  const player = players.get(guildId);
  if (!player) return false;

  player.queue = [];
  player.currentTrack = null;
  player.isPlaying = false;
  player.audioPlayer.stop();

  if (player.controlMessage) {
    player.controlMessage.delete().catch(() => {});
    player.controlMessage = null;
  }
  if (player.connection) {
    player.connection.destroy();
    player.connection = null;
  }

  players.delete(guildId);
  return true;
}

function destroyMusicPlayer(guildId) {
  const player = players.get(guildId);
  if (!player) return;
  try { if (player.connection) player.connection.destroy(); } catch {}
  players.delete(guildId);
}

function getMusicPlayerState(guildId) {
  return players.get(guildId) || null;
}

module.exports = {
  getPlayer,
  getTrackInfo,
  addToQueue,
  playNextTrack,
  skipTrack,
  stopAndLeave,
  getMusicPlayerState,
};
