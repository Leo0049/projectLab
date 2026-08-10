'use strict';

const { getDb, writeTransaction } = require('../db');
const config = require('../config');
const { badRequest, notFound, conflict } = require('../utils/http');
const { toLocalDateStr, toLocalTimeStr } = require('../utils/dates');
const seatService = require('./seats');

/**
 * 建立訂票（付款）
 *
 * 整段在單一 BEGIN IMMEDIATE 交易內完成：
 *   檢查座位 → 檢查餘額 → 扣款 → 寫入訂單與座位 → 記錄交易 → 釋放鎖
 * 任何一步失敗都會整筆回滾，不可能出現「扣了錢沒有票」或「有票沒扣錢」。
 *
 * @returns {{booking:Object, balance:number}}
 */
const createBooking = writeTransaction((showtimeId, userId, seats) => {
    const db = getDb();

    db.prepare('DELETE FROM seat_locks WHERE expires_at <= ?').run(Date.now());

    const showtime = seatService.getShowtimeOrFail(showtimeId);

    if (seats.length > config.MAX_SEATS_PER_ORDER) {
        throw badRequest(`單筆訂單最多只能訂 ${config.MAX_SEATS_PER_ORDER} 個座位`);
    }
    seatService.validateSeatsWithinTheater(showtime, seats);

    // 場次開演後就不能再訂
    const now = new Date();
    const today = toLocalDateStr(now);
    const startedAlready =
        showtime.date < today || (showtime.date === today && showtime.time <= toLocalTimeStr(now));
    if (startedAlready) {
        throw badRequest('這個場次已經開演，無法訂票');
    }

    const soldStmt = db.prepare(
        'SELECT 1 FROM booking_seats WHERE showtime_id = ? AND seat_row = ? AND seat_col = ?'
    );
    const lockStmt = db.prepare(
        'SELECT user_id AS userId FROM seat_locks WHERE showtime_id = ? AND seat_row = ? AND seat_col = ?'
    );

    const conflicts = [];
    for (const seat of seats) {
        if (soldStmt.get(showtimeId, seat.row, seat.col)) {
            conflicts.push({ ...seat, reason: 'sold' });
            continue;
        }
        const lock = lockStmt.get(showtimeId, seat.row, seat.col);
        if (lock && lock.userId !== userId) {
            conflicts.push({ ...seat, reason: 'locked' });
        }
    }

    if (conflicts.length > 0) {
        const labels = conflicts.map(seatService.formatSeat).join('、');
        throw conflict(`座位 ${labels} 已被其他人訂走，請重新選位`, { conflicts });
    }

    const totalAmount = showtime.price * seats.length;

    const user = db.prepare('SELECT id, balance FROM users WHERE id = ?').get(userId);
    if (!user) throw notFound('帳號不存在');

    // 餘額一律以資料庫為準，前端傳什麼金額都不採信
    if (user.balance < totalAmount) {
        throw badRequest(`餘額不足，尚需 NT$ ${totalAmount - user.balance}`, {
            balance: user.balance,
            required: totalAmount
        });
    }

    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(totalAmount, userId);

    const bookingId = db.prepare(`
        INSERT INTO bookings (user_id, showtime_id, total_amount, status)
        VALUES (?, ?, ?, 'Paid')
    `).run(userId, showtimeId, totalAmount).lastInsertRowid;

    const insertSeat = db.prepare(`
        INSERT INTO booking_seats (booking_id, showtime_id, seat_row, seat_col, status)
        VALUES (?, ?, ?, ?, 'unused')
    `);

    try {
        seats.forEach(seat => insertSeat.run(bookingId, showtimeId, seat.row, seat.col));
    } catch (error) {
        // UNIQUE 約束擋下來 = 有人在同一瞬間搶先寫入，整筆回滾
        if (String(error.message).includes('UNIQUE')) {
            throw conflict('座位剛被其他人訂走，請重新選位');
        }
        throw error;
    }

    db.prepare(`
        INSERT INTO transactions (user_id, type, amount, movie_title, movie_date, showtime, booking_id)
        VALUES (?, '購票', ?, ?, ?, ?, ?)
    `).run(userId, -totalAmount, showtime.movieTitle, showtime.date, showtime.time, bookingId);

    db.prepare('DELETE FROM seat_locks WHERE showtime_id = ? AND user_id = ?').run(showtimeId, userId);

    const balance = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId).balance;

    return {
        booking: {
            id: bookingId,
            showtimeId,
            movieId: showtime.movieId,
            movieTitle: showtime.movieTitle,
            moviePoster: showtime.moviePoster,
            date: showtime.date,
            time: showtime.time,
            theaterName: showtime.theaterName,
            pricePerSeat: showtime.price,
            totalAmount,
            seats,
            status: 'Paid'
        },
        balance
    };
});

/**
 * 把「使用中」超過時效的座位歸檔成「已使用」。
 * 每次查詢票券前呼叫，取代前端的計時器。
 */
function archiveExpiredTickets(userId) {
    getDb().prepare(`
        UPDATE booking_seats
        SET status = 'used'
        WHERE status = 'using'
          AND used_at IS NOT NULL
          AND used_at <= ?
          AND booking_id IN (SELECT id FROM bookings WHERE user_id = ?)
    `).run(Date.now() - config.TICKET_EXPIRY_MS, userId);
}

/**
 * 取得使用者的票券，每個座位是一張獨立票券
 * @param {number} userId
 * @returns {{active:Array, history:Array}}
 */
function listTickets(userId) {
    archiveExpiredTickets(userId);

    const rows = getDb().prepare(`
        SELECT bs.id, bs.booking_id AS bookingId, bs.seat_row AS row, bs.seat_col AS col,
               bs.status, bs.used_at AS usedAt,
               b.showtime_id AS showtimeId, b.created_at AS createdAt,
               s.date, s.time, s.price,
               m.id AS movieId, m.title AS movieTitle, m.poster_image AS moviePoster,
               t.name AS theaterName
        FROM booking_seats bs
        JOIN bookings b  ON b.id = bs.booking_id
        JOIN showtimes s ON s.id = b.showtime_id
        JOIN movies m    ON m.id = s.movie_id
        JOIN theaters t  ON t.id = s.theater_id
        WHERE b.user_id = ?
        ORDER BY s.date, s.time, bs.seat_row, bs.seat_col
    `).all(userId);

    const toTicket = row => ({
        id: row.id,
        bookingId: row.bookingId,
        showtimeId: row.showtimeId,
        movieId: row.movieId,
        movieTitle: row.movieTitle,
        moviePoster: row.moviePoster,
        date: row.date,
        time: row.time,
        theaterName: row.theaterName,
        seat: { row: row.row, col: row.col },
        seatLabel: seatService.formatSeat({ row: row.row, col: row.col }),
        status: row.status,
        usedAt: row.usedAt
    });

    return {
        active: rows.filter(r => r.status !== 'used').map(toTicket),
        history: rows.filter(r => r.status === 'used').map(toTicket)
    };
}

/**
 * 開始使用一張票券（進場）
 */
const useTicket = writeTransaction((ticketId, userId) => {
    const db = getDb();

    const ticket = db.prepare(`
        SELECT bs.id, bs.status
        FROM booking_seats bs
        JOIN bookings b ON b.id = bs.booking_id
        WHERE bs.id = ? AND b.user_id = ?
    `).get(ticketId, userId);

    if (!ticket) throw notFound('找不到這張票券');
    if (ticket.status === 'used') throw badRequest('這張票券已經使用過了');
    if (ticket.status === 'using') return { alreadyUsing: true };

    db.prepare('UPDATE booking_seats SET status = \'using\', used_at = ? WHERE id = ?')
        .run(Date.now(), ticketId);

    return { alreadyUsing: false };
});

/**
 * 票券統計（個人專區用）
 */
function getTicketStats(userId) {
    archiveExpiredTickets(userId);
    const db = getDb();

    const counts = db.prepare(`
        SELECT
            SUM(CASE WHEN bs.status IN ('unused', 'using') THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN bs.status = 'used' THEN 1 ELSE 0 END) AS used
        FROM booking_seats bs
        JOIN bookings b ON b.id = bs.booking_id
        WHERE b.user_id = ?
    `).get(userId);

    const spent = db.prepare(
        'SELECT COALESCE(SUM(-amount), 0) AS spent FROM transactions WHERE user_id = ? AND amount < 0'
    ).get(userId);

    return {
        activeTickets: counts.active || 0,
        usedTickets: counts.used || 0,
        totalSpent: spent.spent || 0
    };
}

module.exports = { createBooking, listTickets, useTicket, getTicketStats };
