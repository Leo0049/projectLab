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
| `admin` | `admin123` | 0（管理員，可進管理後台） |

密碼在匯入時就會經過 bcrypt hash，資料庫裡沒有明文。

### 執行測試

```bash
npx playwright install chromium   # 只有第一次需要
npm test          # 後端 96 項 + 瀏覽器 83 項
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
  middleware/           JWT 驗證、管理員授權、錯誤處理
  payments/signature.js 綠界 CheckMacValue 簽章演算法
  routes/               API 端點（含模擬金流商 sandbox.js）
  services/             座位鎖定、訂票退票、金流、後台的核心邏輯
  utils/                日期、HTTP 錯誤

FakeTheater/            前端（由 Express 直接提供）
  *.html                七個頁面
  js/api.js             API client，前端唯一對外的資料入口
  js/auth.js            登入狀態與錢包
  js/sidebar.js         共用側邊欄（依角色顯示不同項目）
  js/infinite-scroll.js 共用的無限滾動元件
  js/booking.js         訂票頁
  js/checkout-sidebar.js結帳側邊欄（含座位保留倒數）
  js/wallet-sidebar.js  票夾（使用、退票）
  js/admin.js           管理後台
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

**第三層：資料庫唯一索引**
```sql
CREATE UNIQUE INDEX idx_booking_seats_unique
    ON booking_seats (showtime_id, seat_row, seat_col)
    WHERE status != 'refunded';
```
就算前兩層都被繞過，資料庫也不可能讓同一個位子存在兩筆未退票紀錄。
這是唯一不依賴應用層邏輯正確性的保證。用「部分」索引是為了讓退票後的紀錄留著對帳，
同時把位子釋放出來重新賣（見〈退票〉）。

### 測試怎麼證明

`tests/api.js` 最後兩段：

- **20 個 HTTP 請求同時搶同一個座位** → 恰好 1 個回 201，其餘 19 個回 409
- **4 個獨立的 Node 行程同時寫入同一個座位** → 仍然只有 1 個成功

第二個測試特別重要：Node 是單執行緒，單一行程內的測試無法排除「只是剛好沒有真的並行」。
用多行程直接打同一個資料庫檔案，驗證的才是資料庫層的保證。

## 金流（沙盒）

**購票是從錢包餘額扣款，儲值才走金流。** 這樣金流的整合面積小、責任單一，
也符合多數售票 App 的做法。系統裡沒有任何「不用付錢就能加值」的端點。

付款流程與綠界 ECPay 正式環境一致：

```
使用者按下儲值
      │
      ▼
POST /api/payments/deposit      建立 pending 訂單，回傳已簽章的表單參數
      │
      ▼
表單 POST 到金流商付款頁          沙盒是 /sandbox/checkout，正式環境改成綠界網址
      │
      ├─ 伺服器對伺服器通知 ─→ POST /api/payments/webhook   ← 真正入帳的地方
      │                          驗簽 → 比對金額 → 入帳（冪等）
      ▼
瀏覽器導回 profile.html?order=…  前端再向後端確認訂單狀態，不相信網址參數
```

簽章使用綠界的 **CheckMacValue** 演算法（`server/payments/signature.js`）：
參數字典序排序 → 前後接上 HashKey/HashIV → .NET 風格 URL encode → SHA256 → 轉大寫。
驗證時用 `timingSafeEqual` 比對，避免以回應時間推測正確簽章。

三個容易寫錯、測試都有涵蓋的地方：

| 風險 | 作法 |
|---|---|
| 偽造回調 | 簽章驗證失敗直接 400，不入帳 |
| 竄改金額 | 以我方訂單金額為準，回調金額不符就標記失敗 |
| 重複通知 | 訂單進入終態（paid / failed）後不再變更，金流商重送也只入帳一次 |
| 逾時後才付款 | `expired` 是我方自訂的逾時，不代表金流商沒收到錢，仍會入帳並留下警告 |
| SSRF / 開放轉址 | 回調與返回網址一律驗證為本站，外部網址退回預設值 |

要換成真的綠界／藍新：刪掉 `server/routes/sandbox.js`，把 `createDepositOrder()`
裡的 `action` 改成金流商網址，填入正式的 MerchantID 與金鑰即可，參數與簽章規則不用動。

## 退票

| 規則 | 說明 |
|---|---|
| 可退條件 | 票券狀態為「未使用」 |
| 時間限制 | 開演前 30 分鐘起不受理（`REFUND_CUTOFF_MINUTES`） |
| 退款金額 | 票價扣除 10% 手續費（`REFUND_FEE_RATE`） |
| 座位處理 | 立刻釋出，可以重新賣給別人 |

退票後座位怎麼「既留下紀錄又能重新賣出」？靠**部分唯一索引**：

```sql
CREATE UNIQUE INDEX idx_booking_seats_unique
    ON booking_seats (showtime_id, seat_row, seat_col)
    WHERE status != 'refunded';
```

已退票的列被排除在索引之外，所以同一個座位可以同時存在「一筆已退票」與「一筆新售出」，
歷史紀錄完整保留，也不需要刪除任何資料。

## 管理後台

以 `admin` 帳號登入後，側邊欄會出現「管理後台」。權限判斷在伺服器
（`requireAdmin` 中介層一律從資料庫讀角色，不看權杖內容），
一般會員即使直接開 `admin.html`，每支 API 也都會回 403。

- **營運儀表板**：票房淨額（總額 − 退款）、售出／已使用／已退票張數、今日上座率、熱門電影排行
- **場次管理**：排片、刪除（已售票的場次擋下）、依日期篩選、各場次上座率
- **訂單管理**：跨使用者的訂單與座位明細，可代客退票
- **會員列表**：餘額、訂單數、持票數

## 安全性設計

| 項目 | 作法 |
|---|---|
| 密碼 | bcrypt hash（cost 10），資料庫無明文 |
| 認證 | JWT Bearer token，有效期 7 天 |
| 餘額 | 一律以資料庫為準，前端傳來的金額完全不採信 |
| 授權 | 票券、交易紀錄都以 token 中的使用者為範圍查詢 |
| 錯誤訊息 | 帳號不存在與密碼錯誤回同一句話，避免被用來列舉帳號 |
| 輸入驗證 | 座位範圍、張數上限、儲值金額上下限都在伺服器檢查 |
| 授權分級 | 管理端點需 admin 角色，角色一律從資料庫讀取 |
| 加值 | 沒有可直接加值的端點，一律經過金流回調並驗簽 |
| 金流回調 | CheckMacValue 驗簽 + 金額比對 + 冪等處理 |
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
| POST | `/api/tickets/:id/refund` | 退票 🔒 |
| GET | `/api/wallet/transactions` | 交易紀錄（分頁）🔒 |

### 金流

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/payments/deposit` | 建立儲值訂單，回傳金流商表單 🔒 |
| POST | `/api/payments/webhook` | 金流商回調（以簽章驗身分，不需登入） |
| GET | `/api/payments/orders/:orderNo` | 查詢訂單狀態 🔒 |
| GET | `/api/payments/orders` | 儲值紀錄（分頁）🔒 |

### 管理後台（需 admin 角色）

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/admin/stats` | 營運儀表板 |
| GET | `/api/admin/showtimes` | 場次列表（含上座率、分頁） |
| POST | `/api/admin/showtimes` | 排片 |
| DELETE | `/api/admin/showtimes/:id` | 刪除場次（已售票則擋下） |
| GET | `/api/admin/bookings` | 所有訂單（分頁） |
| GET | `/api/admin/users` | 會員列表（分頁） |
| POST | `/api/admin/tickets/:id/refund` | 代客退票 |

## 資料表

```
users           帳號、bcrypt hash、餘額、角色（user / admin）
movies          電影
theaters        影廳（排數 × 每排座位數）
showtimes       場次   UNIQUE(theater_id, date, time)  同廳同時段不能排兩場
bookings        訂單（含已退款金額與狀態）
booking_seats   訂單中的每個座位
                └ 部分唯一索引 (showtime_id, seat_row, seat_col) WHERE status != 'refunded'  ← 防超賣
seat_locks      選位暫時保留     PRIMARY KEY(showtime_id, seat_row, seat_col)
transactions    儲值、購票、退票紀錄
payment_orders  金流訂單（pending / paid / failed / expired）
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
| `profile.html` | 個人專區：餘額、票券統計、改名、消費紀錄（無限滾動） |
| `admin.html` | 管理後台（僅 admin 可用） |

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

側邊欄由 `js/sidebar.js` 統一產生（原本六個頁面各複製一份），
會依登入狀態與角色顯示「會員」與「管理」區塊。

### 無限滾動

`js/infinite-scroll.js` 是共用元件，用 `IntersectionObserver` 監看列表尾端的哨兵元素，
目前用在場次查詢、消費紀錄與後台的三張表。處理了幾個容易忽略的細節：

- 載入後哨兵若仍在畫面內，重新 `observe` 一次讓它繼續載，不會卡住
- 每次重新查詢會遞增 generation，丟棄前一次查詢晚回來的結果
- 載入中／已到底／載入失敗（可重試）三種狀態都有對應畫面

## 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `PORT` | `3000` | 伺服器連接埠 |
| `PUBLIC_URL` | 由 Host 標頭推導 | 對外網址。Host 可被偽造，正式環境請明確設定 |
| `JWT_SECRET` | 開發用預設值 | **正式環境必須設定**，未設定時伺服器會拒絕啟動 |
| `DB_PATH` | `server/data/faketheater.db` | 資料庫檔案位置 |
| `SEAT_LOCK_TTL_MS` | `300000` | 座位保留時間 |

## 已知限制

這是作品展示用的專案，以下是刻意保留的簡化：

- **金流是沙盒，不是真實交易**。付款頁與回調由本專案模擬，簽章演算法與流程和綠界正式環境相同，
  但不會向任何金融機構請款。這是一間虛構影城、放的是不存在的電影，收真錢等於賣無法交付的商品。
- **「Google 登入」是模擬的**，固定綁在一組展示帳號上，不會真的走 OAuth。
- **票券 QR Code 是 Canvas 畫的示意圖案**，不是可掃描的真實 QR 編碼。
- 沒有寄送 email／簡訊通知。
- 金流只實作信用卡一種付款方式。
