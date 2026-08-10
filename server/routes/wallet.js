'use strict';

const express = require('express');
const { getDb, writeTransaction } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { badRequest } = require('../utils/http');

const router = express.Router();

const MAX_DEPOSIT = 100000;

/**
 * 儲值。金額驗證在伺服器做，前端傳什麼都要重新檢查。
 */
const deposit = writeTransaction((userId, amount) => {
    const db = getDb();
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amount, userId);
    db.prepare('INSERT INTO transactions (user_id, type, amount) VALUES (?, \'儲值\', ?)')
        .run(userId, amount);
    return db.prepare('SELECT balance FROM users WHERE id = ?').get(userId).balance;
});

/**
 * POST /api/wallet/deposit
 */
router.post('/deposit', requireAuth, (req, res) => {
    const amount = Number(req.body?.amount);

    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
        throw badRequest('請輸入有效的儲值金額');
    }
    if (amount > MAX_DEPOSIT) {
        throw badRequest(`單次儲值上限為 NT$ ${MAX_DEPOSIT}`);
    }

    const balance = deposit(req.user.id, amount);
    res.json({ balance, amount });
});

/**
 * GET /api/wallet/transactions
 */
router.get('/transactions', requireAuth, (req, res) => {
    const transactions = getDb().prepare(`
        SELECT id, type, amount,
               movie_title AS movieTitle,
               movie_date  AS movieDate,
               showtime,
               created_at  AS createdAt
        FROM transactions
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 100
    `).all(req.user.id);

    res.json({ transactions });
});

module.exports = router;
