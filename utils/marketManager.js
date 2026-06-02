const db = require('./database');

// ── 메모리 캐시 ───────────────────────────────────────
let _market = null;
let _users = null;
let _config = null;
let _news = [];

// ── 동기 래퍼 (기존 코드 호환) ───────────────────────
function loadMarket() {
  return _market || { companies: {}, coins: {}, lastUpdate: null, totalTradingDays: 0 };
}
function saveMarket(data) {
  _market = data;
  db.saveMarket(data).catch(e => console.error('saveMarket 오류:', e.message));
}
function loadUsers() {
  return _users || {};
}
function saveUsers(data) {
  _users = data;
  db.saveUsers(data).catch(e => console.error('saveUsers 오류:', e.message));
}
function loadNews() {
  return _news || [];
}
function saveNews(data) {
  _news = data;
  db.saveNews(data).catch(e => console.error('saveNews 오류:', e.message));
}
function loadConfig() {
  return _config || {
    startingBalance: 50000000,
    newsChannelId: null,
    stockChannelId: null,
  };
}
function saveConfig(data) {
  _config = data;
  db.saveConfig(data).catch(e => console.error('saveConfig 오류:', e.message));
}

// ── MongoDB 초기 로드 (봇 시작시 호출) ───────────────
async function initializeFromDB() {
  console.log('📦 MongoDB에서 데이터 로딩...');
  _market = await db.getMarket();
  _users = await db.getUsers();
  _config = await db.getConfig();
  _news = await db.getNews();
  console.log(`✅ 로드 완료 — 종목 ${Object.keys(_market.companies||{}).length}개, 유저 ${Object.keys(_users).length}명, 뉴스 ${_news.length}건`);
}

// ── 티커 키 해석 (한글/영문/대소문자 혼용 대응) ──────
function resolveKey(ticker) {
  const market = loadMarket();
  const all = { ...market.companies, ...market.coins };

  // 1. 정확히 일치
  if (all[ticker]) return ticker;

  // 2. 대소문자 무시 (영문 종목 대응)
  const lower = ticker.toLowerCase();
  const found = Object.keys(all).find(k => k.toLowerCase() === lower);
  return found || ticker;
}

// ── 유저 초기화 ───────────────────────────────────────
function ensureUser(userId) {
  const users = loadUsers();
  if (!users[userId]) {
    const config = loadConfig();
    const market = loadMarket();

    users[userId] = {
      balance: config.startingBalance,
      portfolio: {},
      transactions: [],
      createdAt: new Date().toISOString(),
      totalPnl: 0,
    };
    saveUsers(users);
  }
  return users[userId];
}

// ── 모든 종목 통합 조회 ───────────────────────────────
function getAllAssets() {
  const market = loadMarket();
  return { ...market.companies, ...market.coins };
}

function getAsset(ticker) {
  const all = getAllAssets();
  if (all[ticker]) return all[ticker];
  const lower = ticker.toLowerCase();
  const found = Object.keys(all).find(k => k.toLowerCase() === lower);
  return found ? all[found] : null;
}

// ── 가격 변동 엔진 ────────────────────────────────────
function generatePriceChange(asset, newsImpact = 0) {
  const type = asset.type;
  const rand = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  let change;

  if (type === 'coin') {
    // 코인: 최대 +10000%, 최소 -1000%
    const volatility = 0.50;
    change = rand() * volatility;
    change += newsImpact * volatility * 2;
    change = Math.max(-10.0, Math.min(100.0, change));
  } else {
    // 주식: 최대 +50%, 최소 -50%
    const volatility = asset.sector === '바이오' ? 0.15 : 0.10;
    change = rand() * volatility;
    change += newsImpact * volatility * 2;
    change = Math.max(-0.50, Math.min(0.50, change));
  }

  return change;
}

// ── 일일 시장 업데이트 ────────────────────────────────
function applyDailyUpdate(newsImpacts = {}) {
  const market = loadMarket();
  const results = [];

  for (const section of ['companies', 'coins']) {
    for (const [ticker, asset] of Object.entries(market[section])) {
      const impact = newsImpacts[ticker] || 0;
      const changeRate = generatePriceChange(asset, impact);

      const oldPrice = asset.price;
      let newPrice;
      if (asset.type === 'coin') {
        const raw = oldPrice * (1 + changeRate);
        if (oldPrice >= 10) {
          newPrice = Math.max(1, Math.round(raw));
        } else if (oldPrice >= 1) {
          // 1~10원 구간: 소수점 1자리
          newPrice = Math.max(1, parseFloat(raw.toFixed(1)));
        } else {
          newPrice = Math.max(1, parseFloat(raw.toFixed(2)));
        }
      } else {
        newPrice = Math.max(1, Math.round(oldPrice * (1 + changeRate)));
      }
      const changePct = ((newPrice - oldPrice) / oldPrice) * 100;

      market[section][ticker].open = oldPrice;
      market[section][ticker].price = newPrice;
      market[section][ticker].high = Math.max(asset.high === asset.open ? newPrice : asset.high, newPrice);
      market[section][ticker].low = Math.min(asset.low === asset.open ? newPrice : asset.low, newPrice);
      market[section][ticker].changePercent = parseFloat(changePct.toFixed(2));
      market[section][ticker].history.push(newPrice);
      if (market[section][ticker].history.length > 30) {
        market[section][ticker].history.shift();
      }

      results.push({ ticker, name: asset.name, oldPrice, newPrice, changePercent: changePct, type: asset.type });
    }
  }

  market.lastUpdate = new Date().toISOString();
  market.totalTradingDays = (market.totalTradingDays || 0) + 1;
  saveMarket(market);
  return results;
}

// ── 쌀먹 방지 쿨다운 (종목별 마지막 매도 시간) ────────
const sellCooldowns = {};
const SELL_COOLDOWN_MS = 5 * 60 * 1000; // 5분

// ── 매수 (환율 적용) ──────────────────────────────────
function buyAsset(userId, ticker, quantity) {
  const user = ensureUser(userId);
  const key = resolveKey(ticker);
  const asset = getAsset(key);
  if (!asset) return { success: false, message: `**${ticker}** 종목을 찾을 수 없어요.` };
  if (quantity <= 0) return { success: false, message: '수량은 1 이상이어야 해요.' };

  // 쌀먹 방지 - 매도 후 5분간 같은 종목 매수 불가
  const cooldownKey = `${userId}_${key}`;
  if (sellCooldowns[cooldownKey]) {
    const elapsed = Date.now() - sellCooldowns[cooldownKey];
    if (elapsed < SELL_COOLDOWN_MS) {
      const remaining = Math.ceil((SELL_COOLDOWN_MS - elapsed) / 1000);
      return { success: false, message: `⏰ 매도 후 **${Math.ceil(remaining/60)}분 ${remaining%60}초** 후에 같은 종목을 매수할 수 있어요! (쌀먹 방지)` };
    }
  }

  const { getCurrencyByCategory, foreignToKrw, formatPriceWithKrw } = require('./currencyManager');
  const currency = getCurrencyByCategory(asset.category || 'domestic');
  const priceInCurrency = asset.price;
  const priceInKrw = currency === 'KRW' ? priceInCurrency : Math.round(foreignToKrw(priceInCurrency, currency));
  const totalCostKrw = priceInKrw * quantity;

  if (user.balance < totalCostKrw) {
    return {
      success: false,
      message: `잔액이 부족해요!\n필요: **${totalCostKrw.toLocaleString()}원** / 보유: **${user.balance.toLocaleString()}원**`
    };
  }

  const users = loadUsers();
  users[userId].balance -= totalCostKrw;

  if (!users[userId].portfolio[key]) {
    users[userId].portfolio[key] = { qty: 0, avgPrice: 0, totalInvested: 0, currency };
  }

  const pos = users[userId].portfolio[key];
  const newQty = pos.qty + quantity;
  const newAvg = Math.round(((pos.avgPrice * pos.qty) + totalCostKrw) / newQty);

  users[userId].portfolio[key] = {
    qty: newQty,
    avgPrice: newAvg,
    totalInvested: (pos.totalInvested || 0) + totalCostKrw,
    currency,
  };

  users[userId].transactions = users[userId].transactions || [];
  users[userId].transactions.unshift({
    type: 'BUY',
    ticker: key,
    quantity,
    price: priceInCurrency,
    priceKrw: priceInKrw,
    currency,
    total: totalCostKrw,
    date: new Date().toISOString(),
  });
  if (users[userId].transactions.length > 50) users[userId].transactions.length = 50;

  saveUsers(users);

  const market = loadMarket();
  const section = asset.type === 'coin' ? 'coins' : 'companies';
  if (market[section][key]) {
    market[section][key].volume = (market[section][key].volume || 0) + quantity;
    saveMarket(market);
  }

  const priceDisplay = formatPriceWithKrw(priceInCurrency, currency);
  return {
    success: true,
    message: `✅ **${asset.name}(${key})** ${quantity}주 매수 완료!\n💰 단가: **${priceDisplay}**\n💵 총 비용: **${totalCostKrw.toLocaleString()}원**\n🏦 잔액: **${users[userId].balance.toLocaleString()}원**`,
    asset, quantity, totalCost: totalCostKrw, currency,
  };
}

// ── 매도 (환율 적용) ──────────────────────────────────
function sellAsset(userId, ticker, quantity) {
  const user = ensureUser(userId);
  const key = resolveKey(ticker);
  const asset = getAsset(key);
  if (!asset) return { success: false, message: `**${ticker}** 종목을 찾을 수 없어요.` };

  let portfolioKey = key;
  if (!user.portfolio[key]) {
    const lowerKey = key.toLowerCase();
    const found = Object.keys(user.portfolio).find(k => k.toLowerCase() === lowerKey);
    if (found) portfolioKey = found;
  }
  const pos = user.portfolio[portfolioKey];
  if (!pos || pos.qty < quantity) {
    return { success: false, message: `보유 수량이 부족해요! 보유: **${pos?.qty || 0}주**` };
  }

  const { getCurrencyByCategory, foreignToKrw, formatPriceWithKrw } = require('./currencyManager');
  const currency = getCurrencyByCategory(asset.category || 'domestic');
  const priceInCurrency = asset.price;
  const priceInKrw = currency === 'KRW' ? priceInCurrency : Math.round(foreignToKrw(priceInCurrency, currency));
  const totalGainKrw = priceInKrw * quantity;
  const costBasis = pos.avgPrice * quantity;
  const pnl = totalGainKrw - costBasis;
  const pnlPercent = ((pnl / costBasis) * 100).toFixed(2);

  const users = loadUsers();
  users[userId].balance += totalGainKrw;
  users[userId].totalPnl = (users[userId].totalPnl || 0) + pnl;

  if (pos.qty === quantity) {
    delete users[userId].portfolio[portfolioKey];
  } else {
    users[userId].portfolio[portfolioKey].qty -= quantity;
  }

  users[userId].transactions = users[userId].transactions || [];
  users[userId].transactions.unshift({
    type: 'SELL',
    ticker: key,
    quantity,
    price: priceInCurrency,
    priceKrw: priceInKrw,
    currency,
    total: totalGainKrw,
    pnl,
    date: new Date().toISOString(),
  });
  if (users[userId].transactions.length > 50) users[userId].transactions.length = 50;

  saveUsers(users);

  // 쌀먹 방지 쿨다운 등록
  const cooldownKey = `${userId}_${key}`;
  sellCooldowns[cooldownKey] = Date.now();
  setTimeout(() => delete sellCooldowns[cooldownKey], SELL_COOLDOWN_MS);

  const pnlEmoji = pnl >= 0 ? '📈' : '📉';
  const priceDisplay = formatPriceWithKrw(priceInCurrency, currency);
  return {
    success: true,
    message: `✅ **${asset.name}(${key})** ${quantity}주 매도 완료!\n💰 단가: **${priceDisplay}**\n${pnlEmoji} 손익: **${pnl >= 0 ? '+' : ''}${pnl.toLocaleString()}원** (${pnlPercent}%)\n🏦 잔액: **${users[userId].balance.toLocaleString()}원**`,
    asset, quantity, totalGain: totalGainKrw, pnl, currency,
  };
}

// ── 포트폴리오 조회 ───────────────────────────────────
function getPortfolio(userId) {
  const user = ensureUser(userId);
  const assets = getAllAssets();
  const config = loadConfig();

  let totalValue = 0;
  let totalInvested = 0;
  const positions = [];

  for (const [ticker, pos] of Object.entries(user.portfolio)) {
    const asset = assets[ticker];
    if (!asset) continue;

    const currentValue = asset.price * pos.qty;
    const invested = pos.avgPrice * pos.qty;
    const pnl = currentValue - invested;
    const pnlPercent = ((pnl / invested) * 100).toFixed(2);

    totalValue += currentValue;
    totalInvested += invested;

    positions.push({
      ticker,
      name: asset.name,
      emoji: asset.emoji,
      qty: pos.qty,
      avgPrice: pos.avgPrice,
      currentPrice: asset.price,
      currentValue,
      pnl,
      pnlPercent,
    });
  }

  const totalAssets = user.balance + totalValue;
  const totalPnl = totalValue - totalInvested;
  const startBalance = config.startingBalance;
  const returnRate = (((totalAssets - startBalance) / startBalance) * 100).toFixed(2);

  return {
    balance: user.balance,
    totalValue,
    totalInvested,
    totalAssets,
    totalPnl,
    returnRate,
    positions: positions.sort((a, b) => b.currentValue - a.currentValue),
    transactions: user.transactions.slice(0, 10),
  };
}

// ── 랭킹 조회 ─────────────────────────────────────────
function getRankings(client) {
  const users = loadUsers();
  const config = loadConfig();
  const assets = getAllAssets();
  const rankings = [];

  for (const [userId, userData] of Object.entries(users)) {
    if (userId.startsWith('_')) continue;

    let portfolioValue = 0;
    for (const [ticker, pos] of Object.entries(userData.portfolio || {})) {
      const asset = assets[ticker];
      if (asset) portfolioValue += asset.price * pos.qty;
    }

    const totalAssets = userData.balance + portfolioValue;
    const returnRate = (((totalAssets - config.startingBalance) / config.startingBalance) * 100).toFixed(2);

    rankings.push({ userId, totalAssets, returnRate });
  }

  return rankings.sort((a, b) => b.totalAssets - a.totalAssets).slice(0, 10);
}

// ── 관리자: 종목 생성 ─────────────────────────────────
function createAsset(options) {
  const { ticker, name, type, sector, emoji, price, description, category } = options;
  const market = loadMarket();
  const section = type === 'coin' ? 'coins' : 'companies';

  const all = { ...market.companies, ...market.coins };
  const lower = ticker.toLowerCase();
  const duplicate = Object.keys(all).find(k => k.toLowerCase() === lower);
  if (duplicate) {
    return { success: false, message: `**${duplicate}** 티커가 이미 존재해요!` };
  }

  market[section][ticker] = {
    id: ticker,
    name,
    type,
    sector,
    category: category || (type === 'coin' ? 'crypto' : 'domestic'),
    emoji: emoji || (type === 'coin' ? '🪙' : '🏢'),
    price,
    open: price,
    high: price,
    low: price,
    volume: 0,
    marketCap: price * 1000000,
    description,
    history: [price],
    changePercent: 0,
    createdAt: new Date().toISOString(),
    isAdmin: true,
  };

  saveMarket(market);
  return { success: true, message: `✅ **${name}(${ticker})** 종목이 생성되었어요!` };
}

// ── 관리자: 종목 삭제 ─────────────────────────────────
function deleteAsset(ticker) {
  const key = resolveKey(ticker);
  const market = loadMarket();

  if (market.companies[key]) {
    delete market.companies[key];
    saveMarket(market);
    return { success: true };
  }
  if (market.coins[key]) {
    delete market.coins[key];
    saveMarket(market);
    return { success: true };
  }
  return { success: false, message: `**${ticker}** 종목을 찾을 수 없어요.` };
}

// ── 관리자: 강제 가격 조정 ────────────────────────────
function forceSetPrice(ticker, newPrice) {
  const key = resolveKey(ticker);
  const market = loadMarket();
  const section = market.companies[key] ? 'companies' : market.coins[key] ? 'coins' : null;

  if (!section) return { success: false, message: `종목을 찾을 수 없어요.` };

  market[section][key].price = newPrice;
  market[section][key].history.push(newPrice);
  saveMarket(market);
  return { success: true };
}

module.exports = {
  initializeFromDB,
  loadMarket, saveMarket,
  loadUsers, saveUsers,
  loadNews, saveNews,
  loadConfig, saveConfig,
  ensureUser,
  getAllAssets, getAsset,
  applyDailyUpdate,
  buyAsset, sellAsset,
  getPortfolio, getRankings,
  createAsset, deleteAsset, forceSetPrice,
  generatePriceChange,
};
