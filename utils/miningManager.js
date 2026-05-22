const fs = require('fs');
const path = require('path');
const db = require('./database');

const MINING_DATA_FILE = path.join(__dirname, '../data/mining_data.json');

function loadMiningData() {
  return JSON.parse(fs.readFileSync(MINING_DATA_FILE, 'utf8'));
}

// ── 인벤토리 캐시 ─────────────────────────────────────
let _inv = null;

async function loadInventoryAsync() {
  _inv = await db.getMiningInventory();
  return _inv;
}

function loadInventory() {
  return _inv || {};
}

function saveInventory(data) {
  _inv = data;
  for (const [userId, userData] of Object.entries(data)) {
    db.saveMiningUser(userId, userData).catch(() => {});
  }
}

function ensureMiningUser(userId) {
  if (!_inv) _inv = {};
  if (!_inv[userId]) {
    _inv[userId] = {
      minerals: {},
      lastMined: null,
      totalMined: 0,
      tool: 'basic',
    };
    db.saveMiningUser(userId, _inv[userId]).catch(() => {});
  }
  return _inv[userId];
}

// ── 채굴 실행 ─────────────────────────────────────────
function mine(userId) {
  ensureMiningUser(userId);
  const inv = loadInventory();
  const userData = inv[userId];

  // 쿨다운 체크
  const miningData = loadMiningData();
  const now = Date.now();
  if (userData.lastMined) {
    const elapsed = now - new Date(userData.lastMined).getTime();
    if (elapsed < miningData.miningCooldown) {
      const remaining = Math.ceil((miningData.miningCooldown - elapsed) / 60000);
      return { success: false, message: `⏰ 채굴 쿨다운 중! **${remaining}분** 후에 다시 채굴할 수 있어요.` };
    }
  }

  // 등급 결정 (확률)
  const rand = Math.random();
  let grade = 'C';
  let cumulative = 0;

  const gradeOrder = ['SSS', 'SS', 'S', 'A', 'B', 'C'];
  for (const g of gradeOrder) {
    cumulative += miningData.minerals[g].probability;
    if (rand < cumulative) {
      grade = g;
      break;
    }
  }

  const gradeData = miningData.minerals[grade];
  const items = gradeData.items;
  const item = items[Math.floor(Math.random() * items.length)];

  // 도구 보너스
  const tool = miningData.miningTools[userData.tool || 'basic'];
  const bonusMultiplier = tool.bonus;

  // 인벤토리에 추가
  if (!userData.minerals[item.id]) {
    userData.minerals[item.id] = { count: 0, grade, name: item.name, basePrice: item.basePrice };
  }
  userData.minerals[item.id].count += 1;
  userData.lastMined = new Date().toISOString();
  userData.totalMined = (userData.totalMined || 0) + 1;

  // 5% 확률로 주식 1주 획득
  let stockDrop = null;
  if (Math.random() < 0.05) {
    const { getAllAssets } = require('./marketManager');
    const assets = getAllAssets();
    const stocks = Object.values(assets).filter(a => a.type === 'stock');
    if (stocks.length > 0) {
      const randomStock = stocks[Math.floor(Math.random() * stocks.length)];
      const { loadUsers, saveUsers } = require('./marketManager');
      const users = loadUsers();
      if (users[userId]) {
        if (!users[userId].portfolio[randomStock.id]) {
          users[userId].portfolio[randomStock.id] = { qty: 0, avgPrice: randomStock.price, totalInvested: 0, currency: 'KRW' };
        }
        users[userId].portfolio[randomStock.id].qty += 1;
        saveUsers(users);
        stockDrop = { name: randomStock.name, ticker: randomStock.id, emoji: randomStock.emoji };
      }
    }
  }

  saveInventory(inv);

  return {
    success: true,
    grade,
    item,
    gradeData,
    stockDrop,
    tool,
  };
}

// ── 인벤토리 조회 ─────────────────────────────────────
function getInventory(userId) {
  ensureMiningUser(userId);
  const inv = loadInventory();
  return inv[userId];
}

// ── 광물 판매 (고물상) ────────────────────────────────
function sellMinerals(userId, mineralId, count) {
  const inv = loadInventory();
  ensureMiningUser(userId);
  const userData = inv[userId];

  if (!userData.minerals[mineralId] || userData.minerals[mineralId].count < count) {
    return { success: false, message: `보유한 ${mineralId} 수량이 부족해요!` };
  }

  const mineral = userData.minerals[mineralId];
  // 가격 약간 랜덤 (±10%)
  const priceVariation = 0.9 + Math.random() * 0.2;
  const totalPrice = Math.floor(mineral.basePrice * count * priceVariation);

  userData.minerals[mineralId].count -= count;
  if (userData.minerals[mineralId].count === 0) {
    delete userData.minerals[mineralId];
  }

  saveInventory(inv);

  const { loadUsers, saveUsers } = require('./marketManager');
  const users = loadUsers();
  if (users[userId]) {
    users[userId].balance += totalPrice;
    saveUsers(users);
  }

  return {
    success: true,
    totalPrice,
    mineralName: mineral.name,
    count,
    pricePerUnit: Math.floor(mineral.basePrice * priceVariation),
  };
}

// ── 전체 판매 ─────────────────────────────────────────
function sellAllMinerals(userId) {
  const inv = loadInventory();
  ensureMiningUser(userId);
  const userData = inv[userId];

  if (Object.keys(userData.minerals).length === 0) {
    return { success: false, message: '판매할 광물이 없어요!' };
  }

  let totalPrice = 0;
  const soldItems = [];

  for (const [mineralId, mineralData] of Object.entries(userData.minerals)) {
    const priceVariation = 0.9 + Math.random() * 0.2;
    const price = Math.floor(mineralData.basePrice * mineralData.count * priceVariation);
    totalPrice += price;
    soldItems.push({ name: mineralData.name, count: mineralData.count, price });
  }

  userData.minerals = {};
  saveInventory(inv);

  const { loadUsers, saveUsers } = require('./marketManager');
  const users = loadUsers();
  if (users[userId]) {
    users[userId].balance += totalPrice;
    saveUsers(users);
  }

  return { success: true, totalPrice, soldItems };
}

// ── 도구 구매 ─────────────────────────────────────────
function buyTool(userId, toolId) {
  const miningData = loadMiningData();
  const tool = miningData.miningTools[toolId];
  if (!tool) return { success: false, message: '존재하지 않는 도구예요!' };

  const { loadUsers, saveUsers } = require('./marketManager');
  const users = loadUsers();
  if (!users[userId]) return { success: false, message: '계정이 없어요!' };
  if (users[userId].balance < tool.price) {
    return { success: false, message: `잔액이 부족해요! 필요: **${tool.price.toLocaleString()}원**` };
  }

  users[userId].balance -= tool.price;
  saveUsers(users);

  const inv = loadInventory();
  ensureMiningUser(userId);
  inv[userId].tool = toolId;
  saveInventory(inv);

  return { success: true, tool };
}

module.exports = {
  loadInventoryAsync,
  mine,
  getInventory,
  sellMinerals,
  sellAllMinerals,
  buyTool,
  loadMiningData,
  ensureMiningUser,
};
