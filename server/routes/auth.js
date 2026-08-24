'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { createRateLimit } = require('../middleware/rate-limit');
const { badRequest, unauthorized, conflict } = require('../utils/http');

const router = express.Router();

// 拖慢暴力破解：同一來源每分鐘的嘗試次數上限。
// 註冊放得比登入寬（測試與展示都會在短時間內建立多個帳號），但仍遠低於灌爆的程度。
const loginLimiter = createRateLimit({ windowMs: 60 * 1000, max: 15 });
const registerLimiter = createRateLimit({ windowMs: 60 * 1000, max: 30 });

const USERNAME_MAX = 30;
const PASSWORD_MIN = 6;
// 寬鬆即可：只擋明顯不是 email 的字串，真正的所有權驗證要靠寄信
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        balance: user.balance,
        // 前端用來決定要不要顯示管理後台入口；真正的授權仍在伺服器
        role: user.role || 'user'
    };
}

/**
 * POST /api/auth/register
 */
router.post('/register', registerLimiter, (req, res) => {
    const username = String(req.body?.username || '').trim();
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) throw badRequest('請填寫用戶名與密碼');
    if (username.length > USERNAME_MAX) throw badRequest(`用戶名不能超過 ${USERNAME_MAX} 個字`);
    if (password.length < PASSWORD_MIN) throw badRequest(`密碼至少要 ${PASSWORD_MIN} 個字元`);
    if (email && !EMAIL_PATTERN.test(email)) throw badRequest('電子郵件格式不正確');

    const db = getDb();
    const finalEmail = email || `${username}@faketheater.com`;

    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
        throw conflict('用戶名已存在');
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(finalEmail)) {
        throw conflict('電子郵件已被使用');
    }

    // 只存 hash，資料庫裡永遠沒有明文密碼
    const passwordHash = bcrypt.hashSync(password, 10);
    const id = db.prepare(
        'INSERT INTO users (username, email, password_hash, balance) VALUES (?, ?, ?, 0)'
    ).run(username, finalEmail, passwordHash).lastInsertRowid;

    const user = { id, username, email: finalEmail, balance: 0, role: 'user' };
    res.status(201).json({ user, token: signToken(user) });
});

/**
 * POST /api/auth/login
 */
router.post('/login', loginLimiter, (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) throw badRequest('請填寫用戶名與密碼');

    const row = getDb()
        .prepare('SELECT id, username, email, password_hash, balance, role FROM users WHERE username = ?')
        .get(username);

    // 帳號不存在與密碼錯誤回同一句話，避免被拿來列舉帳號
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
        throw unauthorized('用戶名或密碼錯誤');
    }

    const user = publicUser(row);
    res.json({ user, token: signToken(user) });
});

/**
 * GET /api/auth/me - 取回目前登入者（餘額以資料庫為準）
 */
router.get('/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user) });
});

/**
 * PATCH /api/auth/me - 修改用戶名
 */
router.patch('/me', requireAuth, (req, res) => {
    const username = String(req.body?.username || '').trim();
    if (!username) throw badRequest('請輸入有效的名稱');
    if (username.length > USERNAME_MAX) throw badRequest(`用戶名不能超過 ${USERNAME_MAX} 個字`);

    const db = getDb();
    const taken = db.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?')
        .get(username, req.user.id);
    if (taken) throw conflict('用戶名已存在');

    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, req.user.id);

    const user = { ...publicUser(req.user), username };
    // 名稱在權杖裡，改名後補發一份
    res.json({ user, token: signToken(user) });
});

module.exports = router;
