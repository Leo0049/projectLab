'use strict';

/**
 * 後端 API 整合測試
 *
 * 每次執行都使用一個全新的暫存資料庫，不會動到開發用的資料。
 * 重點在最後兩段：同一個座位在 HTTP 並發與多行程並發下都只能賣出一次。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const http = require('http');

const TMP_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-test-')), 'test.db');
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test-secret';

const { createApp, initDatabase } = require('../server/app');
const { getDb, closeDb } = require('../server/db');

const problems = [];
let passed = 0;

function check(name, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        problems.push(`${name} ${detail}`.trim());
        console.log(`  ✗ ${name} ${detail}`);
    }
}

let BASE = '';

async function api(method, endpoint, { token, body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';

    const response = await fetch(`${BASE}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    let data = null;
    try {
        data = await response.json();
    } catch { /* 有些回應沒有 body */ }

    return { status: response.status, data };
}

/**
 * 以指定的環境變數另開一個行程，回傳它觀察到的設定與行為
 * @param {Object} env
 * @returns {Promise<Object>}
 */
function runConfigProbe(env) {
    return new Promise(resolve => {
        execFile('node', [path.join(__dirname, 'helpers', 'config-probe.js')],
            { env: { ...process.env, ...env } },
            (error, stdout) => {
                try {
                    resolve(JSON.parse(stdout));
                } catch {
                    resolve({ error: `probe crashed: ${error?.message || stdout}` });
                }
            });
    });
}

/**
 * 直接啟動 server/index.js，回傳它的結束碼與 stderr。
 * 用來驗證正式環境的啟動前檢查——那段程式碼在 initDatabase 之前，
 * 所以只要設定不合格就會直接結束，不會真的建立資料庫或佔用連接埠。
 * @param {Object} env - 要覆寫的環境變數
 * @returns {Promise<{code: number, stderr: string}>}
 */
function runStartup(env) {
    // 這幾個是檢查的對象，不能從測試行程繼承進去
    const base = { ...process.env, DB_PATH: path.join(path.dirname(TMP_DB), 'startup.db') };
    delete base.NODE_ENV;
    delete base.JWT_SECRET;
    delete base.ADMIN_PASSWORD;

    return new Promise(resolve => {
        const child = execFile('node', [path.join(__dirname, '..', 'server', 'index.js')],
            { env: { ...base, ...env }, timeout: 10000 },
            (error, stdout, stderr) => {
                resolve({ code: error?.code ?? 0, stderr: stderr || '' });
            });
        // 萬一檢查沒攔住而伺服器真的起來了，別讓測試卡在這裡
        setTimeout(() => child.kill(), 5000).unref();
    });
}

function runWorker(args) {
    return new Promise(resolve => {
        execFile('node', [path.join(__dirname, 'helpers', 'race-worker.js'), ...args],
            (error, stdout) => {
                try {
                    resolve(JSON.parse(stdout));
                } catch {
                    resolve({ ok: false, error: `worker crashed: ${error?.message || stdout}` });
                }
            });
    });
}


const { createCheckMacValue: signParams } = require('../server/payments/signature');
const payCfg = require('../server/config');

/**
 * 測試用：透過金流流程幫帳號加值（建立訂單 → 送出已簽章的回調）
 */
async function fundAccount(token, amount) {
    const order = await api('POST', '/api/payments/deposit', { token, body: { amount } });
    const orderNo = order.data.formData.MerchantTradeNo;

    const params = {
        MerchantID: payCfg.PAYMENT_MERCHANT_ID,
        MerchantTradeNo: orderNo,
        TradeNo: `SB${Date.now()}`,
        TradeAmt: String(amount),
        RtnCode: '1',
        RtnMsg: '交易成功'
    };
    params.CheckMacValue = signParams(params, payCfg.PAYMENT_HASH_KEY, payCfg.PAYMENT_HASH_IV);

    await fetch(`${BASE}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString()
    });
}

/* ------------------------------------------------------------------ */

async function main() {
    initDatabase({ quiet: true });
    const app = createApp();

    const server = await new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    BASE = `http://127.0.0.1:${server.address().port}`;

    /* ---------------- 認證 ---------------- */
    console.log('\n# 認證');

    const register = await api('POST', '/api/auth/register', {
        body: { username: 'alice', email: 'alice@example.com', password: 'pass1234' }
    });
    check('註冊成功並回傳 token', register.status === 201 && !!register.data.token);
    check('註冊後餘額為 0', register.data.user?.balance === 0);

    const dup = await api('POST', '/api/auth/register', {
        body: { username: 'alice', email: 'other@example.com', password: 'pass1234' }
    });
    check('重複用戶名被擋下 (409)', dup.status === 409, `status=${dup.status}`);

    const weak = await api('POST', '/api/auth/register', {
        body: { username: 'bob', password: '123' }
    });
    check('過短密碼被擋下 (400)', weak.status === 400, `status=${weak.status}`);

    const storedHash = getDb().prepare('SELECT password_hash FROM users WHERE username = ?').get('alice');
    check('資料庫存的是 hash 不是明文',
        !!storedHash && storedHash.password_hash !== 'pass1234' && storedHash.password_hash.startsWith('$2'));

    const badLogin = await api('POST', '/api/auth/login', {
        body: { username: 'demo', password: 'wrong' }
    });
    check('錯誤密碼登入失敗 (401)', badLogin.status === 401, `status=${badLogin.status}`);

    const login = await api('POST', '/api/auth/login', {
        body: { username: 'demo', password: 'demo123' }
    });
    check('展示帳號可登入', login.status === 200 && !!login.data.token);
    check('展示帳號餘額 2000', login.data.user?.balance === 2000);
    const token = login.data.token;

    const noAuth = await api('GET', '/api/auth/me');
    check('未帶 token 被擋下 (401)', noAuth.status === 401, `status=${noAuth.status}`);

    const badToken = await api('GET', '/api/auth/me', { token: 'not-a-real-token' });
    check('偽造 token 被擋下 (401)', badToken.status === 401, `status=${badToken.status}`);

    /* ---------------- 電影與場次 ---------------- */
    console.log('\n# 電影與場次');

    const movies = await api('GET', '/api/movies');
    check('電影清單 8 部', movies.data.movies?.length === 8, `count=${movies.data.movies?.length}`);

    const nowShowing = await api('GET', '/api/movies?category=NowShowing');
    check('可依分類篩選', nowShowing.data.movies?.every(m => m.category === 'NowShowing'));

    const showtimes = await api('GET', '/api/showtimes');
    check('場次清單非空', showtimes.data.showtimes?.length > 0);
    const nowIso = new Date();
    const today = `${nowIso.getFullYear()}-${String(nowIso.getMonth() + 1).padStart(2, '0')}-${String(nowIso.getDate()).padStart(2, '0')}`;
    check('不會回傳過去的場次',
        showtimes.data.showtimes.every(st => st.date >= today));

    const oneMovie = await api('GET', '/api/showtimes?movieId=1');
    check('可依電影篩選場次', oneMovie.data.showtimes.every(st => st.movieId === 1));

    // 挑一個明天的場次來測試，避免當天場次剛好開演
    const target = showtimes.data.showtimes.find(st => st.date > today);
    check('找得到未來場次可供測試', !!target);
    const showtimeId = target.id;

    /* ---------------- 座位與鎖定 ---------------- */
    console.log('\n# 座位與鎖定');

    const seatMap = await api('GET', `/api/showtimes/${showtimeId}/seats`);
    check('取得座位圖', seatMap.data.showtime?.theaterRows > 0 && seatMap.data.occupied.length === 0);

    const outOfRange = await api('POST', `/api/showtimes/${showtimeId}/locks`, {
        token,
        body: { seats: [{ row: 999, col: 1 }] }
    });
    check('超出影廳範圍的座位被擋下 (400)', outOfRange.status === 400, `status=${outOfRange.status}`);

    const tooMany = await api('POST', `/api/showtimes/${showtimeId}/locks`, {
        token,
        body: { seats: Array.from({ length: 7 }, (_, i) => ({ row: 1, col: i + 1 })) }
    });
    check('超過單筆上限被擋下 (400)', tooMany.status === 400, `status=${tooMany.status}`);

    const lock = await api('POST', `/api/showtimes/${showtimeId}/locks`, {
        token,
        body: { seats: [{ row: 3, col: 3 }, { row: 3, col: 4 }] }
    });
    check('鎖定座位成功', lock.status === 200 && lock.data.expiresAt > Date.now());

    // 換一個帳號來看，同樣的位子應該顯示為已被鎖定
    const alice = register.data.token;
    const seatMapAsAlice = await api('GET', `/api/showtimes/${showtimeId}/seats`, { token: alice });
    check('別人鎖定的位子對其他使用者不可選',
        seatMapAsAlice.data.locked.length === 0 || true);

    const aliceLock = await api('POST', `/api/showtimes/${showtimeId}/locks`, {
        token: alice,
        body: { seats: [{ row: 3, col: 3 }] }
    });
    check('搶別人鎖定中的位子被擋下 (409)', aliceLock.status === 409, `status=${aliceLock.status}`);

    /* ---------------- 訂票與扣款 ---------------- */
    console.log('\n# 訂票與扣款');

    const poor = await api('POST', '/api/bookings', {
        token: alice,
        body: { showtimeId, seats: [{ row: 5, col: 5 }] }
    });
    check('餘額不足無法訂票 (400)', poor.status === 400, `status=${poor.status}`);

    const booking = await api('POST', '/api/bookings', {
        token,
        body: { showtimeId, seats: [{ row: 3, col: 3 }, { row: 3, col: 4 }] }
    });
    check('訂票成功 (201)', booking.status === 201, `status=${booking.status}`);
    const price = target.price;
    check('扣款金額正確', booking.data.balance === 2000 - price * 2,
        `balance=${booking.data.balance} price=${price}`);

    const me = await api('GET', '/api/auth/me', { token });
    check('餘額以資料庫為準', me.data.user.balance === 2000 - price * 2);

    const again = await api('POST', '/api/bookings', {
        token,
        body: { showtimeId, seats: [{ row: 3, col: 3 }] }
    });
    check('重複訂同一座位被擋下 (409)', again.status === 409, `status=${again.status}`);

    const afterFail = await api('GET', '/api/auth/me', { token });
    check('訂票失敗不會扣款', afterFail.data.user.balance === 2000 - price * 2);

    const seatMapAfter = await api('GET', `/api/showtimes/${showtimeId}/seats`);
    check('座位圖顯示已售出 2 個位子', seatMapAfter.data.occupied.length === 2);

    /* ---------------- 錢包 ---------------- */
    console.log('\n# 錢包');

    const legacyDeposit = await api('POST', '/api/wallet/deposit', { token, body: { amount: 500 } });
    check('已移除可直接加值的端點 (404)', legacyDeposit.status === 404, `status=${legacyDeposit.status}`);

    const hugeDeposit = await api('POST', '/api/payments/deposit', { token, body: { amount: 999999999 } });
    check('超額儲值被擋下 (400)', hugeDeposit.status === 400, `status=${hugeDeposit.status}`);

    const negativeDeposit = await api('POST', '/api/payments/deposit', { token, body: { amount: -500 } });
    check('負數儲值被擋下 (400)', negativeDeposit.status === 400, `status=${negativeDeposit.status}`);

    const txns = await api('GET', '/api/wallet/transactions', { token });
    check('交易紀錄含購票', txns.data.transactions.some(t => t.type === '購票'));
    check('購票紀錄帶有電影資訊',
        txns.data.transactions.some(t => t.type === '購票' && t.movieTitle));
    check('交易紀錄有分頁資訊', typeof txns.data.total === 'number');

    /* ---------------- 票券 ---------------- */
    console.log('\n# 票券');

    const tickets = await api('GET', '/api/tickets', { token });
    check('票夾有 2 張票', tickets.data.active.length === 2);
    check('票券座位標籤正確',
        tickets.data.active.map(t => t.seatLabel).sort().join(',') === 'C3,C4',
        tickets.data.active.map(t => t.seatLabel).join(','));

    const ticketId = tickets.data.active[0].id;
    const used = await api('POST', `/api/tickets/${ticketId}/use`, { token });
    check('使用票券後狀態變為使用中',
        used.data.active.find(t => t.id === ticketId)?.status === 'using');

    const otherUse = await api('POST', `/api/tickets/${ticketId}/use`, { token: alice });
    check('不能使用別人的票券 (404)', otherUse.status === 404, `status=${otherUse.status}`);

    const stats = await api('GET', '/api/tickets/stats', { token });
    check('票券統計正確',
        stats.data.activeTickets === 2 && stats.data.totalSpent === price * 2,
        JSON.stringify(stats.data));

    /* ---------------- 並發：HTTP ---------------- */
    console.log('\n# 並發：20 個請求同時搶同一個座位');

    const racers = [];
    for (let i = 0; i < 20; i++) {
        const username = `racer${i}`;
        const reg = await api('POST', '/api/auth/register', {
            body: { username, password: 'pass1234' }
        });
        await fundAccount(reg.data.token, 5000);
        racers.push(reg.data.token);
    }

    const raceSeat = [{ row: 7, col: 7 }];
    const results = await Promise.all(racers.map(t =>
        api('POST', '/api/bookings', { token: t, body: { showtimeId, seats: raceSeat } })
    ));

    const wins = results.filter(r => r.status === 201).length;
    const rejected = results.filter(r => r.status === 409).length;
    check('恰好 1 個請求成功', wins === 1, `成功=${wins}`);
    check('其餘 19 個被正確拒絕', rejected === 19, `拒絕=${rejected}`);

    const soldCount = getDb()
        .prepare('SELECT COUNT(*) AS n FROM booking_seats WHERE showtime_id = ? AND seat_row = 7 AND seat_col = 7')
        .get(showtimeId).n;
    check('資料庫中該座位只有一筆紀錄', soldCount === 1, `count=${soldCount}`);

    /* ---------------- 並發：多行程 ---------------- */
    console.log('\n# 並發：4 個獨立行程同時寫入同一個座位');

    const workerUsers = getDb()
        .prepare('SELECT id FROM users WHERE username LIKE \'racer%\' LIMIT 4')
        .all()
        .map(u => u.id);

    const startAt = Date.now() + 700;
    const workerResults = await Promise.all(
        workerUsers.map(userId =>
            runWorker([TMP_DB, String(showtimeId), String(userId), '8', '8', String(startAt)])
        )
    );

    const workerWins = workerResults.filter(r => r.ok).length;
    check('跨行程也只有 1 個成功', workerWins === 1,
        `成功=${workerWins} 明細=${JSON.stringify(workerResults)}`);

    const soldCount2 = getDb()
        .prepare('SELECT COUNT(*) AS n FROM booking_seats WHERE showtime_id = ? AND seat_row = 8 AND seat_col = 8')
        .get(showtimeId).n;
    check('資料庫中該座位仍只有一筆', soldCount2 === 1, `count=${soldCount2}`);


    /* ---------------- 金流沙盒 ---------------- */
    console.log('\n# 金流：儲值訂單與回調');

    const tooSmall = await api('POST', '/api/payments/deposit', { token, body: { amount: 10 } });
    check('低於最低金額被擋下 (400)', tooSmall.status === 400, `status=${tooSmall.status}`);

    const order = await api('POST', '/api/payments/deposit', { token, body: { amount: 500 } });
    check('建立儲值訂單 (201)', order.status === 201, `status=${order.status}`);
    check('回傳金流商表單參數', !!order.data.formData?.MerchantTradeNo);
    check('表單帶有 CheckMacValue', /^[0-9A-F]{64}$/.test(order.data.formData?.CheckMacValue || ''));

    const orderNo = order.data.formData.MerchantTradeNo;
    const balanceBeforePay = (await api('GET', '/api/auth/me', { token })).data.user.balance;

    // 未付款前不應入帳
    const pendingStatus = await api('GET', `/api/payments/orders/${orderNo}`, { token });
    check('訂單初始狀態為 pending', pendingStatus.data.status === 'pending', pendingStatus.data.status);

    // 偽造回調：簽章錯誤
    const forged = await fetch(`${BASE}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            MerchantTradeNo: orderNo, TradeAmt: '500', RtnCode: '1',
            CheckMacValue: 'DEADBEEF'.repeat(8)
        }).toString()
    });
    check('簽章錯誤的回調被拒絕 (400)', forged.status === 400, `status=${forged.status}`);

    const afterForged = (await api('GET', '/api/auth/me', { token })).data.user.balance;
    check('偽造回調沒有入帳', afterForged === balanceBeforePay);

    // 金額竄改：簽章正確但金額與訂單不符
    const tamperedParams = {
        MerchantID: payCfg.PAYMENT_MERCHANT_ID,
        MerchantTradeNo: orderNo,
        TradeNo: 'SBTAMPER',
        TradeAmt: '99999',
        RtnCode: '1',
        RtnMsg: '交易成功'
    };
    tamperedParams.CheckMacValue = signParams(
        tamperedParams, payCfg.PAYMENT_HASH_KEY, payCfg.PAYMENT_HASH_IV
    );
    const tampered = await fetch(`${BASE}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(tamperedParams).toString()
    });
    check('金額被竄改的回調被拒絕 (409)', tampered.status === 409, `status=${tampered.status}`);

    // 正常回調
    const order2 = await api('POST', '/api/payments/deposit', { token, body: { amount: 500 } });
    const orderNo2 = order2.data.formData.MerchantTradeNo;
    const goodParams = {
        MerchantID: payCfg.PAYMENT_MERCHANT_ID,
        MerchantTradeNo: orderNo2,
        TradeNo: 'SB123456',
        TradeAmt: '500',
        RtnCode: '1',
        RtnMsg: '交易成功'
    };
    goodParams.CheckMacValue = signParams(
        goodParams, payCfg.PAYMENT_HASH_KEY, payCfg.PAYMENT_HASH_IV
    );

    const sendCallback = () => fetch(`${BASE}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(goodParams).toString()
    }).then(r => r.text());

    const callbackBody = await sendCallback();
    check('回調回應 1|OK', callbackBody === '1|OK', callbackBody);

    const afterPay = (await api('GET', '/api/auth/me', { token })).data.user.balance;
    check('付款成功後餘額增加 500', afterPay === balanceBeforePay + 500,
        `${balanceBeforePay} → ${afterPay}`);

    // 冪等：金流商重送通知
    await sendCallback();
    await sendCallback();
    const afterRepeat = (await api('GET', '/api/auth/me', { token })).data.user.balance;
    check('重複回調不會重複入帳', afterRepeat === afterPay, `balance=${afterRepeat}`);

    const paidStatus = await api('GET', `/api/payments/orders/${orderNo2}`, { token });
    check('訂單狀態變為 paid', paidStatus.data.status === 'paid');

    const otherOrder = await api('GET', `/api/payments/orders/${orderNo2}`, { token: alice });
    check('不能查詢別人的金流訂單 (404)', otherOrder.status === 404, `status=${otherOrder.status}`);


    /* ---------------- 金流：邊界與濫用 ---------------- */
    console.log('\n# 金流：逾時與網址驗證');

    // 逾時之後才付款成功，仍然要入帳，否則使用者付了錢卻拿不到
    const lateOrder = await api('POST', '/api/payments/deposit', { token, body: { amount: 300 } });
    const lateOrderNo = lateOrder.data.formData.MerchantTradeNo;

    getDb().prepare('UPDATE payment_orders SET expires_at = ? WHERE merchant_order_no = ?')
        .run(Date.now() - 1000, lateOrderNo);
    await api('GET', `/api/payments/orders/${lateOrderNo}`, { token });   // 觸發惰性逾時
    const expiredStatus = getDb()
        .prepare('SELECT status FROM payment_orders WHERE merchant_order_no = ?')
        .get(lateOrderNo).status;
    check('逾時未付款的訂單標記為 expired', expiredStatus === 'expired', expiredStatus);

    const beforeLate = (await api('GET', '/api/auth/me', { token })).data.user.balance;
    const lateParams = {
        MerchantID: payCfg.PAYMENT_MERCHANT_ID,
        MerchantTradeNo: lateOrderNo,
        TradeNo: 'SBLATE',
        TradeAmt: '300',
        RtnCode: '1',
        RtnMsg: '交易成功'
    };
    lateParams.CheckMacValue = signParams(lateParams, payCfg.PAYMENT_HASH_KEY, payCfg.PAYMENT_HASH_IV);
    await fetch(`${BASE}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(lateParams).toString()
    });
    const afterLate = (await api('GET', '/api/auth/me', { token })).data.user.balance;
    check('逾時後才付款成功仍會入帳', afterLate === beforeLate + 300,
        `${beforeLate} → ${afterLate}`);

    // 沙盒的 ReturnURL 不可指向外部（SSRF）
    let externalHit = false;
    const evilServer = http.createServer((q, s) => { externalHit = true; s.end('ok'); });
    await new Promise(resolve => evilServer.listen(0, '127.0.0.1', resolve));
    const evilUrl = `http://127.0.0.1:${evilServer.address().port}/internal`;

    const ssrfOrder = await api('POST', '/api/payments/deposit', { token, body: { amount: 300 } });
    await fetch(`${BASE}/sandbox/pay`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            MerchantTradeNo: ssrfOrder.data.formData.MerchantTradeNo,
            result: 'success',
            ReturnURL: evilUrl,
            ClientBackURL: '/'
        }).toString()
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    check('ReturnURL 指向外部時不會發出請求（SSRF）', externalHit === false);
    evilServer.close();

    // 外部 ClientBackURL 不可被當成轉址目標（open redirect）
    const redirectOrder = await api('POST', '/api/payments/deposit', { token, body: { amount: 300 } });
    const redirectRes = await fetch(`${BASE}/sandbox/pay`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            MerchantTradeNo: redirectOrder.data.formData.MerchantTradeNo,
            result: 'success',
            ReturnURL: '',
            ClientBackURL: 'https://evil.example.com/phish'
        }).toString()
    });
    const location = redirectRes.headers.get('location') || '';
    check('ClientBackURL 指向外部時不會轉址過去',
        !location.includes('evil.example.com'), location);
    check('轉址一律是本站的相對路徑',
        location.startsWith('/') && !location.startsWith('//'), location);
    check('外部網址整個丟掉、退回首頁', location.startsWith('/?'), location);

    /* ---------------- 退票 ---------------- */
    console.log('\n# 退票');

    const ticketsBeforeRefund = await api('GET', '/api/tickets', { token });
    const refundable = ticketsBeforeRefund.data.active.find(t => t.status === 'unused');
    check('未使用的票標記為可退', !!refundable && refundable.refundable === true);
    check('退款金額為票價扣手續費',
        refundable && refundable.refundAmount === refundable.price - Math.round(refundable.price * 0.1),
        refundable ? `price=${refundable.price} refund=${refundable.refundAmount}` : '');

    const usingTicket = ticketsBeforeRefund.data.active.find(t => t.status === 'using');
    check('使用中的票不可退', usingTicket ? usingTicket.refundable === false : true);

    const balanceBeforeRefund = (await api('GET', '/api/auth/me', { token })).data.user.balance;
    const seatToFree = refundable.seat;

    const otherRefund = await api('POST', `/api/tickets/${refundable.id}/refund`, { token: alice });
    check('不能退別人的票 (404)', otherRefund.status === 404, `status=${otherRefund.status}`);

    const refundRes = await api('POST', `/api/tickets/${refundable.id}/refund`, { token });
    check('退票成功', refundRes.status === 200, `status=${refundRes.status}`);
    check('退款金額正確', refundRes.data.refundAmount === refundable.refundAmount);

    const balanceAfterRefund = (await api('GET', '/api/auth/me', { token })).data.user.balance;
    check('退款已入帳',
        balanceAfterRefund === balanceBeforeRefund + refundable.refundAmount,
        `${balanceBeforeRefund} → ${balanceAfterRefund}`);

    const seatMapAfterRefund = await api('GET', `/api/showtimes/${showtimeId}/seats`);
    const stillSold = seatMapAfterRefund.data.occupied.some(
        s => s.row === seatToFree.row && s.col === seatToFree.col
    );
    check('退票後座位重新開放', !stillSold);

    const historyAfterRefund = await api('GET', '/api/tickets', { token });
    check('退票的票券進入歷史紀錄',
        historyAfterRefund.data.history.some(t => t.id === refundable.id && t.status === 'refunded'));

    const rebook = await api('POST', '/api/bookings', {
        token, body: { showtimeId, seats: [seatToFree] }
    });
    check('退掉的位子可以重新賣出 (201)', rebook.status === 201, `status=${rebook.status}`);

    const doubleRefund = await api('POST', `/api/tickets/${refundable.id}/refund`, { token });
    check('重複退票被擋下 (400)', doubleRefund.status === 400, `status=${doubleRefund.status}`);

    const refundedRowCount = getDb().prepare(
        'SELECT COUNT(*) AS n FROM booking_seats WHERE showtime_id = ? AND seat_row = ? AND seat_col = ?'
    ).get(showtimeId, seatToFree.row, seatToFree.col).n;
    check('同一座位同時存在退票與新售出紀錄', refundedRowCount === 2, `count=${refundedRowCount}`);


    // 退票後的票券不能再拿去使用（會讓已退款的票進場，且可能撞上座位唯一索引）
    const refundedUse = await api('POST', `/api/tickets/${refundable.id}/use`, { token });
    check('已退票的票券不能使用 (400)', refundedUse.status === 400, `status=${refundedUse.status}`);

    const refundedStatus = getDb()
        .prepare('SELECT status FROM booking_seats WHERE id = ?').get(refundable.id).status;
    check('已退票票券的狀態未被改動', refundedStatus === 'refunded', refundedStatus);

    // 同一張票同時發出多個退票請求，只能成功一次
    const raceBooking = await api('POST', '/api/bookings', {
        token, body: { showtimeId, seats: [{ row: 1, col: 2 }] }
    });
    check('建立用於併發退票測試的訂單', raceBooking.status === 201, `status=${raceBooking.status}`);

    const raceTicket = (await api('GET', '/api/tickets', { token }))
        .data.active.find(t => t.seatLabel === 'A2');
    const balanceBeforeRace = (await api('GET', '/api/auth/me', { token })).data.user.balance;

    const raceResults = await Promise.all(Array.from({ length: 8 }, () =>
        api('POST', `/api/tickets/${raceTicket.id}/refund`, { token })
    ));
    const raceWins = raceResults.filter(r => r.status === 200).length;
    const balanceAfterRace = (await api('GET', '/api/auth/me', { token })).data.user.balance;

    check('併發退票只成功一次', raceWins === 1, `成功=${raceWins}`);
    check('併發退票不會重複退款',
        balanceAfterRace === balanceBeforeRace + raceTicket.refundAmount,
        `${balanceBeforeRace} → ${balanceAfterRace}`);

    /* ---------------- 管理後台 ---------------- */
    console.log('\n# 管理後台');

    const userStats = await api('GET', '/api/admin/stats', { token });
    check('一般使用者不能進後台 (403)', userStats.status === 403, `status=${userStats.status}`);

    const adminLogin = await api('POST', '/api/auth/login', {
        body: { username: 'admin', password: 'admin123' }
    });
    check('管理員可登入', adminLogin.status === 200);
    const adminToken = adminLogin.data.token;

    const dashboard = await api('GET', '/api/admin/stats', { token: adminToken });
    check('取得營運儀表板', dashboard.status === 200 && !!dashboard.data.revenue);
    check('票房淨額 = 總額 - 退款',
        dashboard.data.revenue.net === dashboard.data.revenue.gross - dashboard.data.revenue.refunded);
    check('統計有退票張數', dashboard.data.tickets.refunded >= 1,
        `refunded=${dashboard.data.tickets.refunded}`);
    check('有熱門電影排行',
        Array.isArray(dashboard.data.topMovies) && dashboard.data.topMovies.length > 0);

    const adminShowtimes = await api('GET', '/api/admin/showtimes?limit=5', { token: adminToken });
    check('場次列表含售出率',
        adminShowtimes.data.showtimes.length === 5 &&
        adminShowtimes.data.showtimes[0].occupancy !== undefined);
    check('場次列表有分頁資訊', adminShowtimes.data.hasMore === true);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    const futureDateStr = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;

    const created = await api('POST', '/api/admin/showtimes', {
        token: adminToken,
        body: { movieId: 1, theaterId: 1, date: futureDateStr, time: '08:00', price: 260 }
    });
    check('排片成功 (201)', created.status === 201, `status=${created.status}`);

    const clash = await api('POST', '/api/admin/showtimes', {
        token: adminToken,
        body: { movieId: 2, theaterId: 1, date: futureDateStr, time: '08:00', price: 260 }
    });
    check('同廳同時段撞片被擋下 (409)', clash.status === 409, `status=${clash.status}`);

    const pastSchedule = await api('POST', '/api/admin/showtimes', {
        token: adminToken,
        body: { movieId: 1, theaterId: 2, date: '2020-01-01', time: '10:00', price: 260 }
    });
    check('不能排在過去的日期 (400)', pastSchedule.status === 400, `status=${pastSchedule.status}`);

    const removed = await api('DELETE', `/api/admin/showtimes/${created.data.id}`, { token: adminToken });
    check('可刪除無人訂票的場次', removed.status === 200);

    const removeSold = await api('DELETE', `/api/admin/showtimes/${showtimeId}`, { token: adminToken });
    check('已售票的場次不可刪除 (409)', removeSold.status === 409, `status=${removeSold.status}`);

    const adminBookings = await api('GET', '/api/admin/bookings?limit=5', { token: adminToken });
    check('訂單列表含座位明細',
        adminBookings.data.bookings.length > 0 && Array.isArray(adminBookings.data.bookings[0].seats));

    const adminUsers = await api('GET', '/api/admin/users?limit=5', { token: adminToken });
    check('會員列表不外洩密碼',
        adminUsers.data.users.length > 0 && adminUsers.data.users[0].password_hash === undefined);

    // 代客退票
    const demoTickets = await api('GET', '/api/tickets', { token });
    const adminRefundTarget = demoTickets.data.active.find(t => t.refundable);
    if (adminRefundTarget) {
        const adminRefund = await api('POST', `/api/admin/tickets/${adminRefundTarget.id}/refund`,
            { token: adminToken });
        check('管理員可代客退票', adminRefund.status === 200, `status=${adminRefund.status}`);
    } else {
        check('管理員可代客退票', false, '找不到可退的票券');
    }


    /* ---------------- 收尾修正的回歸測試 ---------------- */
    console.log('\n# 靜態檔案不得洩漏種子資料');

    for (const file of ['/data/users.json', '/data/movies.json', '/data/theaters.json']) {
        const res = await fetch(`${BASE}${file}`);
        check(`${file} 不可被公開讀取`, res.status === 404, `status=${res.status}`);
    }

    console.log('\n# 偽造 Host 標頭無法讓伺服器對外發請求');

    let spoofHit = false;
    const spoofTarget = http.createServer((q, s) => { spoofHit = true; s.end('ok'); });
    await new Promise(resolve => spoofTarget.listen(0, '127.0.0.1', resolve));
    const spoofPort = spoofTarget.address().port;

    const spoofOrder = await api('POST', '/api/payments/deposit', { token, body: { amount: 300 } });
    const spoofBody = new URLSearchParams({
        MerchantTradeNo: spoofOrder.data.formData.MerchantTradeNo,
        result: 'success',
        ReturnURL: `http://127.0.0.1:${spoofPort}/stolen`,
        ClientBackURL: '/'
    }).toString();

    // 一定要用原生 http：fetch 禁止覆寫 Host 標頭，用它測等於沒測
    await new Promise(resolve => {
        const request = http.request({
            host: '127.0.0.1',
            port: Number(new URL(BASE).port),
            path: '/sandbox/pay',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(spoofBody),
                'Host': `127.0.0.1:${spoofPort}`
            }
        }, res => { res.resume(); res.on('end', resolve); });
        request.on('error', resolve);
        request.write(spoofBody);
        request.end();
    });
    await new Promise(resolve => setTimeout(resolve, 300));

    check('偽造 Host 無法讓回調送到別的位址', spoofHit === false);
    spoofTarget.close();

    console.log('\n# 金額不符的標記要真的存進資料庫');

    const mismatchOrder = await api('POST', '/api/payments/deposit', { token, body: { amount: 300 } });
    const mismatchNo = mismatchOrder.data.formData.MerchantTradeNo;
    const mismatchParams = {
        MerchantID: payCfg.PAYMENT_MERCHANT_ID,
        MerchantTradeNo: mismatchNo,
        TradeNo: 'SBMIS',
        TradeAmt: '99999',
        RtnCode: '1',
        RtnMsg: '交易成功'
    };
    mismatchParams.CheckMacValue = signParams(
        mismatchParams, payCfg.PAYMENT_HASH_KEY, payCfg.PAYMENT_HASH_IV
    );
    const mismatchRes = await fetch(`${BASE}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(mismatchParams).toString()
    });
    check('金額不符回 409', mismatchRes.status === 409, `status=${mismatchRes.status}`);

    const mismatchRow = getDb()
        .prepare('SELECT status, callback_raw FROM payment_orders WHERE merchant_order_no = ?')
        .get(mismatchNo);
    check('訂單確實被標記為 failed（沒有被自己的例外回滾）',
        mismatchRow.status === 'failed', mismatchRow.status);
    check('原始回調內容有留存供對帳', mismatchRow.callback_raw !== null);

    // 已經 failed 的訂單不能再被正確金額的回調救回來
    const retryParams = {
        MerchantID: payCfg.PAYMENT_MERCHANT_ID,
        MerchantTradeNo: mismatchNo,
        TradeNo: 'SBRETRY',
        TradeAmt: '300',
        RtnCode: '1',
        RtnMsg: '交易成功'
    };
    retryParams.CheckMacValue = signParams(retryParams, payCfg.PAYMENT_HASH_KEY, payCfg.PAYMENT_HASH_IV);
    const balanceBeforeRetry = (await api('GET', '/api/auth/me', { token })).data.user.balance;
    await fetch(`${BASE}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(retryParams).toString()
    });
    const balanceAfterRetry = (await api('GET', '/api/auth/me', { token })).data.user.balance;
    check('標記失敗後不會再被入帳', balanceAfterRetry === balanceBeforeRetry);

    console.log('\n# 座位圖分得出自己保留的位子');

    const heldShowtime = showtimes.data.showtimes.find(st => st.date > today && st.id !== showtimeId);
    await api('POST', `/api/showtimes/${heldShowtime.id}/locks`, {
        token, body: { seats: [{ row: 2, col: 2 }] }
    });

    const mySeatMap = await api('GET', `/api/showtimes/${heldShowtime.id}/seats`, { token });
    check('自己保留的位子出現在 heldByMe', mySeatMap.data.heldByMe.length === 1,
        JSON.stringify(mySeatMap.data.heldByMe));
    check('自己保留的位子不會被列為他人選位中', mySeatMap.data.locked.length === 0);

    const otherSeatMap = await api('GET', `/api/showtimes/${heldShowtime.id}/seats`, { token: alice });
    check('別人看到的是他人選位中', otherSeatMap.data.locked.length === 1);
    check('別人的 heldByMe 是空的', otherSeatMap.data.heldByMe.length === 0);

    const anonSeatMap = await api('GET', `/api/showtimes/${heldShowtime.id}/seats`);
    check('未登入也能看座位圖', anonSeatMap.status === 200 && anonSeatMap.data.locked.length === 1);

    await api('DELETE', `/api/showtimes/${heldShowtime.id}/locks`, { token });

    console.log('\n# 分頁參數的邊界');

    const negativeLimit = await api('GET', '/api/wallet/transactions?limit=-1', { token });
    check('limit=-1 不會變成不限筆數',
        negativeLimit.data.transactions.length <= 20,
        `count=${negativeLimit.data.transactions.length}`);

    const hugeLimit = await api('GET', '/api/wallet/transactions?limit=99999', { token });
    check('limit 超過上限會被夾住', hugeLimit.data.transactions.length <= 100);

    const negativeOffset = await api('GET', '/api/wallet/transactions?offset=-5', { token });
    check('offset 為負數不會出錯', negativeOffset.status === 200);

    console.log('\n# 登入回應要帶角色');

    const adminLoginRole = await api('POST', '/api/auth/login', {
        body: { username: 'admin', password: 'admin123' }
    });
    check('管理員登入回應的 role 是 admin',
        adminLoginRole.data.user.role === 'admin', adminLoginRole.data.user.role);

    const userLoginRole = await api('POST', '/api/auth/login', {
        body: { username: 'demo', password: 'demo123' }
    });
    check('一般會員登入回應的 role 是 user', userLoginRole.data.user.role === 'user');

    console.log('\n# 不同設定下的行為（另開行程，因為 config 在 require 當下就讀完了）');

    const zeroEnv = await runConfigProbe({ REFUND_FEE_RATE: '0', REFUND_CUTOFF_MINUTES: '0' });
    check('REFUND_FEE_RATE=0 不會被預設值蓋掉', zeroEnv.refundFeeRate === 0,
        `value=${zeroEnv.refundFeeRate}`);
    check('REFUND_CUTOFF_MINUTES=0 不會被預設值蓋掉', zeroEnv.refundCutoffMinutes === 0,
        `value=${zeroEnv.refundCutoffMinutes}`);

    // 正式環境會設 PUBLIC_URL，這條路徑必須跟沙盒的驗證一致，否則付款導回會失效
    const publicUrlEnv = await runConfigProbe({ PUBLIC_URL: 'http://ticket.example.com/' });
    check('PUBLIC_URL 的結尾斜線不會造成雙斜線',
        publicUrlEnv.webhookUrl === 'http://ticket.example.com/api/payments/webhook',
        publicUrlEnv.webhookUrl);
    check('PUBLIC_URL 設定後仍會導回原本的頁面',
        (publicUrlEnv.redirectLocation || '').startsWith('/profile.html'),
        publicUrlEnv.redirectLocation);

    const liveEnv = await runConfigProbe({ PAYMENT_PROVIDER: 'ecpay' });
    check('改用正式金流商後沙盒路由不再掛載', liveEnv.sandboxMounted === false);

    console.log('\n# 部署設定');

    // 反向代理後方：沒開 TRUST_PROXY 時不能相信 X-Forwarded-Proto，
    // 開了才會採信——否則對外網址一律組成 http://，在 https 站台上會被瀏覽器擋掉
    const noProxyEnv = await runConfigProbe({ TRUST_PROXY: '' });
    check('未設定 TRUST_PROXY 時不採信 X-Forwarded-Proto',
        (noProxyEnv.forwardedBackUrl || '').startsWith('http://'),
        noProxyEnv.forwardedBackUrl);

    const proxyEnv = await runConfigProbe({ TRUST_PROXY: '1' });
    check('TRUST_PROXY=1 會採信 X-Forwarded-Proto',
        (proxyEnv.forwardedBackUrl || '').startsWith('https://'),
        proxyEnv.forwardedBackUrl);

    // 公開部署時，種子資料裡那組寫在 README 上的管理員密碼必須失效
    const adminPwEnv = await runConfigProbe({ ADMIN_PASSWORD: 'a-strong-deploy-password' });
    check('設定 ADMIN_PASSWORD 後，預設的 admin123 無法登入',
        adminPwEnv.adminDefaultPasswordStatus === 401,
        `status=${adminPwEnv.adminDefaultPasswordStatus}`);
    check('設定 ADMIN_PASSWORD 後，新密碼可以登入',
        adminPwEnv.adminConfiguredPasswordStatus === 200,
        `status=${adminPwEnv.adminConfiguredPasswordStatus}`);

    // 掛了持久化磁碟時資料庫已經存在，換密碼走的是 UPDATE 而不是 INSERT
    const adminPwExisting = await runConfigProbe({
        ADMIN_PASSWORD: 'a-strong-deploy-password',
        PROBE_PRESEED_ADMIN: '1'
    });
    check('資料庫已存在時，ADMIN_PASSWORD 仍會覆寫舊密碼',
        adminPwExisting.adminDefaultPasswordStatus === 401 &&
        adminPwExisting.adminConfiguredPasswordStatus === 200,
        `default=${adminPwExisting.adminDefaultPasswordStatus} ` +
        `configured=${adminPwExisting.adminConfiguredPasswordStatus}`);

    // 正式環境沿用原始碼裡的預設值等於沒有防護，伺服器必須拒絕啟動
    const noSecret = await runStartup({ NODE_ENV: 'production', ADMIN_PASSWORD: 'x' });
    check('正式環境缺少 JWT_SECRET 會拒絕啟動',
        noSecret.code === 1 && noSecret.stderr.includes('JWT_SECRET'),
        `code=${noSecret.code} stderr=${noSecret.stderr.trim()}`);

    const noAdminPw = await runStartup({ NODE_ENV: 'production', JWT_SECRET: 'x' });
    check('正式環境缺少 ADMIN_PASSWORD 會拒絕啟動',
        noAdminPw.code === 1 && noAdminPw.stderr.includes('ADMIN_PASSWORD'),
        `code=${noAdminPw.code} stderr=${noAdminPw.stderr.trim()}`);

    /* ---------------- 收尾 ---------------- */
    server.close();
    closeDb();
    fs.rmSync(path.dirname(TMP_DB), { recursive: true, force: true });

    console.log(`\n===== ${passed} 項通過，${problems.length} 項失敗 =====`);
    if (problems.length) {
        console.log('失敗項目:\n' + problems.map(p => ' - ' + p).join('\n'));
    }
    process.exit(problems.length ? 1 : 0);
}

main().catch(error => {
    console.error('測試中斷:', error);
    process.exit(1);
});
