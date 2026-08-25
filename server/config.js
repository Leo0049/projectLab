'use strict';

const path = require('path');
const crypto = require('crypto');

/**
 * 讀取數值型環境變數。
 * 不能用 `Number(x) || fallback`——那會讓 0 這種合法設定值悄悄變回預設值。
 * @param {string|undefined} value
 * @param {number} fallback
 */
function numberEnv(value, fallback) {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 讀取 Express 的 trust proxy 設定。
 *
 * 平台的反向代理（Render、Fly、Nginx…）會把原始通訊協定放在 X-Forwarded-Proto，
 * 沒開這個設定的話 req.protocol 永遠是 http，對外網址就會組成 http:// 而被瀏覽器擋掉。
 * 反過來說，沒有代理時開啟它等於讓任何人偽造來源 IP，所以預設關閉、由部署方明確開啟。
 *
 * 接受：數字（信任幾層代理）、'true'/'false'、或 Express 支援的字串（如 'loopback'）。
 * @param {string|undefined} value
 */
function trustProxyEnv(value) {
    if (value === undefined || value === '') return false;
    if (value === 'true') return true;
    if (value === 'false') return false;
    const hops = Number(value);
    return Number.isInteger(hops) && hops >= 0 ? hops : value;
}

// 先讀一次存成常數，讓下面的 paymentSecret() 與 exports 共用同一個判斷結果
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || 'sandbox';

/**
 * 金流簽章金鑰：環境變數有設就照用（相容真實金流商的測試環境金鑰）；
 * 沒設時，沙盒模式以 crypto.randomBytes(16) 產生行程內隨機金鑰。
 *
 * WHY：原本寫死在這裡的是綠界公開文件上的測試金鑰——寫在公開 repo 裡的金鑰等於沒有金鑰，
 * 任何讀過原始碼的人都能替回調簽出合法的 CheckMacValue，不入帳就把錢儲值進錢包。
 * 隨機化不影響功能：沙盒的整條流程（建立訂單 → 付款頁 → 回調驗證）全部在同一個行程內完成。
 * 非沙盒模式卻沒設定金鑰時回傳空字串，讓所有簽章驗證一律失敗（fail closed），
 * 絕不退回公開已知的預設值。
 */
function paymentSecret(name) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
    return PAYMENT_PROVIDER === 'sandbox' ? crypto.randomBytes(16).toString('hex') : '';
}

const PAYMENT_HASH_KEY = paymentSecret('PAYMENT_HASH_KEY');
const PAYMENT_HASH_IV = paymentSecret('PAYMENT_HASH_IV');

/* -------------------------------------------------------------- *
 * 退票規則
 * -------------------------------------------------------------- */
// 開演前多久停止受理退票
const REFUND_CUTOFF_MINUTES = numberEnv(process.env.REFUND_CUTOFF_MINUTES, 30);
// 退票手續費比例
const REFUND_FEE_RATE = numberEnv(process.env.REFUND_FEE_RATE, 0.1);

// 啟動前就把不合理的退票設定擋下來，絕不默默接受：
// 費率不在 [0, 1] 時，退款金額反而會算出比票價還多的錢（退一張賺一張）；
// 退票期限為負數則代表「開演後一段時間內還能退」，同樣不合理。
if (REFUND_FEE_RATE < 0 || REFUND_FEE_RATE > 1) {
    throw new Error(
        `設定錯誤：REFUND_FEE_RATE 必須落在 [0, 1]（含端點），目前收到：${process.env.REFUND_FEE_RATE}`);
}
if (REFUND_CUTOFF_MINUTES < 0) {
    throw new Error(
        `設定錯誤：REFUND_CUTOFF_MINUTES 必須 >= 0，目前收到：${process.env.REFUND_CUTOFF_MINUTES}`);
}

/**
 * 伺服器設定。正式環境請務必用環境變數覆寫 JWT_SECRET。
 */
module.exports = {
    PORT: numberEnv(process.env.PORT, 3000),

    // 開發用預設值；正式環境沒設定就直接讓伺服器啟動失敗（見 index.js）
    JWT_SECRET: process.env.JWT_SECRET || 'faketheater-dev-secret-change-me',
    JWT_EXPIRES_IN: '7d',

    DB_PATH: process.env.DB_PATH || path.join(__dirname, 'data', 'faketheater.db'),

    // 部署在反向代理後方時設為 1（或代理層數）
    TRUST_PROXY: trustProxyEnv(process.env.TRUST_PROXY),

    // 管理員密碼。未設定時沿用 seed-data 的預設值（僅供本機開發），
    // 正式環境沒設定就拒絕啟動——公開網址上的後台不能用 README 寫著的密碼進得去。
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',

    // 「模擬 Google 登入」按鈕的顯示開關（前端從 /api/config 讀取）。
    // 該按鈕會把所有訪客登入到同一個共用展示帳號，公開部署時建議設為 false。
    DEMO_GOOGLE_LOGIN: process.env.DEMO_GOOGLE_LOGIN !== 'false',

    // 前端靜態檔案目錄
    STATIC_DIR: path.join(__dirname, '..', 'FakeTheater'),

    // 選位後保留座位的時間（毫秒）
    SEAT_LOCK_TTL_MS: numberEnv(process.env.SEAT_LOCK_TTL_MS, 5 * 60 * 1000),

    // 單筆訂單最多幾個座位
    MAX_SEATS_PER_ORDER: 6,

    // 排片：永遠維持未來幾天有場次
    SCHEDULE_DAYS: 7,
    SCHEDULE_TIMES: ['10:30', '13:00', '15:30', '18:00', '20:30', '23:00'],
    SCHEDULE_PRICES: [250, 280, 350, 300, 320, 380],

    // 票券進入「使用中」後多久歸檔到歷史票券
    TICKET_EXPIRY_MS: 60 * 1000,

    /* -------------------------------------------------------------- *
     * 金流（沙盒）
     *
     * 簽章演算法沿用綠界 ECPay 的 CheckMacValue 規則，
     * 之後要換成真的金流商，只需要新增一個 provider 並填入正式的金鑰。
     * -------------------------------------------------------------- */
    // 對外網址。未設定時由請求的 Host 標頭推導——但 Host 是可被偽造的，
    // 正式環境請明確設定，金流的回調與返回網址才不會被牽著走。
    PUBLIC_URL: process.env.PUBLIC_URL || '',

    PAYMENT_PROVIDER,
    PAYMENT_MERCHANT_ID: process.env.PAYMENT_MERCHANT_ID || '3002607',
    PAYMENT_HASH_KEY,
    PAYMENT_HASH_IV,

    // 金流訂單多久沒付款就失效
    PAYMENT_ORDER_TTL_MS: numberEnv(process.env.PAYMENT_ORDER_TTL_MS, 15 * 60 * 1000),

    PAYMENT_MIN_AMOUNT: 100,
    PAYMENT_MAX_AMOUNT: 100000,

    /* -------------------------------------------------------------- *
     * 退票規則
     * -------------------------------------------------------------- */
    REFUND_CUTOFF_MINUTES,
    REFUND_FEE_RATE,

    IS_PROD: process.env.NODE_ENV === 'production'
};
