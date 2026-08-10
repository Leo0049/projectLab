'use strict';

const config = require('./config');
const { createApp, initDatabase } = require('./app');

// 正式環境不允許用開發用的預設金鑰
if (config.IS_PROD && !process.env.JWT_SECRET) {
    console.error('啟動失敗：正式環境必須設定環境變數 JWT_SECRET');
    process.exit(1);
}

initDatabase();

const app = createApp();

app.listen(config.PORT, () => {
    console.log(`FakeTheater 已啟動： http://localhost:${config.PORT}`);
    console.log(`資料庫： ${config.DB_PATH}`);
});
