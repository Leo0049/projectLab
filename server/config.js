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

    IS_PROD: process.env.NODE_ENV === 'production'
};
