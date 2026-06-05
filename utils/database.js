const { MongoClient } = require('mongodb');

// ── MongoDB 연결 ───────────────────────────────────────
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = 'vireon';

let client = null;
let db = null;

async function connect() {
  if (db) return db;
  try {
    // URI에 SSL 파라미터 추가
    const uri = MONGO_URI.includes('?')
      ? MONGO_URI + '&tls=true&tlsAllowInvalidCertificates=true&retryWrites=true&w=majority'
      : MONGO_URI + '?tls=true&tlsAllowInvalidCertificates=true&retryWrites=true&w=majority';
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 10000,
    });
    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ MongoDB 연결 완료!');
    return db;
  } catch (e) {
    console.error('❌ MongoDB 연결 실패:', e.message);
    throw e;
  }
}

// ── users 컬렉션 ──────────────────────────────────────
async function getUsers() {
  const database = await connect();
  const col = database.collection('users');
  const docs = await col.find({}).toArray();
  const result = {};
  for (const doc of docs) {
    const { _id, userId, ...data } = doc;
    result[userId] = data;
  }
  return result;
}

async function saveUsers(usersObj) {
  const database = await connect();
  const col = database.collection('users');
  const ops = Object.entries(usersObj).map(([userId, data]) => ({
    updateOne: {
      filter: { userId },
      update: { $set: { userId, ...data } },
      upsert: true,
    }
  }));
  if (ops.length > 0) await col.bulkWrite(ops);
}

async function getUser(userId) {
  const database = await connect();
  const col = database.collection('users');
  const doc = await col.findOne({ userId });
  if (!doc) return null;
  const { _id, userId: uid, ...data } = doc;
  return data;
}

async function saveUser(userId, data) {
  const database = await connect();
  const col = database.collection('users');
  await col.updateOne(
    { userId },
    { $set: { userId, ...data } },
    { upsert: true }
  );
}

// ── market 컬렉션 ─────────────────────────────────────
async function getMarket() {
  const database = await connect();
  const col = database.collection('market');
  const doc = await col.findOne({ _id: 'market' });
  if (!doc) {
    return { companies: {}, coins: {}, lastUpdate: null, totalTradingDays: 0 };
  }
  const { _id, ...data } = doc;
  return data;
}

async function saveMarket(marketData) {
  const database = await connect();
  const col = database.collection('market');
  await col.updateOne(
    { _id: 'market' },
    { $set: { _id: 'market', ...marketData } },
    { upsert: true }
  );
}

// ── news 컬렉션 ───────────────────────────────────────
async function getNews() {
  const database = await connect();
  const col = database.collection('news');
  const docs = await col.find({}).sort({ publishedAt: -1 }).limit(100).toArray();
  return docs.map(({ _id, ...d }) => d);
}

async function saveNews(newsArr) {
  const database = await connect();
  const col = database.collection('news');
  await col.deleteMany({});
  if (newsArr.length > 0) await col.insertMany(newsArr);
}

// ── config 컬렉션 ─────────────────────────────────────
async function getConfig() {
  const database = await connect();
  const col = database.collection('config');
  const doc = await col.findOne({ _id: 'config' });
  if (!doc) {
    return {
      startingBalance: 10000000,
      newsChannelId: null,
      stockChannelId: null,
      adminRoleId: null,
    };
  }
  const { _id, ...data } = doc;
  return data;
}

async function saveConfig(configData) {
  const database = await connect();
  const col = database.collection('config');
  await col.updateOne(
    { _id: 'config' },
    { $set: { _id: 'config', ...configData } },
    { upsert: true }
  );
}

// ── mining inventory 컬렉션 ───────────────────────────
async function getMiningInventory() {
  const database = await connect();
  const col = database.collection('mining');
  const docs = await col.find({}).toArray();
  const result = {};
  for (const doc of docs) {
    const { _id, userId, ...data } = doc;
    result[userId] = data;
  }
  return result;
}

async function saveMiningUser(userId, data) {
  const database = await connect();
  const col = database.collection('mining');
  await col.updateOne(
    { userId },
    { $set: { userId, ...data } },
    { upsert: true }
  );
}

// ── credit 컬렉션 ─────────────────────────────────────
async function getCredit() {
  const database = await connect();
  const col = database.collection('credit');
  const docs = await col.find({}).toArray();
  const result = {};
  for (const doc of docs) {
    const { _id, userId, ...data } = doc;
    result[userId] = data;
  }
  return result;
}

async function saveCreditUser(userId, data) {
  const database = await connect();
  const col = database.collection('credit');

  // 중첩 필드(savings, loans)를 dot notation으로 풀어서 $set — 덮어쓰기 방지
  const flatSet = { userId };
  for (const [key, value] of Object.entries(data)) {
    if (key === 'savings' && value && typeof value === 'object') {
      for (const [field, val] of Object.entries(value)) {
        flatSet[`savings.${field}`] = val;
      }
    } else {
      flatSet[key] = value;
    }
  }

  await col.updateOne(
    { userId },
    { $set: flatSet },
    { upsert: true }
  );
}

// ── currency 컬렉션 ──────────────────────────────────
async function getCurrency() {
  const database = await connect();
  const col = database.collection('currency');
  const doc = await col.findOne({ _id: 'currency' });
  if (!doc) return null;
  const { _id, ...data } = doc;
  return data;
}

async function saveCurrency(currencyData) {
  const database = await connect();
  const col = database.collection('currency');
  await col.updateOne(
    { _id: 'currency' },
    { $set: { _id: 'currency', ...currencyData } },
    { upsert: true }
  );
}

// ── pending delist 컬렉션 ─────────────────────────────
async function getPendingDelist() {
  const database = await connect();
  const col = database.collection('pending_delist');
  return col.find({}).toArray();
}

async function savePendingDelist(arr) {
  const database = await connect();
  const col = database.collection('pending_delist');
  await col.deleteMany({});
  if (arr.length > 0) await col.insertMany(arr);
}

// ── pending news 컬렉션 ───────────────────────────────
async function getPendingNews() {
  const database = await connect();
  const col = database.collection('pending_news');
  return col.find({}).toArray();
}

async function savePendingNews(arr) {
  const database = await connect();
  const col = database.collection('pending_news');
  await col.deleteMany({});
  if (arr.length > 0) await col.insertMany(arr);
}

// ── fake pending 컬렉션 ───────────────────────────────
async function getFakePending() {
  const database = await connect();
  const col = database.collection('fake_pending');
  return col.find({}).toArray();
}

async function saveFakePending(arr) {
  const database = await connect();
  const col = database.collection('fake_pending');
  await col.deleteMany({});
  if (arr.length > 0) await col.insertMany(arr);
}

module.exports = {
  connect,
  getUsers, saveUsers, getUser, saveUser,
  getMarket, saveMarket,
  getNews, saveNews,
  getConfig, saveConfig,
  getMiningInventory, saveMiningUser,
  getCredit, saveCreditUser,
  getPendingDelist, savePendingDelist,
  getCurrency, saveCurrency,
  getPendingNews, savePendingNews,
  getFakePending, saveFakePending,
};
