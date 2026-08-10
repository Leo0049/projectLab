'use strict';

/**
 * 端對端測試（瀏覽器）
 *
 * 會啟動真正的 Express 伺服器（搭配一個全新的暫存資料庫），
 * 再用無頭 Chromium 走完整流程：瀏覽 → 登入 → 選位 → 保留 → 付款 → 票夾 → 個人專區。
 *
 * 執行方式：npm run test:e2e
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-e2e-'));
process.env.DB_PATH = path.join(TMP_DIR, 'e2e.db');
process.env.JWT_SECRET = 'e2e-secret';

const { chromium } = require('playwright');
const { createApp, initDatabase } = require('../server/app');
const { closeDb } = require('../server/db');

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

// 測試會刻意觸發這些回應（密碼錯誤、重複註冊、座位衝突、未登入），
// 瀏覽器一律會記成 console error，但它們是預期中的行為而非 bug
const EXPECTED_HTTP_ERRORS = /status of (400|401|409)/;

function watchErrors(page, sink) {
    page.on('pageerror', e => sink.push(`PAGEERROR ${e.message}`));
    page.on('console', m => {
        if (m.type() !== 'error') return;
        const text = m.text();
        if (text.includes('favicon') || EXPECTED_HTTP_ERRORS.test(text)) return;
        sink.push(text);
    });
}

let BASE = '';

/* ------------------------------------------------------------------ *
 * 共用操作
 * ------------------------------------------------------------------ */

/**
 * 登入／登出成功後 auth.js 會延遲重新載入頁面。
 * 先在 window 上做記號，記號消失就代表 reload 真的完成了，
 * 否則後續操作會打在即將被銷毀的 DOM 上。
 */
async function actAndWaitReload(page, action) {
    await page.evaluate(() => { window.__pending = true; });
    await action();
    await page.waitForFunction(() => !window.__pending, null, { timeout: 10000 });
    await page.waitForLoadState('domcontentloaded');
}

async function login(page, username, password) {
    await page.click('#nav-login-btn');
    await page.waitForSelector('#authModal.show');
    await page.fill('#login-username', username);
    await page.fill('#login-password', password);

    await actAndWaitReload(page, () => page.click('#modal-login-form button[type=submit]'));
    await page.waitForSelector('#navbarDropdown', { timeout: 8000 });
}

async function logout(page) {
    await page.click('#navbarDropdown');
    await actAndWaitReload(page, () => page.click('#logout-btn'));
    await page.waitForSelector('#nav-login-btn', { timeout: 8000 });
}

async function register(page, username, email, password) {
    await page.click('#nav-register-btn');
    await page.waitForSelector('#authModal.show');
    await page.waitForTimeout(300);
    await page.fill('#register-username', username);
    await page.fill('#register-email', email);
    await page.fill('#register-password', password);
    await page.fill('#register-confirm-password', password);
    await page.click('#modal-register-form button[type=submit]');
    await page.waitForTimeout(600);
}

/**
 * 在訂票頁選好電影／日期／場次，等座位圖出現
 * @returns {Promise<string>} 選到的場次文字
 */
async function pickShowtime(page, movieId, dateIndex = 1) {
    await page.selectOption('#movie-select', movieId);
    await page.waitForFunction(() => !document.getElementById('date-select').disabled);
    await page.selectOption('#date-select', { index: dateIndex });
    await page.waitForFunction(() => !document.getElementById('showtime-select').disabled);
    await page.selectOption('#showtime-select', { index: 1 });
    await page.waitForSelector('.seat.available', { timeout: 8000 });
    return page.locator('#showtime-select').inputValue();
}

async function balanceOf(page) {
    return parseInt(await page.locator('.nav-link .user-balance').first().textContent());
}

/**
 * 走完整條金流：開儲值視窗 → 前往沙盒付款頁 → 付款 → 導回本站
 * @param {boolean} succeed - false 代表模擬付款失敗
 */
async function depositViaGateway(page, amount, succeed = true) {
    await page.click('#nav-deposit-btn');
    await page.waitForSelector('#depositModal.show');
    await page.fill('#deposit-amount', String(amount));
    await page.click('#confirm-deposit-btn');

    // 已經離開本站，來到金流商的付款頁
    await page.waitForSelector('#sandbox-pay-success', { timeout: 10000 });

    await page.click(succeed ? '#sandbox-pay-success' : '#sandbox-pay-fail');
    await page.waitForURL(/profile\.html/, { timeout: 10000 });
    await page.waitForSelector('#navbarDropdown', { timeout: 8000 });
    await page.waitForTimeout(800);
}

/* ------------------------------------------------------------------ *
 * 主要流程
 * ------------------------------------------------------------------ */

async function testMainFlow(browser, errors) {
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
    check('時段按鈕以時間為主', await page.locator('.showtime-slot .slot-time').count() > 0);

    await page.goto(`${BASE}/schedule.html`);
    await page.waitForSelector('.schedule-card');
    check('時刻表有電影', await page.locator('.schedule-card').count() > 0);
    check('日期按鈕 = 7', await page.locator('.date-btn').count() === 7);

    await page.goto(`${BASE}/movie-detail.html?id=1`);
    await page.waitForSelector('.showtime-slot');
    check('詳情頁有場次', await page.locator('.showtime-slot').count() > 0);
    const href = await page.locator('.showtime-slot').first().getAttribute('href');
    check('場次連結指向訂票頁', href.startsWith('booking.html?showtime='), href);

    console.log('\n# 登入');
    await page.goto(`${BASE}/booking.html`);
    await login(page, 'demo', 'demo123');
    check('導覽列顯示帳號', (await page.locator('#navbarDropdown').textContent()).trim() === 'demo');
    check('餘額來自伺服器（2000）', await balanceOf(page) === 2000);

    console.log('\n# 選位與座位保留');
    await pickShowtime(page, '1');
    check('座位圖已產生', await page.locator('#seat-map .seat').count() > 0);

    const firstSeat = page.locator('#seat-map .seat.available').first();
    const seatLabel = (await firstSeat.getAttribute('title')).replace(/（.*/, '');
    await firstSeat.click();
    await page.locator('#seat-map .seat.available').nth(3).click();
    check('已選 2 個座位', (await page.locator('#selected-seats-count').textContent()) === '2');
    const total = parseInt(await page.locator('#total-price').textContent());
    check('總金額 > 0', total > 0, `total=${total}`);

    await page.click('#confirm-booking');
    await page.waitForSelector('#checkoutSidebar.open', { timeout: 8000 });
    check('結帳側邊欄開啟', true);
    check('顯示座位保留倒數',
        /^\d{2}:\d{2}$/.test((await page.locator('#checkout-lock-remaining').textContent()).trim()),
        await page.locator('#checkout-lock-remaining').textContent());
    check('結帳票數 = 2', (await page.locator('#checkout-ticket-count').textContent()) === '2');
    check('結帳總計相符', (await page.locator('#checkout-total-amount').textContent()) === String(total));

    console.log('\n# 付款');
    await page.click('#checkout-pay-btn');
    await page.waitForTimeout(1500);
    check('付款後側邊欄關閉', await page.locator('#checkoutSidebar.open').count() === 0);
    check('餘額已由伺服器扣款', await balanceOf(page) === 2000 - total, `balance=${await balanceOf(page)}`);
    check('剛買的位子變成已售出', await page.locator('#seat-map .seat.occupied').count() >= 2);

    console.log('\n# 我的票夾');
    await page.click('#wallet-toggle-btn');
    await page.waitForSelector('#walletSidebar.open');
    await page.waitForSelector('#unused-tickets-list .ticket-card', { timeout: 5000 });
    check('票夾有 2 張票', await page.locator('#unused-tickets-list .ticket-card').count() === 2);
    check('票券顯示座位標籤',
        (await page.locator('#unused-tickets-list').textContent()).includes(seatLabel), seatLabel);
    await page.click('.use-ticket-btn');
    await page.waitForSelector('.ticket-card.using', { timeout: 5000 });
    check('使用後出現倒數', await page.locator('.ticket-card.using').count() === 1);

    console.log('\n# 重新登入');
    await page.keyboard.press('Escape');
    await logout(page);
    check('登出後回到未登入狀態', await page.locator('#nav-login-btn').count() === 1);
    await login(page, 'demo', 'demo123');
    check('重新登入後餘額保留', await balanceOf(page) === 2000 - total);

    console.log('\n# 個人專區');
    await page.goto(`${BASE}/profile.html`);
    await page.waitForSelector('#transaction-list tr', { timeout: 8000 });
    check('消費紀錄有資料', await page.locator('#transaction-list tr').count() >= 1);
    check('個人專區餘額正確', parseInt(await page.locator('#current_amount').textContent()) === 2000 - total);
    check('票券統計：可使用 2 張', (await page.locator('#stat-unused').textContent()) === '2');
    check('票券統計：累計消費正確', (await page.locator('#stat-spent').textContent()) === String(total));

    return { total };
}

/* ------------------------------------------------------------------ *
 * 跨使用者：座位保留在別人畫面上要看得到
 * ------------------------------------------------------------------ */

async function testSeatLockAcrossUsers(browser, errors) {
    console.log('\n# 跨使用者：A 保留座位，B 應該選不到');

    const pageA = await (await browser.newContext()).newPage();
    const pageB = await (await browser.newContext()).newPage();
    watchErrors(pageA, errors);
    watchErrors(pageB, errors);

    await pageA.goto(`${BASE}/booking.html`);
    await login(pageA, 'johndoe', 'password123');
    await pickShowtime(pageA, '2');

    // A 選兩個位子並進入結帳（此時伺服器已保留座位）
    const seatA = pageA.locator('#seat-map .seat.available').first();
    const seatKey = await seatA.evaluate(el => `${el.dataset.row}-${el.dataset.col}`);
    await seatA.click();
    await pageA.click('#confirm-booking');
    await pageA.waitForSelector('#checkoutSidebar.open', { timeout: 8000 });
    check('A 成功保留座位', true);

    // B 打開同一個場次
    await pageB.goto(`${BASE}/booking.html`);
    await login(pageB, 'janedoe', 'securepass');
    await pickShowtime(pageB, '2');

    const stateForB = await pageB.locator(
        `#seat-map .seat[data-row="${seatKey.split('-')[0]}"][data-col="${seatKey.split('-')[1]}"]`
    ).getAttribute('class');
    check('B 看到該座位已被鎖定', stateForB.includes('occupied'), stateForB);

    const titleForB = await pageB.locator(
        `#seat-map .seat[data-row="${seatKey.split('-')[0]}"][data-col="${seatKey.split('-')[1]}"]`
    ).getAttribute('title');
    check('B 看到「他人選位中」提示', titleForB.includes('他人選位中'), titleForB);

    // A 關閉結帳 → 座位應該釋放
    await pageA.click('#checkout-close-btn');
    await pageA.waitForTimeout(800);

    await pageB.reload();
    await pickShowtime(pageB, '2');
    const stateAfterRelease = await pageB.locator(
        `#seat-map .seat[data-row="${seatKey.split('-')[0]}"][data-col="${seatKey.split('-')[1]}"]`
    ).getAttribute('class');
    check('A 放棄結帳後座位釋放給 B', stateAfterRelease.includes('available'), stateAfterRelease);
}

/* ------------------------------------------------------------------ *
 * 帳號、儲值、餘額不足
 * ------------------------------------------------------------------ */

async function testAccountFlow(browser, errors) {
    const page = await (await browser.newContext()).newPage();
    watchErrors(page, errors);

    console.log('\n# 登入驗證');
    await page.goto(`${BASE}/index.html`);
    await page.click('#nav-login-btn');
    await page.waitForSelector('#authModal.show');
    await page.fill('#login-username', 'demo');
    await page.fill('#login-password', 'wrongpass');
    await page.click('#modal-login-form button[type=submit]');
    await page.waitForSelector('.toast-body', { timeout: 5000 });
    check('錯誤密碼不會登入', await page.locator('#nav-login-btn').count() === 1);
    check('顯示錯誤提示', (await page.locator('.toast-body').first().textContent()).includes('錯誤'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    console.log('\n# 註冊新帳號');
    await register(page, 'tester', 'tester@example.com', 'pass1234');
    await page.fill('#login-password', 'pass1234');
    await actAndWaitReload(page, () => page.click('#modal-login-form button[type=submit]'));
    await page.waitForSelector('#navbarDropdown', { timeout: 8000 });
    check('新帳號可登入', (await page.locator('#navbarDropdown').textContent()).trim() === 'tester');
    check('新帳號餘額 0', await balanceOf(page) === 0);

    await page.click('#wallet-toggle-btn');
    await page.waitForSelector('#walletSidebar.open');
    await page.waitForTimeout(500);
    check('新帳號看不到別人的票', await page.locator('#unused-tickets-list .ticket-card').count() === 0);
    await page.keyboard.press('Escape');

    console.log('\n# 餘額不足');
    await page.goto(`${BASE}/booking.html`);
    await page.waitForSelector('#navbarDropdown', { timeout: 8000 });
    await pickShowtime(page, '3');
    await page.locator('#seat-map .seat.available').first().click();
    await page.click('#confirm-booking');
    await page.waitForSelector('#checkoutSidebar.open', { timeout: 8000 });
    check('付款鍵被停用', await page.locator('#checkout-pay-btn').isDisabled());
    check('顯示餘額不足提示', await page.locator('#checkout-insufficient-alert').isVisible());
    await page.click('#checkout-close-btn');
    await page.waitForTimeout(600);

    console.log('\n# 金流：付款失敗');
    await page.goto(`${BASE}/profile.html`);
    await page.waitForSelector('#navbarDropdown', { timeout: 8000 });
    await depositViaGateway(page, 500, false);
    check('付款失敗不會入帳', await balanceOf(page) === 0, `balance=${await balanceOf(page)}`);
    check('顯示付款失敗提示',
        (await page.locator('.toast-body').last().textContent()).includes('失敗'));

    console.log('\n# 金流：付款成功');
    await depositViaGateway(page, 2000, true);
    check('付款成功後餘額入帳 2000', await balanceOf(page) === 2000,
        `balance=${await balanceOf(page)}`);
    check('顯示儲值成功提示',
        (await page.locator('.toast-body').last().textContent()).includes('儲值成功'));

    const profileBalance = parseInt(await page.locator('#current_amount').textContent());
    check('個人專區餘額同步更新', profileBalance === 2000, `balance=${profileBalance}`);

    console.log('\n# 儲值後完成購票');
    await page.goto(`${BASE}/booking.html`);
    await page.waitForSelector('#navbarDropdown', { timeout: 8000 });
    await pickShowtime(page, '3');
    await page.locator('#seat-map .seat.available').first().click();
    await page.click('#confirm-booking');
    await page.waitForSelector('#checkoutSidebar.open', { timeout: 8000 });
    check('儲值後付款鍵解鎖', !(await page.locator('#checkout-pay-btn').isDisabled()));
    await page.click('#checkout-pay-btn');
    await page.waitForTimeout(1500);
    check('付款成功', await page.locator('#checkoutSidebar.open').count() === 0);
    check('剛買的位子已鎖定', await page.locator('#seat-map .seat.occupied').count() >= 1);
    check('餘額已扣款', await balanceOf(page) < 2000);

    console.log('\n# 退票');
    await page.click('#wallet-toggle-btn');
    await page.waitForSelector('#walletSidebar.open');
    await page.waitForSelector('.refund-ticket-btn', { timeout: 5000 });
    const balanceBeforeRefund = await balanceOf(page);
    const refundAmount = parseInt(
        await page.locator('.refund-ticket-btn').first().getAttribute('data-refund-amount')
    );
    page.once('dialog', dialog => dialog.accept());
    await page.click('.refund-ticket-btn');
    await page.waitForTimeout(1200);
    check('退票後餘額增加', await balanceOf(page) === balanceBeforeRefund + refundAmount,
        `${balanceBeforeRefund} → ${await balanceOf(page)}`);
    await page.click('#wallet-history-tab');
    await page.waitForTimeout(500);
    check('退票票券進入歷史',
        (await page.locator('#history-tickets-list').textContent()).includes('已退票'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check('退票後座位重新開放',
        await page.locator('#seat-map .seat.available').count() > 0);

    console.log('\n# 修改用戶名');
    await page.goto(`${BASE}/profile.html`);
    await page.waitForSelector('#usernameUpdate', { timeout: 8000 });
    await page.waitForTimeout(400);
    await page.fill('#usernameUpdate', 'tester_new');
    await page.click('#changeUsername');
    await page.waitForTimeout(700);
    check('導覽列顯示新名稱', (await page.locator('#navbarDropdown').textContent()).trim() === 'tester_new');

    await logout(page);
    await login(page, 'tester_new', 'pass1234');
    check('可用新名稱登入', (await page.locator('#navbarDropdown').textContent()).trim() === 'tester_new');

    console.log('\n# 重複註冊');
    await logout(page);
    await register(page, 'demo', 'x@y.com', 'aaa11111');
    check('重複帳號被擋下',
        (await page.locator('.toast-body').last().textContent()).includes('已存在'));

    console.log('\n# 未登入時的保護');
    await page.goto(`${BASE}/profile.html`);
    await page.waitForURL(/index\.html/, { timeout: 8000 }).catch(() => {});
    check('未登入無法進入個人專區', page.url().includes('index.html'), page.url());
}


/* ------------------------------------------------------------------ *
 * 無限滾動與側邊欄
 * ------------------------------------------------------------------ */

async function testInfiniteScrollAndSidebar(browser, errors) {
    const page = await (await browser.newContext()).newPage();
    watchErrors(page, errors);

    console.log('\n# 側邊欄');
    await page.goto(`${BASE}/showtime.html`);
    await page.waitForSelector('.sidebar-link');
    check('側邊欄由共用模組產生', await page.locator('#sidebar .sidebar-link').count() >= 4);
    check('目前頁面有 active 標記',
        await page.locator('.sidebar-link.active[href="showtime.html"]').count() === 1);
    check('未登入不顯示會員區塊',
        await page.locator('.sidebar-link[href="profile.html"]').count() === 0);
    check('未登入顯示登入引導', await page.locator('#sidebar-login-btn').count() === 1);

    console.log('\n# 無限滾動：場次查詢');
    await page.waitForSelector('.showtime-group');
    // 清掉日期條件才有足夠資料可以捲
    await page.fill('#search-date', '');
    await page.click('#search-btn');
    await page.waitForSelector('.showtime-group', { timeout: 8000 });
    await page.waitForTimeout(600);

    const firstBatch = await page.locator('.showtime-slot').count();
    check('第一頁載入部分場次', firstBatch > 0 && firstBatch <= 12, `count=${firstBatch}`);

    const statsText = await page.locator('#showtime-stats').textContent();
    check('顯示總數與已載入數', /共\s*\d+\s*個場次/.test(statsText), statsText.trim());

    // 捲到底觸發載入
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(
        previous => document.querySelectorAll('.showtime-slot').length > previous,
        firstBatch, { timeout: 8000 }
    );
    const secondBatch = await page.locator('.showtime-slot').count();
    check('捲到底自動載入更多', secondBatch > firstBatch, `${firstBatch} → ${secondBatch}`);

    // 一路捲到結束
    for (let i = 0; i < 12; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(350);
        if (await page.locator('.infinite-end').count() > 0) break;
    }
    check('載完後顯示結尾提示', await page.locator('.infinite-end').count() === 1);

    console.log('\n# 登入後的側邊欄');
    await login(page, 'demo', 'demo123');
    check('登入後出現會員區塊',
        await page.locator('.sidebar-link[href="profile.html"]').count() === 1);
    check('側邊欄顯示使用者與餘額', await page.locator('.sidebar-user .sidebar-balance').count() === 1);
    check('一般會員看不到管理後台',
        await page.locator('.sidebar-link[href="admin.html"]').count() === 0);
}

/* ------------------------------------------------------------------ *
 * 管理後台
 * ------------------------------------------------------------------ */

async function testAdminConsole(browser, errors) {
    const page = await (await browser.newContext()).newPage();
    watchErrors(page, errors);

    console.log('\n# 管理後台：權限');
    await page.goto(`${BASE}/admin.html`);
    await page.waitForSelector('#admin-denied', { state: 'visible', timeout: 8000 });
    check('未登入看到權限不足', await page.locator('#admin-denied').isVisible());

    await login(page, 'demo', 'demo123');
    await page.goto(`${BASE}/admin.html`);
    await page.waitForTimeout(1200);
    check('一般會員看到權限不足', await page.locator('#admin-denied').isVisible());

    console.log('\n# 管理後台：管理員');
    await logout(page);
    await login(page, 'admin', 'admin123');
    check('管理員側邊欄出現管理區塊',
        await page.locator('.sidebar-link[href="admin.html"]').count() === 1);

    await page.goto(`${BASE}/admin.html`);
    await page.waitForSelector('#admin-content', { state: 'visible', timeout: 8000 });
    await page.waitForSelector('#admin-stats .stat-card', { timeout: 8000 });
    check('顯示營運概況四張卡', await page.locator('#admin-stats .stat-card').count() === 4);
    check('顯示熱門電影排行', await page.locator('.top-movie-row').count() > 0);

    await page.waitForSelector('#admin-showtime-list tr', { timeout: 8000 });
    const showtimeRows = await page.locator('#admin-showtime-list tr').count();
    check('場次列表已載入', showtimeRows > 0, `rows=${showtimeRows}`);
    check('場次列表有上座率長條', await page.locator('.occupancy-bar').count() > 0);

    console.log('\n# 管理後台：排片');
    const future = new Date();
    future.setDate(future.getDate() + 4);
    const futureStr = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;

    await page.fill('#new-date', futureStr);
    await page.fill('#new-time', '07:30');
    await page.fill('#new-price', '260');
    await page.click('#create-showtime-form button[type=submit]');
    await page.waitForTimeout(1200);
    check('排片成功提示',
        (await page.locator('.toast-body').last().textContent()).includes('排片成功'));

    // 同廳同時段再排一次應被擋下
    await page.fill('#new-date', futureStr);
    await page.fill('#new-time', '07:30');
    await page.click('#create-showtime-form button[type=submit]');
    await page.waitForTimeout(1000);
    check('撞廳排片被擋下',
        (await page.locator('.toast-body').last().textContent()).includes('已經有排片'));

    console.log('\n# 管理後台：訂單與代客退票');
    await page.click('[data-bs-target="#panel-bookings"]');
    await page.waitForSelector('.admin-booking', { timeout: 8000 });
    check('訂單列表已載入', await page.locator('.admin-booking').count() > 0);
    check('訂單顯示座位明細', await page.locator('.admin-seat').count() > 0);

    const refundBtnCount = await page.locator('.admin-refund-btn').count();
    if (refundBtnCount > 0) {
        page.once('dialog', dialog => dialog.accept());
        await page.click('.admin-refund-btn');
        await page.waitForTimeout(1500);
        check('代客退票成功',
            (await page.locator('.toast-body').last().textContent()).includes('已退票'));
    } else {
        check('代客退票成功', false, '找不到可退的座位');
    }

    console.log('\n# 管理後台：會員');
    await page.click('[data-bs-target="#panel-users"]');
    await page.waitForSelector('#admin-user-list tr', { timeout: 8000 });
    check('會員列表已載入', await page.locator('#admin-user-list tr').count() >= 4);
}

/* ------------------------------------------------------------------ */

async function main() {
    initDatabase({ quiet: true });
    const app = createApp();

    const server = await new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    BASE = `http://127.0.0.1:${server.address().port}`;

    // 預設用 Playwright 自己下載的瀏覽器；
    // 需要指定既有的 Chromium 時可設環境變數 CHROMIUM_PATH
    const browser = await chromium.launch(
        process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
    );
    const errors = [];

    try {
        await testMainFlow(browser, errors);
        await testSeatLockAcrossUsers(browser, errors);
        await testInfiniteScrollAndSidebar(browser, errors);
        await testAccountFlow(browser, errors);
        await testAdminConsole(browser, errors);
    } catch (error) {
        problems.push(`測試中斷: ${error.message}`);
        console.error('\n測試中斷:', error);
    } finally {
        await browser.close();
        server.close();
        closeDb();
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
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
}

main().catch(error => {
    console.error('測試中斷:', error);
    process.exit(1);
});
