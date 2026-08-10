/**
 * FakeTheater 端對端測試
 *
 * 會自己起一個靜態伺服器，用無頭 Chromium 跑完整流程：
 * 瀏覽 → 登入 → 訂票 → 付款 → 票夾 → 個人專區 → 帳號相關驗證。
 *
 * 執行方式：
 *   npm install
 *   npm test
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', 'FakeTheater');
const PORT = 8765;
const BASE = `http://127.0.0.1:${PORT}`;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.map': 'application/json'
};

function startServer() {
    const server = http.createServer((req, res) => {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);

        if (!filePath.startsWith(ROOT)) {
            res.writeHead(403).end();
            return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404).end('Not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
            res.end(data);
        });
    });

    return new Promise(resolve => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

/* ------------------------------------------------------------------ */

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

function watchErrors(page, sink) {
    page.on('pageerror', e => sink.push(`PAGEERROR ${e.message}`));
    page.on('console', m => {
        if (m.type() === 'error' && !m.text().includes('favicon')) sink.push(m.text());
    });
}

async function login(page, username, password) {
    await page.click('#nav-login-btn');
    await page.waitForSelector('#authModal.show');
    await page.fill('#login-username', username);
    await page.fill('#login-password', password);
    await page.click('#modal-login-form button[type=submit]');
    await page.waitForTimeout(1200);
}

async function pickShowtime(page, movieId) {
    await page.selectOption('#movie-select', movieId);
    await page.waitForFunction(() => !document.getElementById('date-select').disabled);
    await page.selectOption('#date-select', { index: 1 });
    await page.waitForFunction(() => !document.getElementById('showtime-select').disabled);
    await page.selectOption('#showtime-select', { index: 1 });
    await page.waitForSelector('.seat.available');
}

/* ------------------------------------------------------------------
   情境一：瀏覽 → 訂票 → 票夾
   ------------------------------------------------------------------ */

async function testBookingFlow(browser, errors) {
    const page = await (await browser.newContext()).newPage();
    watchErrors(page, errors);

    console.log('\n# 首頁');
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('.movie-card');
    check('電影卡數量 = 8', await page.locator('.movie-card').count() === 8);
    check('輪播張數 = 6', await page.locator('#carousel-inner .carousel-item').count() === 6);
    check('輪播無破圖', await page.locator('#carousel-inner img[src="undefined"]').count() === 0);
    check('頁尾已插入', await page.locator('#site-footer').count() === 1);
    await page.click('#comingsoon-tab');
    await page.waitForTimeout(200);
    check('分類篩選有結果', await page.locator('.movie-card').count() > 0);

    console.log('\n# 場次查詢 / 時刻表 / 電影詳情');
    await page.goto(`${BASE}/showtime.html`);
    await page.waitForSelector('.showtime-card');
    check('場次查詢有結果', await page.locator('.showtime-card').count() > 0);

    await page.goto(`${BASE}/schedule.html`);
    await page.waitForSelector('.schedule-card');
    check('時刻表有電影', await page.locator('.schedule-card').count() > 0);
    check('日期按鈕 = 7', await page.locator('.date-btn').count() === 7);

    await page.goto(`${BASE}/movie-detail.html?id=1`);
    await page.waitForSelector('.showtime-detail-btn');
    check('詳情頁有場次', await page.locator('.showtime-detail-btn').count() > 0);
    const href = await page.locator('.showtime-detail-btn').first().getAttribute('href');
    check('場次連結指向訂票頁', href.startsWith('booking.html?showtime='), href);

    console.log('\n# 登入');
    await page.goto(`${BASE}/booking.html`);
    await login(page, 'demo', 'demo123');
    check('導覽列顯示帳號', (await page.locator('#navbarDropdown').textContent()).trim() === 'demo');
    check('餘額顯示 2000', (await page.locator('.nav-link .user-balance').first().textContent()).trim() === '2000');

    console.log('\n# 訂票');
    await pickShowtime(page, '1');
    check('座位圖已產生', await page.locator('#seat-map .seat').count() > 0);

    const firstSeat = page.locator('#seat-map .seat.available').first();
    const seatLabel = await firstSeat.getAttribute('title');
    await firstSeat.click();
    await page.locator('#seat-map .seat.available').nth(3).click();
    check('已選 2 個座位', (await page.locator('#selected-seats-count').textContent()) === '2');
    const total = parseInt(await page.locator('#total-price').textContent());
    check('總金額 > 0', total > 0, `total=${total}`);

    await page.click('#confirm-booking');
    await page.waitForSelector('#checkoutSidebar.open');
    check('結帳票數 = 2', (await page.locator('#checkout-ticket-count').textContent()) === '2');
    check('結帳總計相符', (await page.locator('#checkout-total-amount').textContent()) === String(total));
    check('顯示付款後餘額',
        (await page.locator('#checkout-remaining-balance').textContent()).includes(String(2000 - total)));

    await page.click('#checkout-pay-btn');
    await page.waitForTimeout(1200);
    check('付款後側邊欄關閉', await page.locator('#checkoutSidebar.open').count() === 0);
    check('餘額已扣款',
        parseInt(await page.locator('.nav-link .user-balance').first().textContent()) === 2000 - total);
    check('剛買的位子變成已售出', await page.locator('#seat-map .seat.occupied').count() >= 2);

    console.log('\n# 我的票夾');
    await page.click('#wallet-toggle-btn');
    await page.waitForSelector('#walletSidebar.open');
    check('票夾有 2 張票', await page.locator('#unused-tickets-list .ticket-card').count() === 2);
    check('票券顯示座位標籤',
        (await page.locator('#unused-tickets-list').textContent()).includes(seatLabel), seatLabel);
    await page.click('.use-ticket-btn');
    await page.waitForTimeout(400);
    check('使用後出現倒數', await page.locator('.ticket-card.using').count() === 1);

    console.log('\n# 餘額持久化');
    await page.keyboard.press('Escape');
    await page.click('#navbarDropdown');
    await page.click('#logout-btn');
    await page.waitForTimeout(900);
    await login(page, 'demo', 'demo123');
    check('重新登入後餘額保留',
        parseInt(await page.locator('.nav-link .user-balance').first().textContent()) === 2000 - total);

    console.log('\n# 個人專區');
    await page.goto(`${BASE}/profile.html`);
    await page.waitForTimeout(600);
    check('消費紀錄有資料', await page.locator('#transaction-list tr').count() >= 1);
    check('個人專區餘額正確', parseInt(await page.locator('#current_amount').textContent()) === 2000 - total);

    console.log('\n# 註冊新帳號');
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(() => localStorage.removeItem('userInfo'));
    await page.reload();
    await page.click('#nav-register-btn');
    await page.waitForSelector('#authModal.show');
    await page.waitForTimeout(300);
    await page.fill('#register-username', 'tester');
    await page.fill('#register-email', 'tester@example.com');
    await page.fill('#register-password', 'pass1234');
    await page.fill('#register-confirm-password', 'pass1234');
    await page.click('#modal-register-form button[type=submit]');
    await page.waitForTimeout(600);
    await page.fill('#login-password', 'pass1234');
    await page.click('#modal-login-form button[type=submit]');
    await page.waitForTimeout(1200);
    check('新帳號可登入', (await page.locator('#navbarDropdown').textContent()).trim() === 'tester');
    await page.click('#wallet-toggle-btn');
    await page.waitForSelector('#walletSidebar.open');
    check('新帳號看不到別人的票', await page.locator('#unused-tickets-list .ticket-card').count() === 0);
}

/* ------------------------------------------------------------------
   情境二：帳號、儲值、驗證
   ------------------------------------------------------------------ */

async function testAccountFlow(browser, errors) {
    const page = await (await browser.newContext()).newPage();
    watchErrors(page, errors);

    console.log('\n# 登入驗證');
    await page.goto(`${BASE}/index.html`);
    await login(page, 'demo', 'wrongpass');
    check('錯誤密碼不會登入', await page.locator('#nav-login-btn').count() === 1);
    check('顯示錯誤提示', (await page.locator('.toast-body').first().textContent()).includes('錯誤'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    console.log('\n# 儲值');
    await login(page, 'janedoe', 'securepass');
    check('登入 janedoe，餘額 500',
        (await page.locator('.nav-link .user-balance').first().textContent()) === '500');
    await page.click('#nav-deposit-btn');
    await page.waitForSelector('#depositModal.show');
    await page.click('.quick-deposit[data-amount="500"]');
    check('快選金額填入', (await page.inputValue('#deposit-amount')) === '500');
    await page.click('#confirm-deposit-btn');
    await page.waitForTimeout(600);
    check('儲值後餘額 1000',
        (await page.locator('.nav-link .user-balance').first().textContent()) === '1000');

    console.log('\n# 餘額不足');
    await page.goto(`${BASE}/booking.html`);
    await page.evaluate(() => {
        const u = JSON.parse(localStorage.getItem('userInfo'));
        u.balance = 100;
        localStorage.setItem('userInfo', JSON.stringify(u));
        const users = JSON.parse(localStorage.getItem('users'));
        users.find(x => x.id === u.id).balance = 100;
        localStorage.setItem('users', JSON.stringify(users));
    });
    await page.reload();
    await page.waitForTimeout(700);
    await pickShowtime(page, '2');
    await page.locator('#seat-map .seat.available').first().click();
    await page.click('#confirm-booking');
    await page.waitForSelector('#checkoutSidebar.open');
    check('付款鍵被停用', await page.locator('#checkout-pay-btn').isDisabled());
    check('顯示餘額不足提示', await page.locator('#checkout-insufficient-alert').isVisible());

    console.log('\n# 側邊欄內儲值');
    await page.click('#checkout-deposit-btn');
    await page.waitForSelector('#depositModal.show');
    await page.fill('#deposit-amount', '2000');
    await page.click('#confirm-deposit-btn');
    await page.waitForTimeout(700);
    check('儲值後付款鍵解鎖', !(await page.locator('#checkout-pay-btn').isDisabled()));
    await page.click('#checkout-pay-btn');
    await page.waitForTimeout(1200);
    check('付款成功', await page.locator('#checkoutSidebar.open').count() === 0);
    check('剛買的位子已鎖定', await page.locator('#seat-map .seat.occupied').count() >= 1);

    console.log('\n# 修改用戶名');
    await page.goto(`${BASE}/profile.html`);
    await page.waitForTimeout(600);
    await page.fill('#usernameUpdate', 'jane_new');
    await page.click('#changeUsername');
    await page.waitForTimeout(500);
    check('導覽列顯示新名稱', (await page.locator('#navbarDropdown').textContent()).trim() === 'jane_new');
    await page.click('#navbarDropdown');
    await page.click('#logout-btn');
    await page.waitForTimeout(900);
    await login(page, 'jane_new', 'securepass');
    check('可用新名稱登入', (await page.locator('#navbarDropdown').textContent()).trim() === 'jane_new');

    console.log('\n# 重複註冊');
    await page.evaluate(() => localStorage.removeItem('userInfo'));
    await page.reload();
    await page.waitForTimeout(500);
    await page.click('#nav-register-btn');
    await page.waitForSelector('#authModal.show');
    await page.waitForTimeout(300);
    await page.fill('#register-username', 'demo');
    await page.fill('#register-email', 'x@y.com');
    await page.fill('#register-password', 'aaa11111');
    await page.fill('#register-confirm-password', 'aaa11111');
    await page.click('#modal-register-form button[type=submit]');
    await page.waitForTimeout(500);
    check('重複帳號被擋下', (await page.locator('.toast-body').last().textContent()).includes('已存在'));
}

/* ------------------------------------------------------------------ */

(async () => {
    const server = await startServer();
    const browser = await chromium.launch();
    const errors = [];

    try {
        await testBookingFlow(browser, errors);
        await testAccountFlow(browser, errors);
    } catch (error) {
        problems.push(`測試中斷: ${error.message}`);
        console.error('\n測試中斷:', error);
    } finally {
        await browser.close();
        server.close();
    }

    console.log(`\n===== ${passed} 項通過，${problems.length} 項失敗 =====`);
    if (problems.length) {
        console.log('失敗項目:\n' + problems.map(p => ' - ' + p).join('\n'));
    }
    if (errors.length) {
        console.log('\nConsole 錯誤:\n' + [...new Set(errors)].map(e => ' ! ' + e).join('\n'));
    } else {
        console.log('無 console 錯誤');
    }

    process.exit(problems.length || errors.length ? 1 : 0);
})();
