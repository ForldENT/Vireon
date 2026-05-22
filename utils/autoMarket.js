const fs = require('fs');
const path = require('path');

const AUTO_DATA_FILE = path.join(__dirname, '../data/auto_market_data.json');
const db = require('./database');

function loadAutoData() {
  return JSON.parse(fs.readFileSync(AUTO_DATA_FILE, 'utf8'));
}

// ── 캐시 ──────────────────────────────────────────────
let _pendingDelist = null;

async function loadPendingDelistAsync() {
  _pendingDelist = await db.getPendingDelist();
  return _pendingDelist;
}

function loadPendingDelist() {
  return _pendingDelist || [];
}

function savePendingDelist(data) {
  _pendingDelist = data;
  db.savePendingDelist(data).catch(e => console.error('savePendingDelist 오류:', e.message));
}

// ── 랜덤 유틸 ─────────────────────────────────────────
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateTicker(name) {
  // 영문 이름에서 티커 생성
  const clean = name.replace(/[^a-zA-Z가-힣]/g, '');
  if (/[a-zA-Z]/.test(clean)) {
    return clean.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 5);
  }
  // 한글인 경우 랜덤 영문 티커
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let ticker = '';
  for (let i = 0; i < 4; i++) ticker += letters[randomInt(0, 25)];
  return ticker;
}

function makeUniqueTicker(baseTicker, market) {
  const { getAllAssets } = require('./marketManager');
  const all = getAllAssets();
  let ticker = baseTicker;
  let suffix = 1;
  while (all[ticker]) {
    ticker = baseTicker.slice(0, 3) + suffix;
    suffix++;
  }
  return ticker;
}

// ── 주식 자동 상장 ────────────────────────────────────
function autoListStock() {
  const autoData = loadAutoData();
  const { createAsset } = require('./marketManager');

  // 카테고리 랜덤 선택
  const categories = Object.keys(autoData.stockCategories);
  const catId = randomFrom(categories);
  const category = autoData.stockCategories[catId];

  // 회사 랜덤 선택
  const company = randomFrom(category.companies);
  const baseTicker = generateTicker(company.name);
  const ticker = makeUniqueTicker(baseTicker, 'stock');

  // 초기 가격 랜덤 (1,000 ~ 200,000원)
  const price = randomInt(1000, 200000);

  const result = createAsset({
    ticker,
    name: company.name,
    type: 'stock',
    sector: company.sector,
    emoji: company.emoji,
    price,
    description: `${category.name} 신규 상장 종목 — ${company.sector} 분야`,
    category: catId,
  });

  if (result.success) {
    return {
      success: true,
      ticker,
      name: company.name,
      emoji: company.emoji,
      price,
      category: category.name,
      categoryEmoji: category.emoji,
      sector: company.sector,
    };
  }
  return null;
}

// ── 코인 자동 상장 ────────────────────────────────────
function autoListCoin() {
  const autoData = loadAutoData();
  const { createAsset, getAllAssets } = require('./marketManager');

  // 이미 상장된 코인 이름 목록
  const all = getAllAssets();
  const listedNames = Object.values(all)
    .filter(a => a.type === 'coin')
    .map(a => a.name);

  // 미상장 코인 풀에서 선택
  const available = autoData.coinPool.filter(c => !listedNames.includes(c.name));
  if (available.length === 0) return null;

  const coin = randomFrom(available);
  const baseTicker = generateTicker(coin.name);
  const ticker = makeUniqueTicker(baseTicker, 'coin');

  // 코인 가격 (1 ~ 50,000원)
  const price = randomInt(1, 50000);

  const result = createAsset({
    ticker,
    name: coin.name,
    type: 'coin',
    sector: coin.sector,
    emoji: coin.emoji,
    price,
    description: `신규 상장 코인 — ${coin.sector}`,
  });

  if (result.success) {
    return {
      success: true,
      ticker,
      name: coin.name,
      emoji: coin.emoji,
      price,
      sector: coin.sector,
    };
  }
  return null;
}

// ── 주식 부도 위기 처리 ───────────────────────────────
function triggerBankruptcyWarning() {
  const { getAllAssets } = require('./marketManager');
  const autoData = loadAutoData();
  const pending = loadPendingDelist();

  // 현재 상장된 주식 목록
  const allAssets = getAllAssets();
  const stocks = Object.values(allAssets).filter(a =>
    a.type === 'stock' &&
    !pending.some(p => p.ticker === a.id)
  );

  if (stocks.length === 0) return null;

  const target = randomFrom(stocks);
  const reason = randomFrom(autoData.bankruptcyReasons);

  // 1~7일 사이 랜덤 폐지 일정
  const daysUntilDelist = randomInt(1, 7);
  const delistAt = new Date(Date.now() + daysUntilDelist * 24 * 60 * 60 * 1000).toISOString();

  pending.push({
    ticker: target.id,
    name: target.name,
    emoji: target.emoji,
    type: 'stock',
    reason,
    daysUntilDelist,
    delistAt,
    warnedAt: new Date().toISOString(),
  });

  savePendingDelist(pending);

  // 가격 20~40% 하락
  const dropRate = -(randomInt(20, 40) / 100);
  const { forceSetPrice } = require('./marketManager');
  const newPrice = Math.max(1, Math.floor(target.price * (1 + dropRate)));
  forceSetPrice(target.id, newPrice);

  return {
    ticker: target.id,
    name: target.name,
    emoji: target.emoji,
    reason,
    daysUntilDelist,
    dropRate: Math.abs(dropRate * 100),
  };
}

// ── 코인 즉시 폐지 ────────────────────────────────────
function triggerCoinDelist(isRugpull = false) {
  const { getAllAssets, deleteAsset } = require('./marketManager');
  const autoData = loadAutoData();

  const allAssets = getAllAssets();
  const coins = Object.values(allAssets).filter(a => a.type === 'coin');
  if (coins.length === 0) return null;

  const target = randomFrom(coins);

  // 보유자들에게 손실 처리
  refundOrWipeHolders(target.id, isRugpull ? 0 : 0);

  deleteAsset(target.id);

  let reason = '운영 중단';
  if (isRugpull) {
    reason = randomFrom(autoData.rugpullReasons);
  }

  return {
    ticker: target.id,
    name: target.name,
    emoji: target.emoji,
    reason,
    isRugpull,
    lastPrice: target.price,
  };
}

// ── 만료된 부도 처리 ──────────────────────────────────
function processPendingDelists() {
  const pending = loadPendingDelist();
  const now = new Date();
  const toProcess = pending.filter(p => new Date(p.delistAt) <= now);
  const remaining = pending.filter(p => new Date(p.delistAt) > now);

  const results = [];
  for (const item of toProcess) {
    const { deleteAsset, getAllAssets } = require('./marketManager');
    const all = getAllAssets();
    if (all[item.ticker]) {
      refundOrWipeHolders(item.ticker, false);
      deleteAsset(item.ticker);
      results.push(item);
    }
  }

  savePendingDelist(remaining);
  return results;
}

// ── 보유자 처리 (폐지 시 잔액 0원으로) ───────────────
function refundOrWipeHolders(ticker, refundRate = 0) {
  try {
    const { loadUsers, saveUsers, getAsset } = require('./marketManager');
    const users = loadUsers();
    const asset = getAsset(ticker);
    if (!asset) return;

    for (const [userId, userData] of Object.entries(users)) {
      if (userId.startsWith('_')) continue;
      if (userData.portfolio && userData.portfolio[ticker]) {
        const pos = userData.portfolio[ticker];
        const refund = Math.floor(asset.price * pos.qty * refundRate);
        users[userId].balance += refund;

        users[userId].transactions = users[userId].transactions || [];
        users[userId].transactions.unshift({
          type: 'DELIST',
          ticker,
          quantity: pos.qty,
          price: asset.price,
          total: refund,
          pnl: refund - (pos.avgPrice * pos.qty),
          date: new Date().toISOString(),
        });

        delete users[userId].portfolio[ticker];
      }
    }
    saveUsers(users);
  } catch (e) {
    console.error('보유자 처리 오류:', e);
  }
}

// ── 배당금 지급 (7일마다) ─────────────────────────────
function payDividends() {
  const { loadUsers, saveUsers, getAllAssets } = require('./marketManager');
  const users = loadUsers();
  const assets = getAllAssets();
  const results = [];

  for (const [userId, userData] of Object.entries(users)) {
    if (userId.startsWith('_') || !userData.portfolio) continue;

    let totalDividend = 0;
    const details = [];

    for (const [ticker, pos] of Object.entries(userData.portfolio)) {
      const asset = assets[ticker];
      if (!asset || asset.type !== 'stock') continue;

      const dividend = Math.floor(asset.price * pos.qty * 0.01); // 1%
      totalDividend += dividend;
      details.push({ ticker, name: asset.name, dividend, qty: pos.qty });
    }

    if (totalDividend > 0) {
      users[userId].balance += totalDividend;
      results.push({ userId, totalDividend, details });
    }
  }

  saveUsers(users);
  return results;
}

module.exports = {
  loadPendingDelistAsync,
  autoListStock,
  autoListCoin,
  triggerBankruptcyWarning,
  triggerCoinDelist,
  processPendingDelists,
  payDividends,
  loadPendingDelist,
};
