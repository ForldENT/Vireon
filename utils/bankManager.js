const fs = require('fs');
const path = require('path');

const BANK_DATA_FILE = path.join(__dirname, '../data/bank_data.json');
const CREDIT_FILE = path.join(__dirname, '../data/credit.json');

function loadBankData() {
  return JSON.parse(fs.readFileSync(BANK_DATA_FILE, 'utf8'));
}

function loadCredit() {
  if (!fs.existsSync(CREDIT_FILE)) {
    fs.mkdirSync(path.dirname(CREDIT_FILE), { recursive: true });
    fs.writeFileSync(CREDIT_FILE, '{}');
  }
  return JSON.parse(fs.readFileSync(CREDIT_FILE, 'utf8'));
}

function saveCredit(data) {
  fs.writeFileSync(CREDIT_FILE, JSON.stringify(data, null, 2));
}

// ── 신용 초기화 ───────────────────────────────────────
function ensureCredit(userId) {
  const credit = loadCredit();
  if (!credit[userId]) {
    credit[userId] = {
      grade: 5,
      score: 500,
      loans: [],
      totalBorrowed: 0,
      totalRepaid: 0,
      defaultCount: 0,
      onTimeCount: 0,
      createdAt: new Date().toISOString(),
    };
    saveCredit(credit);
  }
  return credit[userId];
}

// ── 신용등급 계산 ─────────────────────────────────────
function calculateGrade(score) {
  if (score >= 900) return 1;
  if (score >= 800) return 2;
  if (score >= 700) return 3;
  if (score >= 600) return 4;
  if (score >= 400) return 5;
  if (score >= 200) return 6;
  return 7;
}

// ── 신용 조회 ─────────────────────────────────────────
function getCreditInfo(userId) {
  ensureCredit(userId);
  const credit = loadCredit();
  const bankData = loadBankData();
  const userData = credit[userId];
  const gradeInfo = bankData.creditGrades[userData.grade.toString()];

  return {
    ...userData,
    gradeInfo,
    activeLoan: userData.loans.find(l => l.status === 'active') || null,
  };
}

// ── 대출 신청 ─────────────────────────────────────────
function applyLoan(userId, amount) {
  ensureCredit(userId);
  const credit = loadCredit();
  const bankData = loadBankData();
  const userData = credit[userId];
  const gradeInfo = bankData.creditGrades[userData.grade.toString()];

  if (gradeInfo.maxLoan === 0) {
    return { success: false, message: '신용등급이 너무 낮아 대출이 불가해요! (7등급)' };
  }

  // 기존 대출 확인
  const activeLoan = userData.loans.find(l => l.status === 'active');
  if (activeLoan) {
    return { success: false, message: `이미 진행 중인 대출이 있어요!\n미상환 금액: **${activeLoan.remaining.toLocaleString()}원**` };
  }

  if (amount > gradeInfo.maxLoan) {
    return { success: false, message: `신용등급 ${userData.grade}등급 최대 대출 한도는 **${gradeInfo.maxLoan.toLocaleString()}원**이에요!` };
  }

  if (amount < 100000) {
    return { success: false, message: '최소 대출 금액은 **10만원**이에요!' };
  }

  const interest = Math.floor(amount * gradeInfo.interestRate);
  const totalRepay = amount + interest;
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30일 후

  const loan = {
    id: Date.now(),
    amount,
    interest,
    totalRepay,
    remaining: totalRepay,
    interestRate: gradeInfo.interestRate,
    borrowedAt: new Date().toISOString(),
    dueDate,
    status: 'active',
  };

  userData.loans.push(loan);
  userData.totalBorrowed += amount;
  userData.score = Math.max(0, userData.score - 2);
  userData.grade = calculateGrade(userData.score);

  saveCredit(credit);

  // 잔액 지급
  const { loadUsers, saveUsers } = require('./marketManager');
  const users = loadUsers();
  if (users[userId]) {
    users[userId].balance += amount;
    saveUsers(users);
  }

  return {
    success: true,
    loan,
    gradeInfo,
    message: `✅ **${amount.toLocaleString()}원** 대출 완료!\n💰 이자: **${interest.toLocaleString()}원**\n💵 총 상환액: **${totalRepay.toLocaleString()}원**\n📅 만기일: <t:${Math.floor(new Date(dueDate).getTime() / 1000)}:D>`,
  };
}

// ── 대출 상환 ─────────────────────────────────────────
function repayLoan(userId, amount) {
  ensureCredit(userId);
  const credit = loadCredit();
  const userData = credit[userId];

  const activeLoan = userData.loans.find(l => l.status === 'active');
  if (!activeLoan) {
    return { success: false, message: '상환할 대출이 없어요!' };
  }

  const { loadUsers, saveUsers } = require('./marketManager');
  const users = loadUsers();
  if (!users[userId] || users[userId].balance < amount) {
    return { success: false, message: `잔액이 부족해요! 보유: **${(users[userId]?.balance || 0).toLocaleString()}원**` };
  }

  if (amount > activeLoan.remaining) {
    amount = activeLoan.remaining;
  }

  users[userId].balance -= amount;
  activeLoan.remaining -= amount;

  const now = new Date();
  const dueDate = new Date(activeLoan.dueDate);
  const isOnTime = now <= dueDate;

  if (activeLoan.remaining <= 0) {
    activeLoan.status = 'repaid';
    activeLoan.repaidAt = now.toISOString();

    if (isOnTime) {
      userData.score = Math.min(1000, userData.score + 10);
      userData.onTimeCount += 1;
    } else {
      userData.score = Math.max(0, userData.score - 5);
    }
    userData.totalRepaid += activeLoan.amount;
    userData.grade = calculateGrade(userData.score);
  }

  saveUsers(users);
  saveCredit(credit);

  return {
    success: true,
    repaid: amount,
    remaining: activeLoan.remaining,
    isFullyRepaid: activeLoan.remaining <= 0,
    isOnTime,
    newGrade: userData.grade,
    newScore: userData.score,
  };
}

// ── 연체 처리 (스케줄러에서 호출) ────────────────────
function processOverdueLoans() {
  const credit = loadCredit();
  const now = new Date();
  const results = [];

  for (const [userId, userData] of Object.entries(credit)) {
    const activeLoan = userData.loans.find(l => l.status === 'active');
    if (!activeLoan) continue;

    const dueDate = new Date(activeLoan.dueDate);
    if (now > dueDate) {
      // 연체 처리
      activeLoan.status = 'defaulted';
      userData.score = Math.max(0, userData.score - 30);
      userData.defaultCount = (userData.defaultCount || 0) + 1;
      userData.grade = calculateGrade(userData.score);

      // 잔액에서 강제 차감 가능하면 차감
      const { loadUsers, saveUsers } = require('./marketManager');
      const users = loadUsers();
      if (users[userId] && users[userId].balance >= activeLoan.remaining) {
        users[userId].balance -= activeLoan.remaining;
        activeLoan.remaining = 0;
        activeLoan.status = 'repaid';
        activeLoan.repaidAt = now.toISOString();
        saveUsers(users);
      }

      results.push({ userId, loan: activeLoan });
    }
  }

  saveCredit(credit);
  return results;
}

module.exports = {
  ensureCredit,
  getCreditInfo,
  applyLoan,
  repayLoan,
  processOverdueLoans,
  loadBankData,
  calculateGrade,
};
