'use strict';

const express = require('express');
const config = require('../config');
const paymentService = require('../services/payments');
const { verifyCheckMacValue } = require('../payments/signature');
const { publicOrigin, internalUrl, toLocalPath } = require('../utils/urls');

const router = express.Router();

/**
 * 沙盒金流商
 *
 * 這幾支路由「不是本站的一部分」——它們在模擬第三方金流商的角色，
 * 所以刻意用獨立的版型，讓人一眼看出已經離開 FakeTheater。
 *
 * 換成真的綠界／藍新時，整個 server/routes/sandbox.js 可以直接刪掉，
 * 只要把 createDepositOrder 裡的 action 改成金流商的網址即可，
 * 送出的參數與簽章規則完全相同。
 */

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderPage(title, body) {
    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/pic/favicon.svg" type="image/svg+xml">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #eef1f6; padding: 24px;
    font-family: -apple-system, "Segoe UI", "Noto Sans TC", sans-serif; color: #1f2733;
  }
  .gateway { width: 100%; max-width: 460px; background: #fff; border-radius: 14px;
             box-shadow: 0 12px 40px rgba(0,0,0,.12); overflow: hidden; }
  .gateway-header { background: #16406b; color: #fff; padding: 18px 24px; }
  .gateway-header h1 { margin: 0; font-size: 1.05rem; letter-spacing: .04em; }
  .gateway-header p { margin: 4px 0 0; font-size: .78rem; opacity: .75; }
  .sandbox-flag { display: inline-block; margin-top: 8px; padding: 3px 9px; border-radius: 99px;
                  background: #ffcf33; color: #4a3600; font-size: .72rem; font-weight: 700; }
  .gateway-body { padding: 24px; }
  .row { display: flex; justify-content: space-between; padding: 9px 0; font-size: .9rem;
         border-bottom: 1px solid #eef1f5; }
  .row:last-of-type { border-bottom: none; }
  .row span:first-child { color: #6b7787; }
  .row span:last-child { font-weight: 600; }
  .amount { font-size: 1.9rem; font-weight: 800; color: #16406b; text-align: center;
            padding: 18px 0 6px; }
  .card-fields { margin: 18px 0; padding: 16px; background: #f7f9fc; border-radius: 10px; }
  .card-fields label { display: block; font-size: .75rem; color: #6b7787; margin-bottom: 4px; }
  .card-fields input { width: 100%; padding: 9px 11px; border: 1px solid #d6dde7;
                       border-radius: 7px; font-size: .92rem; margin-bottom: 11px; background: #fff; }
  .card-fields input:last-child { margin-bottom: 0; }
  .hint { font-size: .74rem; color: #8b95a3; margin-top: 6px; }
  .actions { display: grid; gap: 10px; margin-top: 20px; }
  button { padding: 13px; border: none; border-radius: 9px; font-size: .95rem;
           font-weight: 700; cursor: pointer; font-family: inherit; }
  .btn-pay { background: #1c8f5a; color: #fff; }
  .btn-pay:hover { background: #17784b; }
  .btn-fail { background: #fff; color: #b4232a; border: 1px solid #e3c2c4; }
  .btn-fail:hover { background: #fdf3f3; }
  .notice { margin-top: 18px; padding: 11px 13px; border-radius: 8px; background: #fff8e1;
            border: 1px solid #ffe4a0; font-size: .76rem; color: #6b5518; line-height: 1.6; }
  .status { text-align: center; padding: 12px 0 4px; }
  .status .icon { font-size: 2.6rem; }
  .status h2 { margin: 10px 0 4px; font-size: 1.15rem; }
  .status p { margin: 0; color: #6b7787; font-size: .88rem; }
</style>
</head>
<body>
  <div class="gateway">${body}</div>
</body>
</html>`;
}

/**
 * POST /sandbox/checkout
 * 相當於使用者被導向金流商的付款頁。
 * 收到的參數與正式環境送出的完全一樣，這裡先驗一次簽章，確認我方組的參數沒問題。
 */
router.post('/checkout', (req, res) => {
    const params = req.body || {};

    const signatureOk = verifyCheckMacValue(params, config.PAYMENT_HASH_KEY, config.PAYMENT_HASH_IV);
    if (!signatureOk) {
        return res.status(400).send(renderPage('簽章錯誤', `
            <div class="gateway-header">
                <h1>付款失敗</h1>
                <p>Sandbox Payment Gateway</p>
            </div>
            <div class="gateway-body">
                <div class="status">
                    <div class="icon">⚠️</div>
                    <h2>CheckMacValue 驗證失敗</h2>
                    <p>特店送來的參數與簽章不符，交易已中止。</p>
                </div>
            </div>
        `));
    }

    const orderNo = String(params.MerchantTradeNo || '');
    const order = paymentService.getPendingOrderForSandbox(orderNo);

    if (!order || order.status !== 'pending') {
        return res.status(400).send(renderPage('訂單無效', `
            <div class="gateway-header">
                <h1>無法付款</h1>
                <p>Sandbox Payment Gateway</p>
            </div>
            <div class="gateway-body">
                <div class="status">
                    <div class="icon">🚫</div>
                    <h2>訂單無效或已處理</h2>
                    <p>訂單編號 ${escapeHtml(orderNo)} 目前狀態為 ${escapeHtml(order?.status || '不存在')}。</p>
                </div>
            </div>
        `));
    }

    res.send(renderPage('沙盒金流付款', `
        <div class="gateway-header">
            <h1>Sandbox Payment Gateway</h1>
            <p>特店代號 ${escapeHtml(params.MerchantID)}</p>
            <span class="sandbox-flag">測試環境 · 不會產生真實交易</span>
        </div>
        <div class="gateway-body">
            <div class="amount">NT$ ${escapeHtml(order.amount)}</div>
            <div class="row"><span>商品名稱</span><span>${escapeHtml(params.ItemName)}</span></div>
            <div class="row"><span>訂單編號</span><span>${escapeHtml(orderNo)}</span></div>
            <div class="row"><span>付款人</span><span>${escapeHtml(order.username)}</span></div>
            <div class="row"><span>付款方式</span><span>信用卡</span></div>

            <div class="card-fields">
                <label for="card-no">卡號</label>
                <input id="card-no" value="4311-9522-2222-2222" readonly>
                <label for="card-exp">有效期限 / 安全碼</label>
                <input id="card-exp" value="12/30　　123" readonly>
                <div class="hint">測試卡號已自動帶入，不會向任何金融機構請款。</div>
            </div>

            <form method="POST" action="/sandbox/pay" class="actions">
                <input type="hidden" name="MerchantTradeNo" value="${escapeHtml(orderNo)}">
                <input type="hidden" name="ClientBackURL"
                       value="${escapeHtml(toLocalPath(params.ClientBackURL, '/', publicOrigin(req)))}">
                <button type="submit" name="result" value="success" class="btn-pay" id="sandbox-pay-success">
                    模擬付款成功
                </button>
                <button type="submit" name="result" value="fail" class="btn-fail" id="sandbox-pay-fail">
                    模擬付款失敗
                </button>
            </form>

            <div class="notice">
                這是模擬的金流商付款頁。按下按鈕後，本頁會以伺服器對伺服器的方式
                將帶有 CheckMacValue 簽章的結果送到特店的 ReturnURL，
                流程與綠界 ECPay 正式環境相同。
            </div>
        </div>
    `));
});

/**
 * POST /sandbox/pay
 *
 * 使用者按下付款後，金流商要做兩件事：
 *   1. 伺服器對伺服器把結果通知特店（webhook）
 *   2. 把使用者的瀏覽器導回特店指定的頁面
 * 這裡兩件都做，順序也與真實環境一致（先通知、再導回）。
 */
router.post('/pay', async (req, res, next) => {
    try {
        const orderNo = String(req.body?.MerchantTradeNo || '');
        const success = req.body?.result === 'success';

        const callbackParams = paymentService.buildSandboxCallback(orderNo, success);

        // 伺服器對伺服器通知。
        // 回調位址一律由這條連線的實際本地位址組出來，完全不看表單傳來的 ReturnURL——
        // 否則任何人都能讓伺服器對他指定的位址發出請求（SSRF）。
        try {
            await fetch(internalUrl(req, '/api/payments/webhook'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(callbackParams).toString()
            });
        } catch (error) {
            console.error('沙盒回調失敗:', error);
        }

        // 導回特店。降級成相對路徑，跨站轉址的可能性直接消失。
        const backPath = toLocalPath(req.body?.ClientBackURL, '/', publicOrigin(req));
        const separator = backPath.includes('?') ? '&' : '?';
        const backUrl = `${backPath}${separator}order=${encodeURIComponent(orderNo)}` +
            `&result=${success ? 'success' : 'fail'}`;

        res.redirect(303, backUrl);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
