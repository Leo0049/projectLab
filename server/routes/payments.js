'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { badRequest, readPagination, HttpError } = require('../utils/http');
const { publicOrigin } = require('../utils/urls');
const paymentService = require('../services/payments');

const router = express.Router();

/**
 * POST /api/payments/deposit
 * 建立儲值訂單，回傳要送去金流商的表單
 */
router.post('/deposit', requireAuth, (req, res) => {
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
        throw badRequest('請輸入有效的儲值金額');
    }

    const order = paymentService.createDepositOrder(req.user.id, amount, publicOrigin(req));
    res.status(201).json(order);
});

/**
 * POST /api/payments/webhook
 *
 * 金流商的伺服器對伺服器通知。這裡不做登入驗證——呼叫者是金流商不是使用者，
 * 真正的身分驗證來自簽章（CheckMacValue）。
 *
 * 回應一律是純文字，依綠界規格：處理成功 "1|OK"，拒絕則帶對應的 HTTP 狀態碼與 "0|FAIL"
 * （非 JSON，金流商不會解析我們的錯誤格式）。
 */
router.post('/webhook', (req, res) => {
    let result;
    try {
        result = paymentService.handleCallback(req.body || {});
    } catch (error) {
        // 驗簽失敗、訂單不存在等預期內的拒絕：回純文字讓金流商重送或停止。
        // 非預期的伺服器錯誤照舊交給統一錯誤處理器。
        if (error instanceof HttpError) {
            return res.status(error.status).type('text/plain').send('0|FAIL');
        }
        throw error;
    }

    // 金額不符是異常狀況：訂單已標記為 failed（該筆交易有提交），
    // 但要讓金流商知道我方不接受這筆通知
    if (result.reason === 'amount_mismatch') {
        return res.status(409).type('text/plain').send('0|FAIL');
    }

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
    res.json(paymentService.listOrders(req.user.id, readPagination(req, { maxLimit: 50 })));
});

module.exports = router;
