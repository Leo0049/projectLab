'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../db');
const { unauthorized, HttpError } = require('../utils/http');

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
        .prepare('SELECT id, username, email, balance, role FROM users WHERE id = ?')
        .get(payload.sub);

    if (!user) return next(unauthorized('帳號不存在'));

    req.user = user;
    next();
}

/**
 * 必須是管理員。角色一律從資料庫讀取，不看權杖裡的內容——
 * 權限被撤銷時不需要等舊權杖過期。
 */
function requireAdmin(req, res, next) {
    if (!req.user) return next(unauthorized());
    if (req.user.role !== 'admin') {
        return next(new HttpError(403, '需要管理員權限'));
    }
    next();
}

module.exports = { signToken, requireAuth, requireAdmin };
