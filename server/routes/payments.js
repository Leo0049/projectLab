'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { badRequest } = require('../utils/http');
const paymentService = require('../services/payments');

const router = express.Router();

/**
 * 取得本站對外的網址，用來組回調與返回網址
 */
function originOf(req) {
    return `${req.protocol}://${req.get('host')}`;
}

/**
 * POST /api/payments/deposit
 * 建立儲值訂單，回傳要送去金流商的表單
 */
router.post('/deposit', requireAuth, (req, res) => {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
        throw badRequest('請輸入有效的儲值金額');
    }

    const order = paymentService.createDepositOrder(req.user.id, amount, originOf(req));
    res.status(201).json(order);
});

/**
 * POST /api/payments/webhook
 *
 * 金流商的伺服器對伺服器通知。這裡不做登入驗證——呼叫者是金流商不是使用者，
 * 真正的身分驗證來自簽章（CheckMacValue）。
 *
 * 依綠界規格，處理成功要回傳純文字 "1|OK"。
 */
router.post('/webhook', (req, res) => {
    const result = paymentService.handleCallback(req.body || {});
    res.type('text/plain').send(result.status === 'paid' || result.alreadyProcessed ? '1|OK' : '0|FAIL');
});

/**
 * GET /api/payments/orders/:orderNo
 * 前端付款完回到本站後，用這支確認是否已入帳
 */
router.get('/orders/:orderNo', requireAuth, (req, res) => {
    res.json(paymentService.getOrderStatus(req.params.orderNo, req.user.id));
});

/**
 * GET /api/payments/orders?limit=&offset=
 */
router.get('/orders', requireAuth, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    res.json(paymentService.listOrders(req.user.id, { limit, offset }));
});

module.exports = router;
