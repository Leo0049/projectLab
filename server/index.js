'use strict';

const config = require('./config');
const { createApp, initDatabase } = require('./app');

// 正式環境不允許沿用公開在原始碼裡的預設值。
// 這兩個一旦是預設值，任何人都能偽造 token 或直接登入管理後台。
const requiredInProd = [
    ['JWT_SECRET', 'JWT 簽章金鑰'],
    ['ADMIN_PASSWORD', '管理員密碼']
];

if (config.IS_PROD) {
    const missing = requiredInProd.filter(([name]) => !String(process.env[name] || '').trim());
    if (missing.length > 0) {
        missing.forEach(([name, label]) => {
            console.error(`啟動失敗：正式環境必須設定環境變數 ${name}（${label}）`);
        });
        process.exit(1);
    }
}

if (config.PAYMENT_PROVIDER !== 'sandbox' &&
    (!String(config.PAYMENT_HASH_KEY || '').trim() || !String(config.PAYMENT_HASH_IV || '').trim())) {
    console.error('啟動失敗：非沙盒金流必須設定 PAYMENT_HASH_KEY 與 PAYMENT_HASH_IV');
    process.exit(1);
}

initDatabase();

const app = createApp();

app.listen(config.PORT, () => {
    console.log(`FakeTheater 已啟動： http://localhost:${config.PORT}`);
    console.log(`資料庫： ${config.DB_PATH}`);
});
