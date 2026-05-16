# 📊 Discord 가상 주식 시장 봇

실제 주식처럼 가상 회사와 코인에 투자하고, AI가 매일 생성하는 뉴스에 따라 시세가 변동하는 Discord 봇입니다.

---

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| 📊 실시간 시장 현황 | 주식 5종 + 코인 4종, 미니 차트 포함 |
| 📰 AI 일일 뉴스 | 매일 2~4건의 가상 뉴스 자동 생성 |
| 💹 뉴스 → 가격 연동 | 긍정/부정 뉴스에 따라 당일 가격 변동 |
| 💼 개인 포트폴리오 | 보유 종목, 손익, 수익률 조회 |
| 🏆 수익률 랭킹 | TOP 10 투자자 순위 |
| 🔧 관리자 도구 | 종목 생성/삭제, 가격 조정, 채널 설정 |
| 🎮 버튼 UI | 매수/매도 확인, 시장 필터 버튼 |

---

## 🏢 기본 종목 목록

### 주식 (Stock)
| 티커 | 이름 | 섹터 | 초기가 |
|------|------|------|--------|
| NXCORP | NexaCorp Technologies | 기술 | 48,500원 |
| SKYAIR | SkyAir Holdings | 항공 | 12,300원 |
| GREENRG | GreenEnergy Solutions | 에너지 | 33,800원 |
| MEDBIO | MedBio Pharma | 바이오 | 87,200원 |
| AUTODRV | AutoDrive Motors | 자동차 | 56,700원 |

### 코인 (Coin)
| 티커 | 이름 | 섹터 | 초기가 |
|------|------|------|--------|
| NXCOIN | NexaCoin | 레이어1 | 4,250원 |
| MOONX | MoonX | 밈코인 | 12원 |
| DATALINK | DataLink Protocol | 오라클 | 8,900원 |
| METAVRS | MetaVerse Token | 메타버스 | 2,340원 |

---

## 🎮 커맨드 목록

### 기본 명령어
```
/stock start              - 투자 시작 (초기 자금 1,000만원 지급)
/stock market             - 전체 시장 현황
/stock info [티커]        - 종목 상세 정보 + 관련 뉴스
/stock portfolio          - 내 포트폴리오
/stock portfolio [유저]   - 타인 포트폴리오 조회
/stock history            - 내 거래 내역
/stock rank               - 수익률 랭킹 TOP 10
/stock news               - 최근 뉴스 모음
/stock news [티커]        - 특정 종목 뉴스
```

### 거래 명령어
```
/buy [티커] [수량]         - 종목 매수 (확인 UI 포함)
/buy [티커] [수량] confirm - 바로 매수
/sell [티커] [수량]        - 종목 매도 (확인 UI 포함)
/sell [티커] 0            - 전량 매도
```

### 관리자 명령어 (Administrator 권한 필요)
```
/admin create [티커] [이름] [타입] [섹터] [가격] [설명]
/admin delete [티커]
/admin setprice [티커] [가격]
/admin update                  - 수동 시장 업데이트 + 뉴스 생성
/admin setchannel news [채널]  - 뉴스 발송 채널 설정
/admin setchannel stock [채널] - 시장 현황 발송 채널 설정
/admin setbalance [유저] [금액]
```

---

## ⚙️ 가격 변동 시스템

| 종류 | 일일 기본 변동폭 | 뉴스 영향 최대 |
|------|---------------|-------------|
| 일반 주식 | ±5% | ±15% |
| 바이오 주식 | ±8% | ±24% |
| 일반 코인 | ±10% | ±30% |
| 밈코인 (MOONX) | ±18% | ±54% |

---

## 🤖 뉴스 시스템

매일 **오전 9시** (KST) 자동 실행:
1. AI가 2~4개 종목에 대한 가상 뉴스 생성
2. 50% 확률로 시장 전체 영향 뉴스 추가
3. 뉴스 내용에 따라 당일 가격 변동에 반영

**뉴스 카테고리:**
- 📈 긍정: 어닝 서프라이즈, 파트너십, 신제품, 자사주 매입, FDA 승인
- 📉 부정: 실적 쇼크, 리콜, 공정위 조사, CEO 사임, 특허 분쟁
- 🪙 코인 긍정: 거래소 상장, 메인넷 업그레이드, 기관 매집
- 🪙 코인 부정: 해킹, 규제, 러그풀 의혹

---

## 📦 설치 방법

```bash
# 1. 의존성 설치
npm install

# 2. .env 설정
cp .env.example .env
# DISCORD_TOKEN, CLIENT_ID, GUILD_ID 입력

# 3. 슬래시 커맨드 등록
npm run deploy

# 4. 봇 실행
npm start
```

---

## 📁 파일 구조

```
discord-stock-bot/
├── index.js                      # 메인 + 버튼 핸들러
├── deploy-commands.js
├── package.json
├── data/
│   ├── market.json               # 종목 데이터 + 가격 히스토리
│   ├── users.json                # 유저 잔액 + 포트폴리오
│   ├── news.json                 # 뉴스 아카이브
│   └── config.json               # 채널 설정
├── commands/
│   ├── stock/
│   │   ├── stock.js              # /stock 서브커맨드들
│   │   └── trade.js              # /buy, /sell
│   └── admin/
│       └── admin.js              # /admin 관리자 커맨드
├── utils/
│   ├── marketManager.js          # 시장 데이터 + 거래 로직
│   ├── newsGenerator.js          # AI 뉴스 생성 엔진
│   └── stockEmbeds.js            # Discord UI 빌더
└── scheduler/
    └── marketScheduler.js        # 일일 자동 업데이트 (cron)
```
