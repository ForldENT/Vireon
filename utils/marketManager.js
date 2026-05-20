const fs = require('fs');
const path = require('path');

const MARKET_FILE = path.join(__dirname, '../data/market.json');
const USERS_FILE = path.join(__dirname, '../data/users.json');
const NEWS_FILE = path.join(__dirname, '../data/news.json');
const CONFIG_FILE = path.join(__dirname, '../data/config.json');

// ── 파일 I/O ──────────────────────────────────────────
function loadMarket() {
  return JSON.parse(fs.readFileSync(MARKET_FILE, 'utf8'));
}
function saveMarket(data) {
  fs.writeFileSync(MARKET_FILE, JSON.stringify(data, null, 2));
}
function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}
function loadNews() {
  return JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8'));
}
function saveNews(data) {
  fs.writeFileSync(NEWS_FILE, JSON.stringify(data, null, 2));
}
function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}
function saveConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// ── 유저 초기화 ───────────────────────────────────────
function ensureUser(userId) {
  const users = loadUsers();
  if (!users[userId]) {
    const config = loadConfig();
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
  return all[ticker.toUpperCase()] || null;
}

// ── 가격 변동 엔진 ────────────────────────────────────
function generatePriceChange(asset, newsImpact = 0) {
  const type = asset.type;
  
  // 기본 변동폭 설정 (코인 > 바이오 > 일반주)
  let volatility;
  if (type === 'coin') {
    if (asset.sector === '밈코인') volatility = 0.18; // 최대 ±18%
    else volatility = 0.10;
  } else {
    if (asset.sector === '바이오') volatility = 0.08;
    else volatility = 0.05;
  }

  // 랜덤 변동 (가우시안 근사)
  const rand = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  let change = rand() * volatility;

  // 뉴스 영향 적용 (-1 ~ +1 스케일)
  change += newsImpact * volatility * 2;

  // 극단값 클램프
  change = Math.max(-volatility * 2.5, Math.min(volatility * 2.5, change));

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
      const newPrice = Math.max(1, Math.round(oldPrice * (1 + changeRate)));
      const changePct = ((newPrice - oldPrice) / oldPrice) * 100;

      market[section][ticker].open = oldPrice;
      market[section][ticker].price = newPrice;
      market[section][ticker].high = Math.max(asset.high === asset.open ? newPrice : asset.high, newPrice);
      market[section][ticker].low = Math.min(asset.low === asset.open ? newPrice : asset.low, newPrice);
      market[section][ticker].changePercent = parseFloat(changePct.toFixed(2));
      
      // 히스토리 최대 30일 유지
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

// ── 매수 (환율 적용) ──────────────────────────────────
function buyAsset(userId, ticker, quantity) {
  const user = ensureUser(userId);
  const asset = getAsset(ticker);
  if (!asset) return { success: false, message: `**${ticker}** 종목을 찾을 수 없어요.` };
  if (quantity <= 0) return { success: false, message: '수량은 1 이상이어야 해요.' };

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

  if (!users[userId].portfolio[ticker]) {
    users[userId].portfolio[ticker] = { qty: 0, avgPrice: 0, totalInvested: 0, currency };
  }

  const pos = users[userId].portfolio[ticker];
  const newQty = pos.qty + quantity;
  const newAvg = Math.round(((pos.avgPrice * pos.qty) + totalCostKrw) / newQty);

  users[userId].portfolio[ticker] = {
    qty: newQty,
    avgPrice: newAvg,
    totalInvested: (pos.totalInvested || 0) + totalCostKrw,
    currency,
  };

  users[userId].transactions = users[userId].transactions || [];
  users[userId].transactions.unshift({
    type: 'BUY',
    ticker,
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
  if (market[section][ticker]) {
    market[section][ticker].volume = (market[section][ticker].volume || 0) + quantity;
    saveMarket(market);
  }

  const priceDisplay = formatPriceWithKrw(priceInCurrency, currency);
  return {
    success: true,
    message: `✅ **${asset.name}(${ticker})** ${quantity}주 매수 완료!\n💰 단가: **${priceDisplay}**\n💵 총 비용: **${totalCostKrw.toLocaleString()}원**\n🏦 잔액: **${users[userId].balance.toLocaleString()}원**`,
    asset, quantity, totalCost: totalCostKrw, currency,
  };
}

// ── 매도 (환율 적용) ──────────────────────────────────
function sellAsset(userId, ticker, quantity) {
  const user = ensureUser(userId);
  const asset = getAsset(ticker);
  if (!asset) return { success: false, message: `**${ticker}** 종목을 찾을 수 없어요.` };

  const pos = user.portfolio[ticker];
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
    delete users[userId].portfolio[ticker];
  } else {
    users[userId].portfolio[ticker].qty -= quantity;
  }

  users[userId].transactions = users[userId].transactions || [];
  users[userId].transactions.unshift({
    type: 'SELL',
    ticker,
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

  const pnlEmoji = pnl >= 0 ? '📈' : '📉';
  const priceDisplay = formatPriceWithKrw(priceInCurrency, currency);
  return {
    success: true,
    message: `✅ **${asset.name}(${ticker})** ${quantity}주 매도 완료!\n💰 단가: **${priceDisplay}**\n${pnlEmoji} 손익: **${pnl >= 0 ? '+' : ''}${pnl.toLocaleString()}원** (${pnlPercent}%)\n🏦 잔액: **${users[userId].balance.toLocaleString()}원**`,
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
  const key = ticker.toUpperCase();

  if (market.companies[key] || market.coins[key]) {
    return { success: false, message: `**${key}** 티커가 이미 존재해요!` };
  }

  market[section][key] = {
    id: key,
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
  return { success: true, message: `✅ **${name}(${key})** 종목이 생성되었어요!` };
}

// ── 관리자: 종목 삭제 ─────────────────────────────────
function deleteAsset(ticker) {
  const market = loadMarket();
  const key = ticker.toUpperCase();

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
  return { success: false, message: `**${key}** 종목을 찾을 수 없어요.` };
}

// ── 관리자: 강제 가격 조정 ────────────────────────────
function forceSetPrice(ticker, newPrice) {
  const market = loadMarket();
  const key = ticker.toUpperCase();
  const section = market.companies[key] ? 'companies' : market.coins[key] ? 'coins' : null;
  
  if (!section) return { success: false, message: `종목을 찾을 수 없어요.` };
  
  market[section][key].price = newPrice;
  market[section][key].history.push(newPrice);
  saveMarket(market);
  return { success: true };
}

module.exports = {
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
