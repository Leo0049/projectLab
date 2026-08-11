'use strict';

const crypto = require('crypto');
const { getDb, writeTransaction } = require('../db');
const config = require('../config');
const { badRequest, notFound, conflict } = require('../utils/http');
const { createCheckMacValue, verifyCheckMacValue } = require('../payments/signature');

/**
 * 金流服務（儲值）
 *
 * 購票是從錢包餘額扣款（已有並發保護），儲值才走第三方金流。
 * 這樣金流的整合面積小、責任單一，也符合多數售票 App 的做法。
 *
 * 訂單狀態機：
 *   pending ──付款成功──> paid      （入帳，只會發生一次）
 *      │
 *      ├────付款失敗──> failed
 *      └────逾時未付──> expired
 *
 * 已經是終態（paid / failed / expired）的訂單不會再被回調改變，
 * 因此金流商重送通知也不會重複入帳。
 */

/**
 * 已經有結論、不該再被回調改變的狀態。
 *
 * 注意 expired 不在其中：那是「我方自己判定的逾時」，不代表金流商那邊沒收到錢。
 * 使用者在付款頁停留太久才完成付款是很常見的情況，
 * 如果把 expired 當成終態，就會發生「使用者付了錢卻沒入帳」。
 */
const TERMINAL_STATUSES = new Set(['paid', 'failed']);

/**
 * 產生我方訂單編號。金流商通常限制英數且有長度上限。
 */
function generateOrderNo() {
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `FT${stamp}${random}`;
}

/**
 * 把逾時未付款的訂單標記為 expired
 */
function expireStaleOrders() {
    getDb().prepare(`
        UPDATE payment_orders
        SET status = 'expired'
        WHERE status = 'pending' AND expires_at <= ?
    `).run(Date.now());
}

/**
 * 建立儲值訂單，回傳要送去金流商的表單參數。
 *
 * 真實環境會把 formData POST 到金流商的付款頁；
 * 沙盒環境則 POST 到本站的 /sandbox/checkout，流程與參數完全相同。
 *
 * @param {number} userId
 * @param {number} amount
 * @param {string} origin - 例如 http://localhost:3000
 */
const createDepositOrder = writeTransaction((userId, amount, origin) => {
    if (!Number.isInteger(amount) || amount < config.PAYMENT_MIN_AMOUNT) {
        throw badRequest(`儲值金額最低為 NT$ ${config.PAYMENT_MIN_AMOUNT}`);
    }
    if (amount > config.PAYMENT_MAX_AMOUNT) {
        throw badRequest(`單次儲值上限為 NT$ ${config.PAYMENT_MAX_AMOUNT}`);
    }

    const db = getDb();
    const merchantOrderNo = generateOrderNo();
    const expiresAt = Date.now() + config.PAYMENT_ORDER_TTL_MS;

    const orderId = db.prepare(`
        INSERT INTO payment_orders (merchant_order_no, user_id, amount, status, provider, expires_at)
        VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(merchantOrderNo, userId, amount, config.PAYMENT_PROVIDER, expiresAt).lastInsertRowid;

    // 綠界規格的欄位名稱，換成正式環境時這段不用改
    const formData = {
        MerchantID: config.PAYMENT_MERCHANT_ID,
        MerchantTradeNo: merchantOrderNo,
        MerchantTradeDate: new Date().toLocaleString('sv-SE').replace('-', '/').replace('-', '/'),
        PaymentType: 'aio',
        TotalAmount: String(amount),
        TradeDesc: 'FakeTheater 錢包儲值',
        ItemName: `錢包儲值 NT$${amount}`,
        ReturnURL: `${origin}/api/payments/webhook`,
        ClientBackURL: `${origin}/profile.html?payment=done`,
        ChoosePayment: 'Credit',
        EncryptType: '1'
    };

    formData.CheckMacValue = createCheckMacValue(
        formData, config.PAYMENT_HASH_KEY, config.PAYMENT_HASH_IV
    );

    return {
        orderId,
        merchantOrderNo,
        amount,
        expiresAt,
        // 沙盒的付款頁由本站提供；正式環境改成金流商的網址
        action: '/sandbox/checkout',
        formData
    };
});

/**
 * 處理金流回調（webhook）
 *
 * 三個必須做對的地方：
 *   1. 先驗簽章，沒過就當作偽造請求丟掉
 *   2. 金額要跟原訂單比對，不能相信回調傳來的數字
 *   3. 冪等：同一筆訂單重複通知只會入帳一次
 *
 * @param {Object} params - 金流商送來的完整參數
 * @returns {{orderNo:string, status:string, alreadyProcessed:boolean}}
 */
const handleCallback = writeTransaction((params) => {
    if (!verifyCheckMacValue(params, config.PAYMENT_HASH_KEY, config.PAYMENT_HASH_IV)) {
        throw badRequest('簽章驗證失敗');
    }

    const db = getDb();
    const merchantOrderNo = String(params.MerchantTradeNo || '');
    const order = db.prepare('SELECT * FROM payment_orders WHERE merchant_order_no = ?')
        .get(merchantOrderNo);

    if (!order) throw notFound('找不到這筆金流訂單');

    // 冪等：已經是終態就直接回報，不重複入帳
    if (TERMINAL_STATUSES.has(order.status)) {
        return { orderNo: merchantOrderNo, status: order.status, alreadyProcessed: true };
    }

    const success = String(params.RtnCode) === '1';
    const callbackRaw = JSON.stringify(params);

    if (!success) {
        db.prepare(`
            UPDATE payment_orders SET status = 'failed', callback_raw = ? WHERE id = ?
        `).run(callbackRaw, order.id);
        return { orderNo: merchantOrderNo, status: 'failed', alreadyProcessed: false };
    }

    // 金額以我方訂單為準，回調金額不符就視為異常
    const paidAmount = Number(params.TradeAmt);
    if (paidAmount !== order.amount) {
        db.prepare(`
            UPDATE payment_orders SET status = 'failed', callback_raw = ? WHERE id = ?
        `).run(callbackRaw, order.id);
        throw conflict('付款金額與訂單不符');
    }

    // 逾時之後才付款成功：錢確實收了，還是要入帳，只是留個紀錄方便對帳
    if (order.status === 'expired') {
        console.warn(`[payments] 訂單 ${merchantOrderNo} 逾時後才收到付款成功通知，仍予以入帳`);
    }

    db.prepare(`
        UPDATE payment_orders
        SET status = 'paid', provider_trade_no = ?, callback_raw = ?, paid_at = datetime('now')
        WHERE id = ?
    `).run(String(params.TradeNo || ''), callbackRaw, order.id);

    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?')
        .run(order.amount, order.user_id);

    db.prepare(`
        INSERT INTO transactions (user_id, type, amount) VALUES (?, '儲值', ?)
    `).run(order.user_id, order.amount);

    return { orderNo: merchantOrderNo, status: 'paid', alreadyProcessed: false };
});

/**
 * 查詢訂單狀態（前端付款完回來後輪詢用）
 */
function getOrderStatus(merchantOrderNo, userId) {
    expireStaleOrders();

    const order = getDb().prepare(`
        SELECT merchant_order_no AS merchantOrderNo, amount, status, created_at AS createdAt, paid_at AS paidAt
        FROM payment_orders
        WHERE merchant_order_no = ? AND user_id = ?
    `).get(merchantOrderNo, userId);

    if (!order) throw notFound('找不到這筆金流訂單');
    return order;
}

/**
 * 使用者的儲值紀錄
 */
function listOrders(userId, { limit = 20, offset = 0 } = {}) {
    expireStaleOrders();

    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) AS n FROM payment_orders WHERE user_id = ?')
        .get(userId).n;

    const orders = db.prepare(`
        SELECT merchant_order_no AS merchantOrderNo, amount, status, provider,
               created_at AS createdAt, paid_at AS paidAt
        FROM payment_orders
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ? OFFSET ?
    `).all(userId, limit, offset);

    return { orders, total, hasMore: offset + orders.length < total };
}

/**
 * 沙盒付款頁要用的訂單資料
 */
function getPendingOrderForSandbox(merchantOrderNo) {
    expireStaleOrders();

    return getDb().prepare(`
        SELECT o.merchant_order_no AS merchantOrderNo, o.amount, o.status, o.expires_at AS expiresAt,
               u.username
        FROM payment_orders o
        JOIN users u ON u.id = o.user_id
        WHERE o.merchant_order_no = ?
    `).get(merchantOrderNo);
}

/**
 * 沙盒模擬金流商送出回調：組出與正式環境相同格式的參數並簽章
 * @param {string} merchantOrderNo
 * @param {boolean} success
 */
function buildSandboxCallback(merchantOrderNo, success) {
    const order = getDb().prepare('SELECT amount FROM payment_orders WHERE merchant_order_no = ?')
        .get(merchantOrderNo);

    if (!order) throw notFound('找不到這筆金流訂單');

    const params = {
        MerchantID: config.PAYMENT_MERCHANT_ID,
        MerchantTradeNo: merchantOrderNo,
        TradeNo: `SB${Date.now()}`,
        TradeAmt: String(order.amount),
        PaymentDate: new Date().toLocaleString('sv-SE'),
        PaymentType: 'Credit_CreditCard',
        RtnCode: success ? '1' : '0',
        RtnMsg: success ? '交易成功' : '交易失敗',
        SimulatePaid: '0'
    };

    params.CheckMacValue = createCheckMacValue(
        params, config.PAYMENT_HASH_KEY, config.PAYMENT_HASH_IV
    );

    return params;
}

module.exports = {
    createDepositOrder,
    handleCallback,
    getOrderStatus,
    listOrders,
    getPendingOrderForSandbox,
    buildSandboxCallback,
    expireStaleOrders
};
