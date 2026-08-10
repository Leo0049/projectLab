'use strict';

const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * 錢包
 *
 * 這裡沒有「直接加值」的端點——加值一律要經過 /api/payments 的金流流程，
 * 否則任何登入者都能自己把餘額加到任意數字。
 */

/**
 * GET /api/wallet/transactions?limit=&offset=
 * 支援分頁，供個人專區的無限滾動使用
 */
router.get('/transactions', requireAuth, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const db = getDb();

    const total = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?')
        .get(req.user.id).n;

    const transactions = db.prepare(`
        SELECT id, type, amount,
               movie_title AS movieTitle,
               movie_date  AS movieDate,
               showtime,
               created_at  AS createdAt
        FROM transactions
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ? OFFSET ?
    `).all(req.user.id, limit, offset);

    res.json({ transactions, total, hasMore: offset + transactions.length < total });
});

module.exports = router;
