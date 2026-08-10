'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../db');
const { unauthorized } = require('../utils/http');

/**
 * 簽發存取權杖
 * @param {{id:number, username:string}} user
 * @returns {string}
 */
function signToken(user) {
    return jwt.sign(
        { sub: user.id, username: user.username },
        config.JWT_SECRET,
        { expiresIn: config.JWT_EXPIRES_IN }
    );
}

function readToken(req) {
    const header = req.get('Authorization') || '';
    if (!header.startsWith('Bearer ')) return null;
    return header.slice(7).trim() || null;
}

/**
 * 必須登入。驗證通過後 req.user 會帶上資料庫裡的最新使用者資料
 * （餘額一律以資料庫為準，不信任前端傳來的任何金額）。
 */
function requireAuth(req, res, next) {
    const token = readToken(req);
    if (!token) return next(unauthorized());

    let payload;
    try {
        payload = jwt.verify(token, config.JWT_SECRET);
    } catch (error) {
        return next(unauthorized('登入已過期，請重新登入'));
    }

    const user = getDb()
        .prepare('SELECT id, username, email, balance FROM users WHERE id = ?')
        .get(payload.sub);

    if (!user) return next(unauthorized('帳號不存在'));

    req.user = user;
    next();
}

module.exports = { signToken, requireAuth };
