'use strict';

const express = require('express');
const config = require('./config');
const { migrate } = require('./db');
const { seedCatalog, seedDemoUsers, ensureUpcomingShowtimes } = require('./db/seed');
const { notFoundHandler, errorHandler } = require('./middleware/errors');

const authRoutes = require('./routes/auth');
const catalogRoutes = require('./routes/catalog');
const bookingRoutes = require('./routes/booking');
const walletRoutes = require('./routes/wallet');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const sandboxRoutes = require('./routes/sandbox');

/**
 * 建立資料表、匯入種子資料、補齊未來幾天的場次。
 * 可重複執行，伺服器每次啟動都會跑一次。
 */
function initDatabase({ quiet = false } = {}) {
    migrate();
    seedCatalog();
    seedDemoUsers();
    const created = ensureUpcomingShowtimes();
    if (!quiet && created > 0) {
        console.log(`已排入 ${created} 個新場次`);
    }
    return { created };
}

/**
 * 組裝 Express 應用程式（測試也用這個，不必真的開 port）
 * @returns {import('express').Express}
 */
function createApp() {
    const app = express();

    app.disable('x-powered-by');
    app.use(express.json({ limit: '64kb' }));
    // 金流回調與沙盒付款頁是表單格式，不是 JSON
    app.use(express.urlencoded({ extended: false, limit: '64kb' }));

    app.get('/api/health', (req, res) => res.json({ ok: true }));

    app.use('/api/auth', authRoutes);
    app.use('/api', catalogRoutes);
    app.use('/api', bookingRoutes);
    app.use('/api/wallet', walletRoutes);
    app.use('/api/payments', paymentRoutes);
    app.use('/api/admin', adminRoutes);

    // 模擬的第三方金流商（正式環境改接綠界後整組可刪除）
    app.use('/sandbox', sandboxRoutes);

    // 前端靜態檔案
    app.use(express.static(config.STATIC_DIR, { extensions: ['html'] }));

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

module.exports = { createApp, initDatabase };
