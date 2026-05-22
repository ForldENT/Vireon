const fs = require('fs');
const path = require('path');
const { getAllAssets, loadNews, saveNews } = require('./marketManager');

// ── 뉴스 템플릿 ───────────────────────────────────────
const NEWS_TEMPLATES = {
  // 긍정 뉴스 (impact: 0.2 ~ 0.8)
  positive: [
    {
      template: '{name}, 3분기 실적 어닝 서프라이즈...영업이익 전년比 {pct}% 급등',
      detail: '{name}이(가) 시장 예상치를 크게 웃도는 3분기 실적을 발표했다. 주력 사업부의 매출이 전년 동기 대비 {pct}% 성장했으며, 영업이익률도 개선되었다고 밝혔다.',
      impact: () => +(Math.random() * 0.4 + 0.3).toFixed(2),
      pct: () => Math.floor(Math.random() * 40 + 15),
    },
    {
      template: '{name}, 글로벌 {partner}와 대규모 전략적 파트너십 체결',
      detail: '{name}은(는) {partner}와의 파트너십을 통해 해외 시장 공략을 본격화할 예정이다. 양사는 향후 5년간 공동 연구개발 및 시장 확대에 협력할 예정이다.',
      impact: () => +(Math.random() * 0.3 + 0.2).toFixed(2),
      partners: ['마이크로소프트', 'NVIDIA', '삼성전자', '소프트뱅크', '아마존', 'TSMC', '애플'],
      pct: () => 0,
    },
    {
      template: '{name} 신제품 출시...업계 "게임 체인저" 평가',
      detail: '{name}이(가) 업계 판도를 바꿀 혁신 제품을 공개했다. 전문가들은 해당 제품이 기존 경쟁 제품 대비 성능이 월등히 뛰어나다며 긍정적인 평가를 쏟아냈다.',
      impact: () => +(Math.random() * 0.3 + 0.15).toFixed(2),
      pct: () => 0,
    },
    {
      template: '{name}, 자사주 {pct}% 매입 소각 결정...주주 환원 확대',
      detail: '{name} 이사회는 주주가치 제고를 위해 발행 주식의 {pct}%에 해당하는 자사주 매입 후 소각을 결의했다. 시장은 이를 강한 호재로 받아들이고 있다.',
      impact: () => +(Math.random() * 0.25 + 0.1).toFixed(2),
      pct: () => Math.floor(Math.random() * 8 + 3),
    },
    {
      template: '{name}, FDA(식약처) 신약 승인 획득...블록버스터 기대',
      detail: '{name}이(가) 개발 중인 핵심 파이프라인이 규제 당국으로부터 최종 승인을 받았다. 연간 매출 수조원대 블록버스터 탄생이 예상된다.',
      impact: () => +(Math.random() * 0.5 + 0.3).toFixed(2),
      pct: () => 0,
    },
  ],

  // 부정 뉴스 (impact: -0.8 ~ -0.2)
  negative: [
    {
      template: '{name}, 실적 쇼크...순이익 {pct}% 급감에 주가 하락 우려',
      detail: '{name}이(가) 시장 예상치를 크게 하회하는 분기 실적을 발표했다. 주요 사업부의 수익성이 악화되며 투자자들의 실망 매물이 나올 것으로 예상된다.',
      impact: () => -(Math.random() * 0.35 + 0.2).toFixed(2),
      pct: () => Math.floor(Math.random() * 35 + 10),
    },
    {
      template: '{name}, 대규모 리콜 사태...소비자 신뢰 타격',
      detail: '{name}의 주력 제품에서 심각한 결함이 발견되어 대규모 리콜 조치가 내려졌다. 리콜 비용과 브랜드 손상에 따른 실적 악화가 우려된다.',
      impact: () => -(Math.random() * 0.3 + 0.15).toFixed(2),
      pct: () => 0,
    },
    {
      template: '{name}, 공정위 담합 혐의 조사 착수...수천억 과징금 가능성',
      detail: '규제 당국이 {name}에 대한 불공정 거래 혐의 조사를 개시했다. 업계 전문가들은 최대 수천억원대 과징금이 부과될 수 있다고 우려한다.',
      impact: () => -(Math.random() * 0.25 + 0.1).toFixed(2),
      pct: () => 0,
    },
    {
      template: '{name} CEO 갑작스런 사임...경영 불확실성 확대',
      detail: '{name}의 최고경영자가 건강상의 이유를 들어 전격 사임을 발표했다. 후임 CEO 선임 전까지 경영 공백에 대한 우려가 시장에 퍼지고 있다.',
      impact: () => -(Math.random() * 0.2 + 0.1).toFixed(2),
      pct: () => 0,
    },
    {
      template: '{name}, 핵심 기술 특허 분쟁 패소...{pct}억원 배상 판결',
      detail: '법원은 {name}이(가) 경쟁사의 핵심 특허를 침해했다고 판결했다. 이번 판결로 {pct}억원 이상의 손해배상금을 지급해야 할 것으로 보인다.',
      impact: () => -(Math.random() * 0.2 + 0.1).toFixed(2),
      pct: () => Math.floor(Math.random() * 900 + 100),
    },
  ],

  // 코인 전용 뉴스
  coin_positive: [
    {
      template: '{name}, 주요 거래소 신규 상장...유동성 급증 기대',
      detail: '{name}이(가) 글로벌 주요 거래소에 신규 상장했다. 상장 직후 거래량이 폭발적으로 증가했으며, 더 많은 투자자들이 유입될 것으로 예상된다.',
      impact: () => +(Math.random() * 0.5 + 0.2).toFixed(2),
      pct: () => 0,
    },
    {
      template: '{name} 메인넷 업그레이드 완료...TPS {pct}배 향상',
      detail: '{name} 개발팀은 메인넷 대규모 업그레이드를 성공적으로 완료했다. 초당 처리 가능한 트랜잭션 수가 기존 대비 {pct}배 증가해 확장성 문제가 해결됐다.',
      impact: () => +(Math.random() * 0.4 + 0.15).toFixed(2),
      pct: () => Math.floor(Math.random() * 8 + 3),
    },
    {
      template: '기관투자자들 {name} 대규모 매집...고래 지갑 잔고 급증',
      detail: '온체인 데이터에 따르면 대형 기관 지갑들이 {name}을(를) 공격적으로 매수하고 있는 것으로 확인됐다. 스마트 머니 유입이 상승 모멘텀을 강화할 것으로 기대된다.',
      impact: () => +(Math.random() * 0.35 + 0.15).toFixed(2),
      pct: () => 0,
    },
  ],

  coin_negative: [
    {
      template: '해커, {name} 브리지 공격...{pct}억원 상당 탈취',
      detail: '보안 전문가들은 {name} 크로스체인 브리지에서 취약점이 발견됐다고 경고했다. 해커들이 {pct}억원 상당의 자산을 탈취하는 데 성공했으며, 개발팀은 긴급 패치 작업에 돌입했다.',
      impact: () => -(Math.random() * 0.45 + 0.2).toFixed(2),
      pct: () => Math.floor(Math.random() * 400 + 50),
    },
    {
      template: '규제 당국, {name} 증권성 판단...상장폐지 가능성 우려',
      detail: '금융 당국이 {name}을(를) 증권으로 분류할 수 있다는 가이드라인을 발표했다. 이 경우 국내 거래소에서의 상장폐지가 불가피할 것으로 우려된다.',
      impact: () => -(Math.random() * 0.4 + 0.2).toFixed(2),
      pct: () => 0,
    },
    {
      template: '{name} 개발팀 "러그풀" 의혹...팀 지갑 대량 매도 포착',
      detail: '온체인 분석가들이 {name} 팀 관련 지갑에서 대규모 매도 흐름을 포착했다. 커뮤니티는 개발팀의 설명을 요구하며 강한 의혹을 제기하고 있다.',
      impact: () => -(Math.random() * 0.5 + 0.25).toFixed(2),
      pct: () => 0,
    },
  ],

  // 시장 전체 영향 뉴스
  market: [
    {
      template: '연준, 기준금리 동결...시장 안도 랠리 기대',
      detail: '미국 연방준비제도가 기준금리를 현 수준에서 동결했다. 이 결정은 시장의 기대에 부합하는 것으로, 전반적인 위험자산 선호 심리가 개선될 것으로 전망된다.',
      marketImpact: 0.03,
    },
    {
      template: '글로벌 경기침체 우려 확산...투자심리 급랭',
      detail: '주요 국가의 제조업 PMI가 연속 하락하며 경기침체 우려가 커지고 있다. 안전자산 선호 현상이 강화되면서 위험자산 전반에 매도 압력이 가중되고 있다.',
      marketImpact: -0.03,
    },
    {
      template: '빅테크 AI 투자 확대 발표...기술주 동반 상승',
      detail: '글로벌 빅테크 기업들이 인공지능 인프라에 대한 대규모 추가 투자 계획을 연이어 발표했다. AI 관련 섹터 전반에 투자 훈풍이 불 것으로 전망된다.',
      marketImpact: 0.025,
    },
    {
      template: '국제유가 급등...에너지 인플레이션 재점화 우려',
      detail: '중동 지역의 지정학적 불안이 심화되면서 국제유가가 급등했다. 에너지 비용 상승이 기업 실적에 부담을 줄 것이라는 우려가 시장 전반에 퍼지고 있다.',
      marketImpact: -0.02,
    },
  ],
};

// ── 뉴스 생성 엔진 ────────────────────────────────────
async function generateDailyNews() {
  const assets = getAllAssets();
  const tickers = Object.keys(assets);
  const generatedNews = [];
  const newsImpacts = {}; // ticker -> impact

  // 각 뉴스에 영향받을 티커 선택 (2~4개)
  const count = Math.floor(Math.random() * 3) + 2;
  const chosen = [...tickers].sort(() => Math.random() - 0.5).slice(0, count);

  for (const ticker of chosen) {
    const asset = assets[ticker];
    const isPositive = Math.random() > 0.45; // 약간 긍정 편향

    let pool;
    if (asset.type === 'coin') {
      pool = isPositive ? NEWS_TEMPLATES.coin_positive : NEWS_TEMPLATES.coin_negative;
    } else {
      pool = isPositive ? NEWS_TEMPLATES.positive : NEWS_TEMPLATES.negative;
    }

    const template = pool[Math.floor(Math.random() * pool.length)];
    const impact = parseFloat(template.impact());
    const pct = template.pct ? template.pct() : 0;
    const partner = template.partners
      ? template.partners[Math.floor(Math.random() * template.partners.length)]
      : '';

    const title = template.template
      .replace(/{name}/g, asset.name)
      .replace(/{pct}/g, pct)
      .replace(/{partner}/g, partner);

    const body = template.detail
      .replace(/{name}/g, asset.name)
      .replace(/{pct}/g, pct)
      .replace(/{partner}/g, partner);

    // 뉴스 즉시 영향: 20%만 즉시 반영, 80%는 다음 업데이트에서 80% 확률로 적용
    const immediateImpact = impact * 0.20;
    newsImpacts[ticker] = immediateImpact;

    // 나머지 80% 영향을 pending으로 저장
    try {
      const dbModule = require('./database');
      const existingPending = await dbModule.getPendingNews().catch(() => []);
      existingPending.push({
        ticker,
        impact: impact * 0.80,
        applyChance: 0.80,
        scheduledAt: new Date().toISOString(),
      });
      await dbModule.savePendingNews(existingPending).catch(() => {});
    } catch (e) {
      console.error('뉴스 예약 저장 오류:', e.message);
    }

    generatedNews.push({
      id: Date.now() + Math.random(),
      ticker,
      assetName: asset.name,
      assetEmoji: asset.emoji,
      type: asset.type,
      title,
      body,
      impact,
      isPositive: impact > 0,
      publishedAt: new Date().toISOString(),
    });
  }

  // ── 예약된 뉴스 영향 적용 (80% 확률) ─────────────────
  try {
    const pendingNewsFile = path.join(__dirname, '../data/pending_news.json');
    if (fs.existsSync(pendingNewsFile)) {
      const pendingNews = JSON.parse(fs.readFileSync(pendingNewsFile, 'utf8'));
      const now = new Date();
      const toApply = [];
      const remaining = [];

      for (const item of pendingNews) {
        const scheduled = new Date(item.scheduledAt);
        const hoursDiff = (now - scheduled) / (1000 * 60 * 60);
        if (hoursDiff >= 1) {
          toApply.push(item);
        } else {
          remaining.push(item);
        }
      }

      for (const item of toApply) {
        // 80% 확률로 실제 적용
        if (Math.random() < item.applyChance) {
          newsImpacts[item.ticker] = (newsImpacts[item.ticker] || 0) + item.impact;
        }
      }

      fs.writeFileSync(pendingNewsFile, JSON.stringify(remaining, null, 2));
    }
  } catch (e) {
    console.error('뉴스 예약 적용 오류:', e.message);
  }

  // 시장 전체 뉴스 (50% 확률)
  if (Math.random() > 0.5) {
    const marketNews = NEWS_TEMPLATES.market[Math.floor(Math.random() * NEWS_TEMPLATES.market.length)];
    generatedNews.push({
      id: Date.now() + 9999,
      ticker: 'MARKET',
      assetName: '시장 전체',
      assetEmoji: '📊',
      type: 'market',
      title: marketNews.template,
      body: marketNews.detail,
      impact: marketNews.marketImpact,
      isPositive: marketNews.marketImpact > 0,
      publishedAt: new Date().toISOString(),
    });

    // 시장 뉴스는 모든 종목에 소폭 영향
    for (const ticker of tickers) {
      newsImpacts[ticker] = (newsImpacts[ticker] || 0) + marketNews.marketImpact;
    }
  }

  // ── 가짜 뉴스 (2% 확률) ────────────────────────────
  // 긍정적으로 보이지만 다음 날 하락장을 유발하는 뉴스
  if (Math.random() < 0.02) {
    const fakeTickers = [...tickers].sort(() => Math.random() - 0.5).slice(0, 1);
    const fakeTicker = fakeTickers[0];
    const fakeAsset = assets[fakeTicker];

    const FAKE_NEWS_TEMPLATES = [
      {
        title: `[단독] ${fakeAsset?.name}, 대형 글로벌 기업과 비밀 인수합병 협상 중`,
        body: `업계 소식통에 따르면 ${fakeAsset?.name}이(가) 글로벌 대형 기업과 수조원 규모의 인수합병 협상을 극비리에 진행 중인 것으로 알려졌다. 협상이 성사될 경우 주가에 큰 호재가 될 전망이다.`,
      },
      {
        title: `${fakeAsset?.name}, 차세대 혁신 기술 개발 완료...내일 공식 발표 예정`,
        body: `${fakeAsset?.name} 내부 관계자에 따르면 업계 판도를 뒤바꿀 혁신 기술 개발이 완료되어 내일 공식 발표를 앞두고 있다고 전해졌다. 시장 전문가들은 주가 급등을 예상하고 있다.`,
      },
      {
        title: `[긴급] ${fakeAsset?.name} 정부 대규모 지원 사업 최종 선정`,
        body: `정부가 추진하는 대규모 국책 사업의 최종 수행 기관으로 ${fakeAsset?.name}이(가) 선정된 것으로 알려졌다. 수천억원 규모의 지원금이 지급될 예정이다.`,
      },
      {
        title: `${fakeAsset?.name}, 해외 유명 투자사 대규모 지분 매입 포착`,
        body: `글로벌 헤지펀드가 ${fakeAsset?.name}의 지분을 대량 매입하고 있는 정황이 포착됐다. 스마트머니의 집중 매수는 향후 주가 상승의 강력한 신호라는 분석이다.`,
      },
    ];

    const fakeTemplate = FAKE_NEWS_TEMPLATES[Math.floor(Math.random() * FAKE_NEWS_TEMPLATES.length)];

    // 가짜 뉴스: 오늘은 긍정적으로 보이지만 실제 impact는 다음 업데이트 때 하락
    // 오늘 impact는 소폭 상승처럼 보이게 (+0.05~0.1)
    // 내일 영향을 위해 pendingFakeImpact 저장
    const fakeImpactToday = +(Math.random() * 0.05 + 0.03).toFixed(2);

    // 다음 업데이트에 반영될 하락 예약 저장
    try {
      const fakePendingFile = path.join(__dirname, '../data/fake_pending.json');
      const existing_fake = fs.existsSync(fakePendingFile)
        ? JSON.parse(fs.readFileSync(fakePendingFile, 'utf8'))
        : [];
      existing_fake.push({
        ticker: fakeTicker,
        impact: -(Math.random() * 0.15 + 0.10), // 다음 업데이트 때 -10~25% 하락
        scheduledAt: new Date().toISOString(),
      });
      fs.writeFileSync(fakePendingFile, JSON.stringify(existing_fake, null, 2));
    } catch (e) {
      console.error('가짜 뉴스 예약 저장 오류:', e.message);
    }

    newsImpacts[fakeTicker] = (newsImpacts[fakeTicker] || 0) + fakeImpactToday;

    generatedNews.push({
      id: Date.now() + 7777,
      ticker: fakeTicker,
      assetName: fakeAsset?.name || fakeTicker,
      assetEmoji: fakeAsset?.emoji || '📰',
      type: 'fake',
      title: `📰 ${fakeTemplate.title}`,
      body: `${fakeTemplate.body}\n\n⚠️ *본 뉴스는 미확인 소식통 기반이며 투자에 참고만 하시기 바랍니다.*`,
      impact: fakeImpactToday,
      isPositive: true,
      isFake: true,
      publishedAt: new Date().toISOString(),
    });
  }

  // ── 가짜 뉴스 하락 반영 ──────────────────────────────
  try {
    const dbModule3 = require('./database');
    const pendingFakes = await dbModule3.getFakePending().catch(() => []);
    const now = new Date();
    const toApply = [];
    const remaining = [];

    for (const item of pendingFakes) {
      const scheduled = new Date(item.scheduledAt);
      const hoursDiff = (now - scheduled) / (1000 * 60 * 60);
      if (hoursDiff >= 1) {
        toApply.push(item);
      } else {
        remaining.push(item);
      }
    }

    for (const item of toApply) {
      newsImpacts[item.ticker] = (newsImpacts[item.ticker] || 0) + item.impact;
    }

    await dbModule3.saveFakePending(remaining).catch(() => {});
  } catch (e) {
    console.error('가짜 뉴스 하락 반영 오류:', e.message);
  }

  // 뉴스 저장 (최근 100개 유지)
  const existing = loadNews();
  const updated = [...generatedNews, ...existing].slice(0, 100);
  saveNews(updated);

  return { news: generatedNews, impacts: newsImpacts };
}

// ── 최근 뉴스 조회 ────────────────────────────────────
function getRecentNews(limit = 10) {
  return loadNews().slice(0, limit);
}

function getNewsByTicker(ticker) {
  return loadNews().filter(n => n.ticker === ticker.toUpperCase()).slice(0, 5);
}

module.exports = {
  generateDailyNews,
  getRecentNews,
  getNewsByTicker,
};
