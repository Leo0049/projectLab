'use strict';

const { HttpError } = require('../utils/http');

function notFoundHandler(req, res, next) {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: '找不到這個 API 端點' });
    }
    next();
}

/* eslint-disable no-unused-vars */
/**
 * 統一錯誤回應。預期內的錯誤（HttpError）回原訊息，
 * 非預期的錯誤只回一句通用訊息，避免把堆疊或 SQL 內容洩漏出去。
 */
function errorHandler(error, req, res, next) {
    if (error instanceof HttpError) {
        const body = { error: error.message };
        if (error.details) body.details = error.details;
        return res.status(error.status).json(body);
    }

    console.error('[unhandled]', error);
    res.status(500).json({ error: '伺服器發生錯誤，請稍後再試' });
}

module.exports = { notFoundHandler, errorHandler };
