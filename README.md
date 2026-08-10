# FakeTheater 電影購票系統

全端電影購票系統。後端 Node.js + Express + SQLite，前端原生 JavaScript + Bootstrap 5，無打包工具。

售票系統真正的難題不是畫面，而是**兩個人同時搶最後一個位子時會發生什麼事**。
這個專案把該問題當作核心來處理：座位保留、交易隔離、資料庫唯一約束三層防護，並有測試證明它擋得住。

## 快速開始

```bash
npm install
npm start
# 開啟 http://localhost:3000
```

第一次啟動會自動建立 SQLite 資料庫、匯入電影資料、建立展示帳號，並排入未來 7 天的場次。
之後每次啟動都會補齊場次，所以隔幾週再打開也不會變成空的。

### 展示帳號

| 帳號 | 密碼 | 初始餘額 |
|---|---|---|
| `demo` | `demo123` | 2000 |
| `johndoe` | `password123` | 1000 |
| `janedoe` | `securepass` | 500 |

密碼在匯入時就會經過 bcrypt hash，資料庫裡沒有明文。

### 執行測試

```bash
npx playwright install chromium   # 只有第一次需要
npm test          # 後端 44 項 + 瀏覽器 53 項
npm run test:api  # 只跑後端
npm run test:e2e  # 只跑瀏覽器
```

兩份測試都會各自建立一個暫存資料庫，不會動到開發資料。

## 專案結構

```
server/                 後端
  index.js              啟動點
  app.js                Express 組裝與資料庫初始化
  config.js             設定（port、JWT、鎖定時效…）
  db/
    schema.sql          資料表定義
    index.js            連線、WAL、交易輔助
    seed.js             匯入種子資料、排片
  middleware/           JWT 驗證、錯誤處理
  routes/               API 端點
  services/             座位鎖定與訂票的核心邏輯
  utils/                日期、HTTP 錯誤

FakeTheater/            前端（由 Express 直接提供）
  *.html                六個頁面
  js/api.js             API client，前端唯一對外的資料入口
  js/auth.js            登入狀態與錢包
  js/booking.js         訂票頁
  js/checkout-sidebar.js結帳側邊欄
  js/wallet-sidebar.js  票夾
  css/custom.css        深色主題與所有自訂樣式
  data/*.json           種子資料來源

tests/
  api.js                後端整合測試（含並發）
  e2e.js                瀏覽器端對端測試
```

## 座位並發控制

三層防護，由外到內：

**第一層：選位保留（seat_locks）**
按下「確認購票」時，伺服器會把座位寫入 `seat_locks` 並給 5 分鐘期限。
在這段時間內其他人看到的就是「他人選位中」，選不下去。
結帳側邊欄會顯示倒數，時間到自動放棄；使用者主動關閉也會立刻歸還。
過期的鎖不需要背景排程清理——每次查詢或鎖定前會先刪掉過期列。

**第二層：交易隔離（BEGIN IMMEDIATE）**
付款時「檢查座位 → 檢查餘額 → 扣款 → 建立訂單 → 寫入座位 → 記錄交易 → 釋放鎖」
全部在同一筆 `BEGIN IMMEDIATE` 交易內完成。`IMMEDIATE` 在交易開始時就取得寫入鎖，
避免兩筆交易都讀完才發現要寫同一列。任何一步失敗整筆回滾，
不會出現「扣了錢沒有票」或「有票沒扣錢」。

**第三層：資料庫唯一約束**
```sql
UNIQUE (showtime_id, seat_row, seat_col)   -- booking_seats
```
就算前兩層都被繞過，資料庫也不可能讓同一個位子存在兩筆。
這是唯一不依賴應用層邏輯正確性的保證。

### 測試怎麼證明

`tests/api.js` 最後兩段：

- **20 個 HTTP 請求同時搶同一個座位** → 恰好 1 個回 201，其餘 19 個回 409
- **4 個獨立的 Node 行程同時寫入同一個座位** → 仍然只有 1 個成功

第二個測試特別重要：Node 是單執行緒，單一行程內的測試無法排除「只是剛好沒有真的並行」。
用多行程直接打同一個資料庫檔案，驗證的才是資料庫層的保證。

## 安全性設計

| 項目 | 作法 |
|---|---|
| 密碼 | bcrypt hash（cost 10），資料庫無明文 |
| 認證 | JWT Bearer token，有效期 7 天 |
| 餘額 | 一律以資料庫為準，前端傳來的金額完全不採信 |
| 授權 | 票券、交易紀錄都以 token 中的使用者為範圍查詢 |
| 錯誤訊息 | 帳號不存在與密碼錯誤回同一句話，避免被用來列舉帳號 |
| 輸入驗證 | 座位範圍、張數上限、儲值金額上下限都在伺服器檢查 |
| XSS | 前端所有動態插入的內容都經過 `escapeHtml()` |
| 錯誤回應 | 非預期錯誤只回通用訊息，不洩漏堆疊或 SQL |

## API

所有端點都在 `/api` 之下。需要登入的請帶 `Authorization: Bearer <token>`。

### 認證

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/auth/register` | 註冊，回傳 user 與 token |
| POST | `/api/auth/login` | 登入，回傳 user 與 token |
| GET | `/api/auth/me` | 取得目前登入者（餘額以資料庫為準）🔒 |
| PATCH | `/api/auth/me` | 修改用戶名，補發 token 🔒 |

### 電影與場次

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/movies?category=` | 電影列表，可依分類篩選 |
| GET | `/api/movies/:id` | 單部電影 |
| GET | `/api/theaters` | 影廳列表 |
| GET | `/api/showtimes?movieId=&date=&theaterId=` | 場次，自動排除已開演的 |

### 座位與訂票

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/showtimes/:id/seats` | 座位圖：已售出、他人保留中、自己保留中 |
| POST | `/api/showtimes/:id/locks` | 保留座位，回傳到期時間 🔒 |
| DELETE | `/api/showtimes/:id/locks` | 放棄保留 🔒 |
| POST | `/api/bookings` | 付款並開票 🔒 |

### 票券與錢包

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/tickets` | 我的票券（未使用／歷史）🔒 |
| POST | `/api/tickets/:id/use` | 進場，開始倒數 🔒 |
| GET | `/api/tickets/stats` | 票券統計 🔒 |
| POST | `/api/wallet/deposit` | 儲值 🔒 |
| GET | `/api/wallet/transactions` | 交易紀錄 🔒 |

## 資料表

```
users          帳號、bcrypt hash、餘額
movies         電影
theaters       影廳（排數 × 每排座位數）
showtimes      場次    UNIQUE(theater_id, date, time)  同廳同時段不能排兩場
bookings       訂單
booking_seats  訂單中的每個座位  UNIQUE(showtime_id, seat_row, seat_col)  ← 防超賣
seat_locks     選位暫時保留      PRIMARY KEY(showtime_id, seat_row, seat_col)
transactions   儲值與購票紀錄
```

每個座位是 `booking_seats` 的一列，也就是一張獨立票券，可以分開使用。

## 頁面

| 檔案 | 說明 |
|---|---|
| `index.html` | 首頁：主視覺輪播、分類篩選、電影卡 |
| `showtime.html` | 場次查詢：依電影分組，時段以時間為主視覺 |
| `schedule.html` | 電影時刻表：未來 7 天 |
| `movie-detail.html` | 電影詳情與該片所有場次 |
| `booking.html` | 線上訂票：選片 → 日期 → 場次 → 選位 → 結帳 |
| `profile.html` | 個人專區：餘額、票券統計、改名、消費紀錄 |

訂票頁可用網址帶入場次：`booking.html?showtime=12&movie=1&date=2026-08-11&time=18:00`

## 介面設計

全站影院深色主題，透過 Bootstrap 5.3 的 `data-bs-theme="dark"` 打底，
實際色值由 `css/custom.css` 最上方的 CSS 變數控制。要改風格只要動那一區：

| 用途 | 變數 | 說明 |
|---|---|---|
| 底色層次 | `--ft-bg` / `--ft-surface` / `--ft-surface-2` / `--ft-surface-3` | 由深到淺 |
| 文字 | `--ft-text` / `--ft-text-dim` / `--ft-text-muted` | 主要／次要／輔助 |
| 強調 | `--ft-gold` | 主要動作、選取狀態、強調數字 |
| 語意 | `--ft-red` / `--ft-green` | 紅色只用於「現正熱映」，綠色只用於金額與付款成功 |

所有文字與背景組合皆通過 WCAG AA（對比度 ≥ 4.5）。

## 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `PORT` | `3000` | 伺服器連接埠 |
| `JWT_SECRET` | 開發用預設值 | **正式環境必須設定**，未設定時伺服器會拒絕啟動 |
| `DB_PATH` | `server/data/faketheater.db` | 資料庫檔案位置 |
| `SEAT_LOCK_TTL_MS` | `300000` | 座位保留時間 |

## 已知限制

這是作品展示用的專案，以下是刻意保留的簡化：

- **沒有真實金流**。餘額是系統內的點數，儲值不會真的扣款。
  真要串接的話應該接綠界／藍新／Stripe 的**測試環境**——整合方式與正式環境相同，
  但不涉及真實交易。這是一間虛構影城、放的是不存在的電影，收真錢等於賣無法交付的商品。
- **「Google 登入」是模擬的**，固定綁在一組展示帳號上，不會真的走 OAuth。
- **票券 QR Code 是 Canvas 畫的示意圖案**，不是可掃描的真實 QR 編碼。
- 沒有管理後台，排片由伺服器啟動時自動產生。
- 沒有退票功能。
