const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/playlists.json');

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, '{}');
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getKey(userId, name) {
  return `${userId}_${name.toLowerCase()}`;
}

function createPlaylist(userId, name) {
  const data = loadData();
  const key = getKey(userId, name);
  if (data[key]) return { success: false, message: `**${name}** 플레이리스트가 이미 존재해요!` };

  data[key] = {
    name,
    createdBy: userId,
    createdAt: new Date().toISOString(),
    tracks: [],
  };
  saveData(data);
  return { success: true, message: `✅ 플레이리스트 **${name}**을 생성했어요!` };
}

function addTrackToPlaylist(userId, playlistName, track) {
  const data = loadData();
  const key = getKey(userId, playlistName);
  if (!data[key]) return { success: false, message: `**${playlistName}** 플레이리스트를 찾을 수 없어요!` };

  const isDuplicate = data[key].tracks.some(t => t.url === track.url);
  if (isDuplicate) return { success: false, message: `이 곡은 이미 플레이리스트에 있어요!` };

  data[key].tracks.push({
    title: track.title,
    url: track.url,
    duration: track.duration,
    thumbnail: track.thumbnail,
    addedAt: new Date().toISOString(),
  });
  saveData(data);
  return { success: true, message: `✅ **${track.title}**을 **${playlistName}**에 추가했어요!`, trackCount: data[key].tracks.length };
}

function removeTrackFromPlaylist(userId, playlistName, index) {
  const data = loadData();
  const key = getKey(userId, playlistName);
  if (!data[key]) return { success: false, message: `플레이리스트를 찾을 수 없어요!` };

  const idx = index - 1;
  if (idx < 0 || idx >= data[key].tracks.length) {
    return { success: false, message: `올바른 번호를 입력해주세요 (1~${data[key].tracks.length})` };
  }

  const removed = data[key].tracks.splice(idx, 1)[0];
  saveData(data);
  return { success: true, message: `✅ **${removed.title}**을 제거했어요!` };
}

function getPlaylist(userId, name) {
  const data = loadData();
  return data[getKey(userId, name)] || null;
}

function getUserPlaylists(userId) {
  const data = loadData();
  return Object.entries(data)
    .filter(([key]) => key.startsWith(`${userId}_`))
    .map(([key, pl]) => ({ key, name: pl.name, trackCount: pl.tracks.length }));
}

function deletePlaylist(userId, name) {
  const data = loadData();
  const key = getKey(userId, name);
  if (!data[key]) return { success: false, message: `플레이리스트를 찾을 수 없어요!` };
  delete data[key];
  saveData(data);
  return { success: true, message: `✅ 플레이리스트 **${name}**을 삭제했어요!` };
}

module.exports = {
  createPlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  getPlaylist,
  getUserPlaylists,
  deletePlaylist,
};
