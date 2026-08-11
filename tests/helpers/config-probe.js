'use strict';

/**
 * 設定探測子行程
 *
 * config 是在 require 當下就讀完環境變數的，同一個行程內改 env 不會生效，
 * 所以要驗證「不同設定下的行為」只能另開行程。
 *
 * 由 tests/api.js 以特定的環境變數啟動，跑完把結果以 JSON 印到 stdout。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cfg-'));
process.env.DB_PATH = path.join(TMP, 'cfg.db');
process.env.JWT_SECRET = 'config-probe';

const config = require('../../server/config');
const { createApp, initDatabase } = require('../../server/app');

function post(port, pathname, body, headers = {}) {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    return new Promise(resolve => {
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: pathname,
            method: 'POST',
            headers: {
                'Content-Type': typeof body === 'string'
                    ? 'application/x-www-form-urlencoded'
                    : 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                ...headers
            }
        }, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve({
                status: res.statusCode,
                location: res.headers.location,
                body: data
            }));
        });
        req.on('error', error => resolve({ status: 0, body: String(error) }));
        req.write(payload);
        req.end();
    });
}

(async () => {
    const result = {
        refundFeeRate: config.REFUND_FEE_RATE,
        refundCutoffMinutes: config.REFUND_CUTOFF_MINUTES,
        publicUrl: config.PUBLIC_URL,
        sandboxMounted: null,
        webhookUrl: null,
        clientBackUrl: null,
        redirectLocation: null
    };

    try {
        initDatabase({ quiet: true });
        const server = await new Promise(resolve => {
            const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
        });
        const port = server.address().port;

        const login = await post(port, '/api/auth/login',
            { username: 'demo', password: 'demo123' });
        const token = JSON.parse(login.body).token;

        const order = await post(port, '/api/payments/deposit', { amount: 300 },
            { Authorization: `Bearer ${token}` });
        const orderData = JSON.parse(order.body);

        result.webhookUrl = orderData.formData?.ReturnURL;
        result.clientBackUrl = orderData.formData?.ClientBackURL;

        // 沙盒有沒有被掛載
        const sandbox = await post(port, '/sandbox/checkout', 'MerchantTradeNo=x');
        result.sandboxMounted = sandbox.status !== 404;

        // 走一次付款，看使用者被導回哪裡
        if (result.sandboxMounted && orderData.formData) {
            const pay = await post(port, '/sandbox/pay', new URLSearchParams({
                MerchantTradeNo: orderData.formData.MerchantTradeNo,
                result: 'success',
                ClientBackURL: orderData.formData.ClientBackURL
            }).toString());
            result.redirectLocation = pay.location;
        }

        server.close();
    } catch (error) {
        result.error = error.message;
    } finally {
        fs.rmSync(TMP, { recursive: true, force: true });
    }

    process.stdout.write(JSON.stringify(result));
})();
