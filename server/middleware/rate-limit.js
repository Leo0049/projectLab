'use strict';

const { HttpError } = require('../utils/http');

/**
 * 極簡記憶體速率限制器（固定窗口）。
 *
 * 用在登入／註冊這種「失敗很多次也不該無限嘗試」的端點上，拖慢暴力破解。
 * 狀態放在行程內的 Map：單機 SQLite 的部署型態下夠用；
 * 將來若多行程或多主機部署，要換成共用的儲存（如 Redis），否則各算各的。
 *
 * 過期的計數器靠「每半個窗口順手清一次」回收，不需要背景排程，
 * Map 的大小上限約等於「一個窗口內出現過的不重複 key 數」。
 *
 * @param {{windowMs:number, max:number}} options
 * @returns {import('express').RequestHandler}
 */
function createRateLimit({ windowMs, max }) {
    const hits = new Map(); // key -> { count, resetAt }
    let lastSweep = Date.now();

    function sweep(now) {
        if (now - lastSweep < windowMs / 2) return;
        lastSweep = now;
        for (const [key, entry] of hits) {
            if (entry.resetAt <= now) hits.delete(key);
        }
    }

    return function rateLimit(req, res, next) {
        const now = Date.now();
        sweep(now);

        // req.ip 會尊重 trust proxy 設定（見 config.js 與 app.js）
        const key = req.ip || 'unknown';
        const entry = hits.get(key);

        if (!entry || entry.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        entry.count += 1;
        if (entry.count > max) {
            res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
            return next(new HttpError(429, '嘗試次數過多，請稍後再試'));
        }
        next();
    };
}

module.exports = { createRateLimit };
