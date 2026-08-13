'use strict';

const path = require('path');

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

    PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER || 'sandbox',
    PAYMENT_MERCHANT_ID: process.env.PAYMENT_MERCHANT_ID || '3002607',
    PAYMENT_HASH_KEY: process.env.PAYMENT_HASH_KEY || 'pwFHCqoQZGmho4w6',
    PAYMENT_HASH_IV: process.env.PAYMENT_HASH_IV || 'EkRm7iFT261dpevs',

    // 金流訂單多久沒付款就失效
    PAYMENT_ORDER_TTL_MS: numberEnv(process.env.PAYMENT_ORDER_TTL_MS, 15 * 60 * 1000),

    PAYMENT_MIN_AMOUNT: 100,
    PAYMENT_MAX_AMOUNT: 100000,

    /* -------------------------------------------------------------- *
     * 退票規則
     * -------------------------------------------------------------- */
    // 開演前多久停止受理退票
    REFUND_CUTOFF_MINUTES: numberEnv(process.env.REFUND_CUTOFF_MINUTES, 30),
    // 退票手續費比例
    REFUND_FEE_RATE: numberEnv(process.env.REFUND_FEE_RATE, 0.1),

    IS_PROD: process.env.NODE_ENV === 'production'
};
