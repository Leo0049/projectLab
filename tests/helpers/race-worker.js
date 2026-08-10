'use strict';

/**
 * 並發測試用的工作行程。
 *
 * 由 tests/api.js 同時啟動多個，全部在同一個時間點嘗試訂走同一個座位，
 * 用來驗證「超賣防護」不是靠 Node 單執行緒僥倖成立，而是資料庫層真的擋得住。
 *
 * 用法： node race-worker.js <dbPath> <showtimeId> <userId> <row> <col> <startAtEpochMs>
 */

const [dbPath, showtimeId, userId, row, col, startAt] = process.argv.slice(2);

process.env.DB_PATH = dbPath;

const bookingService = require('../../server/services/bookings');

function run() {
    try {
        const result = bookingService.createBooking(Number(showtimeId), Number(userId), [
            { row: Number(row), col: Number(col) }
        ]);
        process.stdout.write(JSON.stringify({ ok: true, bookingId: result.booking.id }));
    } catch (error) {
        process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
    }
}

// 忙等到約定的起跑時間，讓所有行程盡可能同時撞上資料庫
const target = Number(startAt);
const wait = target - Date.now();
if (wait > 0) {
    setTimeout(run, wait);
} else {
    run();
}
