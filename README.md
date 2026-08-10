# FakeTheater 電影購票系統

純前端（無後端）的電影購票展示網站，以 HTML + Bootstrap 5 + 原生 JavaScript 實作。
所有資料存放於 `data/*.json` 與瀏覽器 `localStorage`，不需要資料庫或伺服器程式。

## 快速開始

專案使用 `fetch()` 讀取 `data/*.json`，請用 HTTP 伺服器開啟（直接雙擊 HTML 也可以，
此時會自動改用 `js/api.js` 內嵌的種子資料）：

```bash
cd FakeTheater
python3 -m http.server 8000
# 開啟 http://localhost:8000/index.html
```

### 展示帳號

| 帳號 | 密碼 | 初始餘額 |
|---|---|---|
| `demo` | `demo123` | 2000 |
| `johndoe` | `password123` | 1000 |
| `janedoe` | `securepass` | 500 |

也可以直接註冊新帳號，或使用「Google 登入」（模擬）。

### 執行測試（選用）

`tests/e2e.js` 會自己起一個靜態伺服器，用無頭 Chromium 跑完整流程
（瀏覽 → 登入 → 訂票 → 付款 → 票夾 → 個人專區 → 帳號驗證），共 42 項檢查：

```bash
npm install          # 只為了安裝 playwright，網站本身不需要任何套件
npx playwright install chromium
npm test
```

## 頁面

| 檔案 | 說明 | 主要腳本 |
|---|---|---|
| `index.html` | 首頁：主視覺輪播、分類篩選、電影卡列表 | `js/index_js.js` |
| `showtime.html` | 場次查詢：依電影／日期／影廳過濾 | `js/showtime.js` |
| `schedule.html` | 電影時刻表：未來 7 天，依日期分頁 | `js/schedule.js` |
| `movie-detail.html` | 電影詳情與該片所有場次 | `js/movie-detail.js` |
| `booking.html` | 線上訂票：選片 → 選日期 → 選場次 → 選位 → 結帳 | `js/booking.js` |
| `profile.html` | 個人專區：餘額、改名、消費紀錄 | 頁內 inline script |

## 共用模組

| 檔案 | 職責 |
|---|---|
| `js/api.js` | `DataAPI`：唯一的資料存取層（電影、影廳、場次、訂票、使用者） |
| `js/auth.js` | `AuthManager`：登入／註冊 Modal、儲值、扣款、導覽列狀態 |
| `js/common.js` | `escapeHtml()`、側邊欄 active 狀態、回到頂部按鈕 |
| `js/checkout-sidebar.js` | `CheckoutSidebar`：確認訂單與付款側邊欄 |
| `js/wallet-sidebar.js` | `WalletSidebar`：我的票夾（未使用／使用中／歷史票券） |
| `js/footer.js` | `Footer`：各頁共用頁尾 |

## 資料設計

### 靜態資料（`data/`）

`movies.json`、`theaters.json`、`users.json`、`bookings.json`。
`js/api.js` 內另有一份同樣內容的 `EMBEDDED_*` 常數，作為 `file://` 開啟或 `fetch` 失敗時的後援，
**修改 `data/*.json` 時請同步更新內嵌資料**。

### 場次是動態產生的

場次不從靜態檔讀取，而是由 `DataAPI.generateShowtimes()` 以「今天」為基準產生未來 7 天的排程，
因此不會有寫死日期過期、整站查不到場次的問題。已經開演的場次會自動從查詢結果中排除。

### localStorage

| 鍵名 | 內容 |
|---|---|
| `users` | 所有帳號（含預設帳號，第一次執行時由 `data/users.json` 匯入） |
| `userInfo` | 目前登入者 |
| `bookings` | 訂票紀錄（含 `userId`、每個座位的使用狀態） |
| `usedTickets` | 已使用（歸檔）的票券 |
| `transactions` | 儲值與購票的交易紀錄 |

餘額變動會同時寫回 `users`，所以登出再登入不會遺失。
舊版的 `registeredUsers` 會在第一次載入時自動合併進 `users` 後移除。

## 訂票流程

1. `booking.html` 選擇電影 → 日期 → 場次（也可由網址帶入：`booking.html?showtime=12&movie=1&date=2026-08-10&time=18:00`）
2. 座位圖標示已售出座位，單筆訂單最多 6 個位子
3. 「確認購票」開啟結帳側邊欄，顯示金額與付款後餘額；餘額不足會擋下並提供儲值入口
4. 付款時再檢查一次座位是否被搶走，成功才扣款建立票券；訂票失敗會自動退款
5. 票券進入「我的票夾」，每個座位是一張獨立票券，按下「立即使用」後倒數 1 分鐘自動歸檔到歷史票券

## 已知限制

這是教學／作品展示用的前端專案，刻意保留了以下簡化：

- 沒有後端，帳號密碼以明文存在 `data/users.json` 與 `localStorage`，**請勿填入真實密碼**
- 「Google 登入」是模擬的，不會真的走 OAuth
- 票券的 QR Code 是以 Canvas 繪製的示意圖案，並非可掃描的真實 QR 編碼
- 資料只存在瀏覽器，清除瀏覽器資料即會重置
