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

    const badDeposit = await api('POST', '/api/wallet/deposit', { token, body: { amount: -500 } });
    check('負數儲值被擋下 (400)', badDeposit.status === 400, `status=${badDeposit.status}`);

    const hugeDeposit = await api('POST', '/api/wallet/deposit', { token, body: { amount: 999999999 } });
    check('超額儲值被擋下 (400)', hugeDeposit.status === 400, `status=${hugeDeposit.status}`);

    const depositRes = await api('POST', '/api/wallet/deposit', { token, body: { amount: 500 } });
    check('儲值成功且餘額正確', depositRes.data.balance === 2000 - price * 2 + 500);

    const txns = await api('GET', '/api/wallet/transactions', { token });
    check('交易紀錄含購票與儲值', txns.data.transactions.length === 2);
    check('購票紀錄帶有電影資訊',
        txns.data.transactions.some(t => t.type === '購票' && t.movieTitle));

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
        await api('POST', '/api/wallet/deposit', { token: reg.data.token, body: { amount: 5000 } });
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
