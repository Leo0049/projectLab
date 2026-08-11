'use strict';

const path = require('path');

/**
 * 伺服器設定。正式環境請務必用環境變數覆寫 JWT_SECRET。
 */
module.exports = {
    PORT: Number(process.env.PORT) || 3000,

    // 開發用預設值；正式環境沒設定就直接讓伺服器啟動失敗（見 index.js）
    JWT_SECRET: process.env.JWT_SECRET || 'faketheater-dev-secret-change-me',
    JWT_EXPIRES_IN: '7d',

    DB_PATH: process.env.DB_PATH || path.join(__dirname, 'data', 'faketheater.db'),

    // 前端靜態檔案目錄
    STATIC_DIR: path.join(__dirname, '..', 'FakeTheater'),

    // 選位後保留座位的時間（毫秒）
    SEAT_LOCK_TTL_MS: Number(process.env.SEAT_LOCK_TTL_MS) || 5 * 60 * 1000,

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
    PAYMENT_ORDER_TTL_MS: Number(process.env.PAYMENT_ORDER_TTL_MS) || 15 * 60 * 1000,

    PAYMENT_MIN_AMOUNT: 100,
    PAYMENT_MAX_AMOUNT: 100000,

    /* -------------------------------------------------------------- *
     * 退票規則
     * -------------------------------------------------------------- */
    // 開演前多久停止受理退票
    REFUND_CUTOFF_MINUTES: Number(process.env.REFUND_CUTOFF_MINUTES) || 30,
    // 退票手續費比例
    REFUND_FEE_RATE: Number(process.env.REFUND_FEE_RATE) || 0.1,

    IS_PROD: process.env.NODE_ENV === 'production'
};
