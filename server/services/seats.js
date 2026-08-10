'use strict';

const { getDb, writeTransaction } = require('../db');
const config = require('../config');
const { badRequest, notFound, conflict } = require('../utils/http');

/* ------------------------------------------------------------------ *
 * 座位鎖定
 *
 * 售票系統的核心難題是「兩個人同時搶最後一個位子」。這裡分三層處理：
 *
 *   1. 選位階段 → seat_locks 暫時保留座位（預設 5 分鐘），讓使用者安心結帳
 *   2. 付款階段 → BEGIN IMMEDIATE 交易，一次做完「檢查 → 扣款 → 開票」
 *   3. 資料庫層 → booking_seats 上的部分唯一索引 idx_booking_seats_unique
 *                （showtime_id, seat_row, seat_col）WHERE status != 'refunded'
 *
 * 第 3 層是最後防線：就算前兩層都被繞過，資料庫也不可能讓同一個位子存在兩筆未退票紀錄。
 * 用「部分」索引是為了讓退票後的舊紀錄留著對帳，同時把位子釋放出來重新賣。
 * ------------------------------------------------------------------ */

/**
 * 清掉過期的鎖。所有會用到鎖的查詢都先呼叫這個，
 * 因此不需要背景排程，也不會有「鎖住但沒人付款」的座位卡死。
 */
function purgeExpiredLocks() {
    getDb().prepare('DELETE FROM seat_locks WHERE expires_at <= ?').run(Date.now());
}

function getShowtimeOrFail(showtimeId) {
    const showtime = getDb().prepare(`
        SELECT s.id, s.movie_id AS movieId, s.theater_id AS theaterId,
               s.date, s.time, s.price,
               m.title AS movieTitle, m.poster_image AS moviePoster, m.rating AS movieRating,
               t.name AS theaterName, t.total_rows AS theaterRows, t.total_cols AS theaterCols
        FROM showtimes s
        JOIN movies m   ON m.id = s.movie_id
        JOIN theaters t ON t.id = s.theater_id
        WHERE s.id = ?
    `).get(showtimeId);

    if (!showtime) throw notFound('找不到這個場次');
    return showtime;
}

/**
 * 取得一個場次的座位狀態
 * @param {number} showtimeId
 * @param {number|null} userId - 用來區分「自己鎖的」與「別人鎖的」
 */
function getSeatMap(showtimeId, userId = null) {
    purgeExpiredLocks();

    const showtime = getShowtimeOrFail(showtimeId);
    const db = getDb();

    // 已退票的座位不算已售出，位子要能重新賣
    const occupied = db.prepare(`
        SELECT seat_row AS row, seat_col AS col
        FROM booking_seats
        WHERE showtime_id = ? AND status != 'refunded'
    `).all(showtimeId);

    const locks = db.prepare(
        'SELECT seat_row AS row, seat_col AS col, user_id AS userId FROM seat_locks WHERE showtime_id = ?'
    ).all(showtimeId);

    return {
        showtime: {
            id: showtime.id,
            movieId: showtime.movieId,
            movieTitle: showtime.movieTitle,
            moviePoster: showtime.moviePoster,
            date: showtime.date,
            time: showtime.time,
            price: showtime.price,
            theaterName: showtime.theaterName,
            theaterRows: showtime.theaterRows,
            theaterCols: showtime.theaterCols
        },
        occupied,
        // 別人正在結帳中的位子，對這個使用者來說一樣不能選
        locked: locks.filter(l => l.userId !== userId).map(({ row, col }) => ({ row, col })),
        heldByMe: locks.filter(l => l.userId === userId).map(({ row, col }) => ({ row, col }))
    };
}

function validateSeatsWithinTheater(showtime, seats) {
    const invalid = seats.find(
        seat => seat.row > showtime.theaterRows || seat.col > showtime.theaterCols
    );
    if (invalid) {
        throw badRequest(`座位 ${formatSeat(invalid)} 不在 ${showtime.theaterName} 的範圍內`);
    }
}

function formatSeat(seat) {
    return `${String.fromCharCode(64 + Number(seat.row))}${seat.col}`;
}

/**
 * 鎖定座位（選位 → 結帳之間的保留）
 *
 * 整段包在 IMMEDIATE 交易裡：檢查與寫入之間不會有別人插隊。
 * @returns {{expiresAt:number, seats:Array}}
 */
const lockSeats = writeTransaction((showtimeId, userId, seats) => {
    const db = getDb();

    db.prepare('DELETE FROM seat_locks WHERE expires_at <= ?').run(Date.now());

    const showtime = getShowtimeOrFail(showtimeId);

    if (seats.length > config.MAX_SEATS_PER_ORDER) {
        throw badRequest(`單筆訂單最多只能訂 ${config.MAX_SEATS_PER_ORDER} 個座位`);
    }
    validateSeatsWithinTheater(showtime, seats);

    const soldStmt = db.prepare(`
        SELECT 1 FROM booking_seats
        WHERE showtime_id = ? AND seat_row = ? AND seat_col = ? AND status != 'refunded'
    `);
    const lockStmt = db.prepare(
        'SELECT user_id AS userId FROM seat_locks WHERE showtime_id = ? AND seat_row = ? AND seat_col = ?'
    );

    const conflicts = [];
    for (const seat of seats) {
        if (soldStmt.get(showtimeId, seat.row, seat.col)) {
            conflicts.push({ ...seat, reason: 'sold' });
            continue;
        }
        const existing = lockStmt.get(showtimeId, seat.row, seat.col);
        if (existing && existing.userId !== userId) {
            conflicts.push({ ...seat, reason: 'locked' });
        }
    }

    if (conflicts.length > 0) {
        const labels = conflicts.map(formatSeat).join('、');
        throw conflict(`座位 ${labels} 已被其他人選走，請重新選位`, { conflicts });
    }

    // 換位子時先清掉自己在這個場次的舊鎖，避免佔著不放
    db.prepare('DELETE FROM seat_locks WHERE showtime_id = ? AND user_id = ?').run(showtimeId, userId);

    const expiresAt = Date.now() + config.SEAT_LOCK_TTL_MS;
    const insert = db.prepare(`
        INSERT INTO seat_locks (showtime_id, seat_row, seat_col, user_id, expires_at)
        VALUES (?, ?, ?, ?, ?)
    `);
    seats.forEach(seat => insert.run(showtimeId, seat.row, seat.col, userId, expiresAt));

    return { expiresAt, seats };
});

/**
 * 釋放自己在某場次的所有鎖（關閉結帳、重新選位時呼叫）
 */
const releaseSeats = writeTransaction((showtimeId, userId) => {
    const result = getDb()
        .prepare('DELETE FROM seat_locks WHERE showtime_id = ? AND user_id = ?')
        .run(showtimeId, userId);
    return { released: result.changes };
});

module.exports = {
    purgeExpiredLocks,
    getShowtimeOrFail,
    getSeatMap,
    lockSeats,
    releaseSeats,
    validateSeatsWithinTheater,
    formatSeat
};
