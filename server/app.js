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

    // 基本安全標頭。前端已無內聯腳本（profile 的那段抽成 js/profile.js），
    // 所以 CSP 能用最嚴格的 script-src 'self'；樣式因為樣板會產生 style 屬性
    // 與沙盒頁的 <style> 區塊，仍需允許 unsafe-inline。
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'same-origin');
        res.setHeader('Content-Security-Policy', [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",   // Bootstrap 的內嵌 SVG 圖示用 data: URI
            "connect-src 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'"
        ].join('; '));
        next();
    });

    // 部署在反向代理後方時，才讓 Express 相信 X-Forwarded-* 標頭。
    // 這只影響 req.protocol / req.ip；金流回調用的是 socket 的實際位址，不受影響。
    if (config.TRUST_PROXY !== false) {
        app.set('trust proxy', config.TRUST_PROXY);
    }

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

    // 模擬的第三方金流商。只有在真的使用沙盒金流時才掛載——
    // 換成正式金流商後這組路由就不該存在，否則會變成不用付錢就能加值的入口。
    if (config.PAYMENT_PROVIDER === 'sandbox') {
        app.use('/sandbox', sandboxRoutes);
    }

    // 前端靜態檔案
    app.use(express.static(config.STATIC_DIR, { extensions: ['html'] }));

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

module.exports = { createApp, initDatabase };
