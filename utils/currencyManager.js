const fs = require('fs');
const path = require('path');

const CURRENCY_FILE = path.join(__dirname, '../data/currency.json');

function loadCurrency() {
  if (!fs.existsSync(CURRENCY_FILE)) {
    fs.mkdirSync(path.dirname(CURRENCY_FILE), { recursive: true });
  }
  return JSON.parse(fs.readFileSync(CURRENCY_FILE, 'utf8'));
}

function saveCurrency(data) {
  fs.writeFileSync(CURRENCY_FILE, JSON.stringify(data, null, 2));
}

// ── 환율 업데이트 (매일 09:00) ────────────────────────
function updateExchangeRates() {
  const data = loadCurrency();
  const changes = [];

  for (const [code, info] of Object.entries(data.rates)) {
    if (code === 'USD') continue; // 기축통화 고정

    const volatility = info.volatility;
    const rand = (Math.random() - 0.5) * 2; // -1 ~ +1
    const changeRate = rand * volatility;
    const oldRate = info.rate;
    const newRate = parseFloat((oldRate * (1 + changeRate)).toFixed(4));

    // 기준값 ±20% 이상 벗어나지 않게 클램프
    const min = info.baseRate * 0.80;
    const max = info.baseRate * 1.20;
    data.rates[code].rate = Math.min(max, Math.max(min, newRate));

    const changePct = ((data.rates[code].rate - oldRate) / oldRate * 100).toFixed(3);
    changes.push({
      code,
      name: info.name,
      emoji: info.emoji,
      symbol: info.symbol,
      oldRate,
      newRate: data.rates[code].rate,
      changePct: parseFloat(changePct),
    });
  }

  data.lastUpdate = new Date().toISOString();
  saveCurrency(data);
  return changes;
}

// ── 환율 조회 ─────────────────────────────────────────
function getRate(currencyCode) {
  const data = loadCurrency();
  return data.rates[currencyCode]?.rate || 1;
}

// ── KRW → 해당 통화 변환 ─────────────────────────────
function krwToForeign(krwAmount, currencyCode) {
  if (currencyCode === 'KRW') return krwAmount;
  const krwPerUsd = getRate('KRW');
  const foreignPerUsd = getRate(currencyCode);
  // KRW → USD → foreign
  const usdAmount = krwAmount / krwPerUsd;
  return usdAmount * foreignPerUsd;
}

// ── 해당 통화 → KRW 변환 ─────────────────────────────
function foreignToKrw(amount, currencyCode) {
  if (currencyCode === 'KRW') return amount;
  const krwPerUsd = getRate('KRW');
  const foreignPerUsd = getRate(currencyCode);
  // foreign → USD → KRW
  const usdAmount = amount / foreignPerUsd;
  return usdAmount * krwPerUsd;
}

// ── 종목 카테고리 → 통화 코드 ─────────────────────────
function getCurrencyByCategory(category) {
  const data = loadCurrency();
  return data.countryCurrency[category] || 'KRW';
}

// ── 국가 정보 조회 ────────────────────────────────────
function getCountryInfo(category) {
  const data = loadCurrency();
  return data.countryInfo[category] || data.countryInfo['domestic'];
}

// ── 가격 포맷 (통화별) ────────────────────────────────
function formatPrice(amount, currencyCode) {
  const data = loadCurrency();
  const currency = data.rates[currencyCode];
  if (!currency) return `${amount.toLocaleString()}원`;

  switch (currencyCode) {
    case 'KRW':
      return `${Math.round(amount).toLocaleString()}원`;
    case 'USD':
      return `$${amount.toFixed(2)}`;
    case 'JPY':
      return `¥${Math.round(amount).toLocaleString()}`;
    case 'CNY':
      return `¥${amount.toFixed(2)}`;
    case 'EUR':
      return `€${amount.toFixed(2)}`;
    case 'GBP':
      return `£${amount.toFixed(2)}`;
    default:
      return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

// ── 자산 가격을 KRW로 표시 (원화 환산) ──────────────────
function formatPriceWithKrw(amount, currencyCode) {
  const formatted = formatPrice(amount, currencyCode);
  if (currencyCode === 'KRW') return formatted;
  const krwAmount = Math.round(foreignToKrw(amount, currencyCode));
  return `${formatted} (≈${krwAmount.toLocaleString()}원)`;
}

// ── 전체 환율 현황 ────────────────────────────────────
function getAllRates() {
  const data = loadCurrency();
  return data.rates;
}

module.exports = {
  loadCurrency,
  updateExchangeRates,
  getRate,
  krwToForeign,
  foreignToKrw,
  getCurrencyByCategory,
  getCountryInfo,
  formatPrice,
  formatPriceWithKrw,
  getAllRates,
};
