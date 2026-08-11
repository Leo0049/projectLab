'use strict';

const { getDb, writeTransaction } = require('../db');
const { badRequest, notFound, conflict } = require('../utils/http');
const { toLocalDateStr } = require('../utils/dates');

/**
 * 管理後台的查詢與營運操作
 */

/**
 * 營運儀表板
 *
 * 票房只計算實際入帳的金額：購票金額扣掉退票退回的金額。
 */
function getDashboard() {
    const db = getDb();
    const today = toLocalDateStr();

    const revenue = db.prepare(`
        SELECT
            COALESCE(SUM(total_amount), 0)    AS gross,
            COALESCE(SUM(refunded_amount), 0) AS refunded
        FROM bookings
    `).get();

    const seatStats = db.prepare(`
        SELECT
            SUM(CASE WHEN status != 'refunded' THEN 1 ELSE 0 END) AS sold,
            SUM(CASE WHEN status = 'refunded'  THEN 1 ELSE 0 END) AS refunded,
            SUM(CASE WHEN status = 'used'      THEN 1 ELSE 0 END) AS used
        FROM booking_seats
    `).get();

    const todayStats = db.prepare(`
        SELECT
            COUNT(DISTINCT s.id) AS showtimes,
            COALESCE(SUM(t.total_rows * t.total_cols), 0) AS capacity
        FROM showtimes s
        JOIN theaters t ON t.id = s.theater_id
        WHERE s.date = ?
    `).get(today);

    const todaySold = db.prepare(`
        SELECT COUNT(*) AS n
        FROM booking_seats bs
        JOIN showtimes s ON s.id = bs.showtime_id
        WHERE s.date = ? AND bs.status != 'refunded'
    `).get(today).n;

    const userCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'user'").get().n;

    const pendingPayments = db.prepare(
        "SELECT COUNT(*) AS n FROM payment_orders WHERE status = 'pending'"
    ).get().n;

    const topMovies = db.prepare(`
        SELECT m.id, m.title, m.poster_image AS posterImage,
               COUNT(bs.id) AS ticketsSold,
               COALESCE(SUM(s.price), 0) AS revenue
        FROM booking_seats bs
        JOIN showtimes s ON s.id = bs.showtime_id
        JOIN movies m    ON m.id = s.movie_id
        WHERE bs.status != 'refunded'
        GROUP BY m.id
        ORDER BY ticketsSold DESC, revenue DESC
        LIMIT 5
    `).all();

    return {
        revenue: {
            gross: revenue.gross,
            refunded: revenue.refunded,
            net: revenue.gross - revenue.refunded
        },
        tickets: {
            sold: seatStats.sold || 0,
            refunded: seatStats.refunded || 0,
            used: seatStats.used || 0
        },
        today: {
            date: today,
            showtimes: todayStats.showtimes,
            capacity: todayStats.capacity,
            sold: todaySold,
            occupancy: todayStats.capacity > 0
                ? Math.round((todaySold / todayStats.capacity) * 1000) / 10
                : 0
        },
        userCount,
        pendingPayments,
        topMovies
    };
}

/**
 * 場次列表（含售出率）
 */
function listShowtimes({ date, limit = 20, offset = 0 } = {}) {
    const db = getDb();
    const where = date ? 'WHERE s.date = @date' : '';
    const params = { date, limit, offset };

    const total = db.prepare(`SELECT COUNT(*) AS n FROM showtimes s ${where}`).get(params).n;

    const showtimes = db.prepare(`
        SELECT s.id, s.date, s.time, s.price,
               m.id AS movieId, m.title AS movieTitle,
               t.id AS theaterId, t.name AS theaterName,
               t.total_rows * t.total_cols AS capacity,
               (SELECT COUNT(*) FROM booking_seats bs
                 WHERE bs.showtime_id = s.id AND bs.status != 'refunded') AS sold
        FROM showtimes s
        JOIN movies m   ON m.id = s.movie_id
        JOIN theaters t ON t.id = s.theater_id
        ${where}
        ORDER BY s.date DESC, s.time DESC
        LIMIT @limit OFFSET @offset
    `).all(params);

    return {
        showtimes: showtimes.map(row => ({
            ...row,
            occupancy: row.capacity > 0 ? Math.round((row.sold / row.capacity) * 1000) / 10 : 0
        })),
        total,
        hasMore: offset + showtimes.length < total
    };
}

/**
 * 排片
 */
const createShowtime = writeTransaction(({ movieId, theaterId, date, time, price }) => {
    const db = getDb();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw badRequest('日期格式須為 YYYY-MM-DD');
    if (!/^\d{2}:\d{2}$/.test(String(time))) throw badRequest('時間格式須為 HH:MM');
    if (!Number.isInteger(price) || price <= 0) throw badRequest('票價必須是正整數');
    if (date < toLocalDateStr()) throw badRequest('不能排在過去的日期');

    if (!db.prepare('SELECT 1 FROM movies WHERE id = ?').get(movieId)) {
        throw notFound('找不到這部電影');
    }
    if (!db.prepare('SELECT 1 FROM theaters WHERE id = ?').get(theaterId)) {
        throw notFound('找不到這個影廳');
    }

    // UNIQUE(theater_id, date, time) 會擋下撞廳，這裡先給出可讀的訊息
    const clash = db.prepare(
        'SELECT 1 FROM showtimes WHERE theater_id = ? AND date = ? AND time = ?'
    ).get(theaterId, date, time);
    if (clash) throw conflict('這個影廳在該時段已經有排片了');

    const id = db.prepare(`
        INSERT INTO showtimes (movie_id, theater_id, date, time, price)
        VALUES (?, ?, ?, ?, ?)
    `).run(movieId, theaterId, date, time, price).lastInsertRowid;

    return { id };
});

/**
 * 刪除場次。已經有人訂票就不能刪，避免票變成孤兒。
 */
const deleteShowtime = writeTransaction((showtimeId) => {
    const db = getDb();

    if (!db.prepare('SELECT 1 FROM showtimes WHERE id = ?').get(showtimeId)) {
        throw notFound('找不到這個場次');
    }

    // 已退票的座位仍然是 booking_seats／bookings 的一列，外鍵照樣擋著，
    // 只看「未退票」的數量會讓全數退票的場次在刪除時噴 FOREIGN KEY 500。
    const seats = db.prepare(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status != 'refunded' THEN 1 ELSE 0 END) AS active
        FROM booking_seats WHERE showtime_id = ?
    `).get(showtimeId);

    if (seats.total > 0) {
        const active = seats.active || 0;
        throw conflict(active > 0
            ? `這個場次已售出 ${active} 張票，無法刪除`
            : '這個場次有退票紀錄，為保留對帳資料無法刪除');
    }

    db.prepare('DELETE FROM seat_locks WHERE showtime_id = ?').run(showtimeId);
    db.prepare('DELETE FROM showtimes WHERE id = ?').run(showtimeId);

    return { deleted: true };
});

/**
 * 訂單列表（跨使用者）
 */
function listBookings({ limit = 20, offset = 0 } = {}) {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n;

    const bookings = db.prepare(`
        SELECT b.id, b.total_amount AS totalAmount, b.refunded_amount AS refundedAmount,
               b.status, b.created_at AS createdAt,
               u.id AS userId, u.username,
               s.date, s.time,
               m.title AS movieTitle,
               t.name AS theaterName
        FROM bookings b
        JOIN users u     ON u.id = b.user_id
        JOIN showtimes s ON s.id = b.showtime_id
        JOIN movies m    ON m.id = s.movie_id
        JOIN theaters t  ON t.id = s.theater_id
        ORDER BY b.id DESC
        LIMIT ? OFFSET ?
    `).all(limit, offset);

    const seatStmt = db.prepare(`
        SELECT id, seat_row AS row, seat_col AS col, status
        FROM booking_seats WHERE booking_id = ?
        ORDER BY seat_row, seat_col
    `);

    return {
        bookings: bookings.map(booking => ({
            ...booking,
            seats: seatStmt.all(booking.id).map(seat => ({
                id: seat.id,
                label: `${String.fromCharCode(64 + seat.row)}${seat.col}`,
                status: seat.status
            }))
        })),
        total,
        hasMore: offset + bookings.length < total
    };
}

/**
 * 會員列表
 */
function listUsers({ limit = 20, offset = 0 } = {}) {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

    const users = db.prepare(`
        SELECT u.id, u.username, u.email, u.balance, u.role, u.created_at AS createdAt,
               (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id) AS bookingCount,
               (SELECT COUNT(*)
                  FROM booking_seats bs
                  JOIN bookings b2 ON b2.id = bs.booking_id
                 WHERE b2.user_id = u.id AND bs.status != 'refunded') AS ticketCount
        FROM users u
        ORDER BY u.id
        LIMIT ? OFFSET ?
    `).all(limit, offset);

    return { users, total, hasMore: offset + users.length < total };
}

module.exports = {
    getDashboard,
    listShowtimes,
    createShowtime,
    deleteShowtime,
    listBookings,
    listUsers
};
