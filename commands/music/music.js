const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { playMusic, skipMusic, stopMusic, getMusicState } = require('../../utils/musicPlayer');
const { createPlaylist, addTrackToPlaylist, removeTrackFromPlaylist, getPlaylist, getUserPlaylists, deletePlaylist } = require('../../utils/playlistManager');

// ── /play ─────────────────────────────────────────────
const playCommand = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('🎵 유튜브 음악을 재생합니다')
    .addStringOption(o => o.setName('query').setDescription('YouTube URL 또는 검색어').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();

    if (!interaction.member.voice?.channel) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription('❌ 음성 채널에 먼저 입장해주세요! 🎙️')]
      });
    }

    const query = interaction.options.getString('query');

    try {
      const result = await playMusic(interaction, query);

      if (result.isPlaylist) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('📋 플레이리스트 추가')
            .setDescription(`**${result.title}**\n${result.count}곡을 대기열에 추가했어요!`)
            .setTimestamp()
          ]
        });
      }

      if (result.isPlaying) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('✅ 대기열에 추가됨')
            .setDescription(`**[${result.track.title}](${result.track.url})**`)
            .addFields(
              { name: '⏱️ 길이', value: result.track.duration || '알 수 없음', inline: true },
              { name: '📌 대기열 위치', value: `#${result.queueSize}`, inline: true },
            )
            .setThumbnail(result.track.thumbnail || null)
            .setTimestamp()
          ]
        });
      }

      // 바로 재생
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_skip').setLabel('⏭️ 스킵').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_stop').setLabel('⏹️ 정지').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('music_queue').setLabel('📋 대기열').setStyle(ButtonStyle.Primary),
      );

      const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle('🎵 지금 재생 중')
        .setDescription(`**[${result.track.title}](${result.track.url})**`)
        .addFields(
          { name: '⏱️ 길이', value: result.track.duration || '알 수 없음', inline: true },
          { name: '👤 요청자', value: `<@${interaction.user.id}>`, inline: true },
        )
        .setTimestamp();

      if (result.track.thumbnail) embed.setThumbnail(result.track.thumbnail);

      return interaction.editReply({ embeds: [embed], components: [row] });

    } catch (error) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription(`❌ ${error.message}`)]
      });
    }
  }
};

// ── /skip ─────────────────────────────────────────────
const skipCommand = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('⏭️ 현재 곡을 건너뜁니다'),

  async execute(interaction) {
    if (!interaction.member.voice?.channel) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription('❌ 음성 채널에 입장해주세요!')], ephemeral: true });
    }
    const state = getMusicState(interaction.guildId);
    if (!state?.isPlaying) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription('❌ 재생 중인 곡이 없어요!')], ephemeral: true });
    }
    const title = state.currentTrack?.title || '알 수 없는 곡';
    skipMusic(interaction.guildId);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`⏭️ **${title}** 을 건너뛰었어요!`)]
    });
  }
};

// ── /stop ─────────────────────────────────────────────
const stopCommand = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('⏹️ 재생을 중지하고 채널에서 나갑니다'),

  async execute(interaction) {
    if (!interaction.member.voice?.channel) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription('❌ 음성 채널에 입장해주세요!')], ephemeral: true });
    }
    const state = getMusicState(interaction.guildId);
    if (!state?.isPlaying) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription('❌ 재생 중인 곡이 없어요!')], ephemeral: true });
    }
    stopMusic(interaction.guildId);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5865F2).setDescription('⏹️ 재생을 중지하고 채널에서 나갔어요!')]
    });
  }
};

// ── /queue ────────────────────────────────────────────
const queueCommand = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('📋 현재 재생 대기열을 확인합니다'),

  async execute(interaction) {
    const state = getMusicState(interaction.guildId);
    if (!state?.currentTrack) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription('❌ 재생 중인 곡이 없어요!')], ephemeral: true });
    }

    const trackList = state.tracks.slice(0, 10)
      .map((t, i) => `\`${i + 1}.\` **${t.title}** (${t.duration})`)
      .join('\n') || '대기열이 비어있어요';

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📋 재생 대기열')
        .addFields(
          { name: '🎵 현재 재생', value: `**${state.currentTrack.title}**` },
          { name: `📃 대기열 (${state.tracks.length}곡)`, value: trackList }
        )
        .setTimestamp()
      ]
    });
  }
};

// ── /nowplaying ───────────────────────────────────────
const nowplayingCommand = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('🎵 현재 재생 중인 곡 정보'),

  async execute(interaction) {
    const state = getMusicState(interaction.guildId);
    if (!state?.currentTrack) {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription('❌ 재생 중인 곡이 없어요!')], ephemeral: true });
    }

    const track = state.currentTrack;
    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle('🎵 지금 재생 중')
      .setDescription(`**[${track.title}](${track.url})**`)
      .addFields(
        { name: '⏱️ 길이', value: track.duration || '알 수 없음', inline: true },
        { name: '📋 대기열', value: `${state.tracks.length}곡 남음`, inline: true }
      )
      .setTimestamp();

    if (track.thumbnail) embed.setThumbnail(track.thumbnail);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music_skip').setLabel('⏭️ 스킵').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_stop').setLabel('⏹️ 정지').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('music_queue').setLabel('📋 대기열').setStyle(ButtonStyle.Primary),
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }
};

// ── /playlist ─────────────────────────────────────────
const playlistCommand = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('📂 플레이리스트 관리')
    .addSubcommand(sub => sub.setName('create').setDescription('플레이리스트 생성')
      .addStringOption(o => o.setName('name').setDescription('이름').setRequired(true)))
    .addSubcommand(sub => sub.setName('add').setDescription('곡 추가')
      .addStringOption(o => o.setName('name').setDescription('플레이리스트 이름').setRequired(true))
      .addStringOption(o => o.setName('url').setDescription('YouTube URL').setRequired(true)))
    .addSubcommand(sub => sub.setName('remove').setDescription('곡 제거')
      .addStringOption(o => o.setName('name').setDescription('플레이리스트 이름').setRequired(true))
      .addIntegerOption(o => o.setName('index').setDescription('제거할 번호').setRequired(true).setMinValue(1)))
    .addSubcommand(sub => sub.setName('play').setDescription('플레이리스트 재생')
      .addStringOption(o => o.setName('name').setDescription('플레이리스트 이름').setRequired(true)))
    .addSubcommand(sub => sub.setName('list').setDescription('내 플레이리스트 목록'))
    .addSubcommand(sub => sub.setName('show').setDescription('플레이리스트 곡 목록')
      .addStringOption(o => o.setName('name').setDescription('플레이리스트 이름').setRequired(true)))
    .addSubcommand(sub => sub.setName('delete').setDescription('플레이리스트 삭제')
      .addStringOption(o => o.setName('name').setDescription('플레이리스트 이름').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === 'create') {
      const name = interaction.options.getString('name');
      const result = createPlaylist(userId, name);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(result.success ? 0x57F287 : 0xFF4757).setDescription(result.message)],
        ephemeral: !result.success
      });
    }

    if (sub === 'add') {
      await interaction.deferReply({ ephemeral: true });
      const name = interaction.options.getString('name');
      const url = interaction.options.getString('url');
      try {
        const { getPlayerInstance } = require('../../utils/musicPlayer');
        const player = getPlayerInstance();
        const result_search = await player.search(url, { requestedBy: interaction.user });
        if (!result_search.hasTracks()) throw new Error('트랙을 찾을 수 없어요!');
        const track = result_search.tracks[0];
        const result = addTrackToPlaylist(userId, name, {
          title: track.title,
          url: track.url,
          duration: track.duration,
          thumbnail: track.thumbnail,
        });
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(result.success ? 0x57F287 : 0xFF4757)
            .setDescription(result.success ? `${result.message}\n> 총 **${result.trackCount}**곡` : result.message)]
        });
      } catch (e) {
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription(`❌ ${e.message}`)] });
      }
    }

    if (sub === 'remove') {
      const name = interaction.options.getString('name');
      const index = interaction.options.getInteger('index');
      const result = removeTrackFromPlaylist(userId, name, index);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(result.success ? 0x57F287 : 0xFF4757).setDescription(result.message)],
        ephemeral: !result.success
      });
    }

    if (sub === 'play') {
      await interaction.deferReply();
      const name = interaction.options.getString('name');
      if (!interaction.member.voice?.channel) {
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription('❌ 음성 채널에 입장해주세요!')] });
      }
      const playlist = getPlaylist(userId, name);
      if (!playlist || playlist.tracks.length === 0) {
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription(`❌ **${name}** 플레이리스트를 찾을 수 없거나 비어있어요!`)] });
      }
      let added = 0;
      for (const track of playlist.tracks) {
        try {
          await playMusic(interaction, track.url);
          added++;
        } catch {}
      }
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x57F287).setDescription(`▶️ **${name}** — ${added}곡을 대기열에 추가했어요!`)]
      });
    }

    if (sub === 'list') {
      const playlists = getUserPlaylists(userId);
      const lines = playlists.map(pl => `🎵 **${pl.name}** — ${pl.trackCount}곡`).join('\n') || '플레이리스트가 없어요!';
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x4ECDC4).setTitle('📂 내 플레이리스트').setDescription(lines)]
      });
    }

    if (sub === 'show') {
      const name = interaction.options.getString('name');
      const playlist = getPlaylist(userId, name);
      if (!playlist) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setDescription(`❌ **${name}** 플레이리스트를 찾을 수 없어요!`)], ephemeral: true });
      }
      const trackList = playlist.tracks.slice(0, 15).map((t, i) => `\`${i + 1}.\` **${t.title}** (${t.duration})`).join('\n') || '곡이 없어요';
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x4ECDC4).setTitle(`📂 ${name}`).setDescription(trackList)
          .addFields({ name: '📊 총 곡 수', value: `${playlist.tracks.length}곡`, inline: true })]
      });
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name');
      const result = deletePlaylist(userId, name);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(result.success ? 0x57F287 : 0xFF4757).setDescription(result.message)],
        ephemeral: !result.success
      });
    }
  }
};

module.exports = { playCommand, skipCommand, stopCommand, queueCommand, nowplayingCommand, playlistCommand };
