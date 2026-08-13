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
        trustProxy: config.TRUST_PROXY,
        sandboxMounted: null,
        webhookUrl: null,
        clientBackUrl: null,
        forwardedBackUrl: null,
        redirectLocation: null,
        adminDefaultPasswordStatus: null,
        adminConfiguredPasswordStatus: null
    };

    try {
        // 模擬「資料庫已經存在、admin 是舊密碼」的重新部署情境。
        // 這條路徑用的是 UPDATE 而不是 INSERT，是換密碼真正會走到的分支。
        if (process.env.PROBE_PRESEED_ADMIN === '1') {
            const bcrypt = require('bcryptjs');
            const { getDb, migrate } = require('../../server/db');
            migrate();
            getDb().prepare(`
                INSERT INTO users (id, username, email, password_hash, balance, role)
                VALUES (4, 'admin', 'admin@faketheater.com', ?, 0, 'admin')
            `).run(bcrypt.hashSync('admin123', 10));
        }

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

        // 反向代理會用 X-Forwarded-Proto 告知原始通訊協定。
        // 有沒有採信它，取決於 TRUST_PROXY 有沒有開。
        const forwarded = await post(port, '/api/payments/deposit', { amount: 300 }, {
            Authorization: `Bearer ${token}`,
            'X-Forwarded-Proto': 'https'
        });
        result.forwardedBackUrl = JSON.parse(forwarded.body).formData?.ClientBackURL;

        // 管理員密碼：預設值還能不能登入，設定的新密碼能不能登入
        const adminDefault = await post(port, '/api/auth/login',
            { username: 'admin', password: 'admin123' });
        result.adminDefaultPasswordStatus = adminDefault.status;

        if (config.ADMIN_PASSWORD) {
            const adminConfigured = await post(port, '/api/auth/login',
                { username: 'admin', password: config.ADMIN_PASSWORD });
            result.adminConfiguredPasswordStatus = adminConfigured.status;
        }

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
