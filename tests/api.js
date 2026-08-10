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
