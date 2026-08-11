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
 * 場次的開演時間（本地時區）
 */
function showtimeStartTime(date, time) {
    return new Date(`${date}T${time}:00`);
}

/**
 * 判斷一張票能不能退，以及可以退多少錢。
 *
 * 規則：
 *   - 只有「未使用」的票可以退
 *   - 距離開演不足 REFUND_CUTOFF_MINUTES 分鐘就不受理
 *   - 退款金額為票價扣除 REFUND_FEE_RATE 的手續費
 */
function evaluateRefund(ticketRow) {
    const price = ticketRow.price;
    const fee = Math.round(price * config.REFUND_FEE_RATE);
    const refundAmount = price - fee;

    if (ticketRow.status === 'refunded') {
        return { refundable: false, reason: '已退票', refundAmount: 0, fee };
    }
    if (ticketRow.status !== 'unused') {
        return { refundable: false, reason: '票券已使用，無法退票', refundAmount: 0, fee };
    }

    const cutoff = showtimeStartTime(ticketRow.date, ticketRow.time).getTime()
        - config.REFUND_CUTOFF_MINUTES * 60 * 1000;

    if (Date.now() >= cutoff) {
        return {
            refundable: false,
            reason: `開演前 ${config.REFUND_CUTOFF_MINUTES} 分鐘起不受理退票`,
            refundAmount: 0,
            fee
        };
    }

    return { refundable: true, reason: '', refundAmount, fee };
}

const TICKET_QUERY = `
    SELECT bs.id, bs.booking_id AS bookingId, bs.seat_row AS row, bs.seat_col AS col,
           bs.status, bs.used_at AS usedAt, bs.refunded_at AS refundedAt,
           b.showtime_id AS showtimeId, b.user_id AS userId, b.created_at AS createdAt,
           s.date, s.time, s.price,
           m.id AS movieId, m.title AS movieTitle, m.poster_image AS moviePoster,
           t.name AS theaterName
    FROM booking_seats bs
    JOIN bookings b  ON b.id = bs.booking_id
    JOIN showtimes s ON s.id = b.showtime_id
    JOIN movies m    ON m.id = s.movie_id
    JOIN theaters t  ON t.id = s.theater_id
`;

function toTicket(row) {
    const refund = evaluateRefund(row);
    return {
        id: row.id,
        bookingId: row.bookingId,
        showtimeId: row.showtimeId,
        movieId: row.movieId,
        movieTitle: row.movieTitle,
        moviePoster: row.moviePoster,
        date: row.date,
        time: row.time,
        theaterName: row.theaterName,
        price: row.price,
        seat: { row: row.row, col: row.col },
        seatLabel: seatService.formatSeat({ row: row.row, col: row.col }),
        status: row.status,
        usedAt: row.usedAt,
        refundedAt: row.refundedAt,
        refundable: refund.refundable,
        refundReason: refund.reason,
        refundAmount: refund.refundAmount,
        refundFee: refund.fee
    };
}

/**
 * 取得使用者的票券，每個座位是一張獨立票券
 * @param {number} userId
 * @returns {{active:Array, history:Array}}
 */
function listTickets(userId) {
    archiveExpiredTickets(userId);

    const rows = getDb().prepare(`
        ${TICKET_QUERY}
        WHERE b.user_id = ?
        ORDER BY s.date, s.time, bs.seat_row, bs.seat_col
    `).all(userId);

    return {
        active: rows.filter(r => r.status === 'unused' || r.status === 'using').map(toTicket),
        history: rows.filter(r => r.status === 'used' || r.status === 'refunded').map(toTicket)
    };
}

/**
 * 退票
 *
 * 在單一交易內完成：標記票券 → 退款入帳 → 更新訂單狀態 → 記錄交易。
 * 座位的 status 變成 refunded 之後就被排除在部分唯一索引外，位子隨即可以重新賣出，
 * 但這一列資料仍然保留，對帳查得到。
 *
 * @param {number} ticketId
 * @param {number|null} userId - 一般使用者只能退自己的票；管理員傳 null
 * @returns {{refundAmount:number, fee:number, balance:number|null, seatLabel:string}}
 */
const refundTicket = writeTransaction((ticketId, userId) => {
    const db = getDb();

    const row = db.prepare(`${TICKET_QUERY} WHERE bs.id = ?`).get(ticketId);
    if (!row) throw notFound('找不到這張票券');

    // userId 為 null 代表管理員代客退票，跳過擁有者檢查
    if (userId !== null && row.userId !== userId) {
        throw notFound('找不到這張票券');
    }

    const refund = evaluateRefund(row);
    if (!refund.refundable) {
        throw badRequest(refund.reason || '這張票券無法退票');
    }

    db.prepare('UPDATE booking_seats SET status = \'refunded\', refunded_at = ? WHERE id = ?')
        .run(Date.now(), ticketId);

    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?')
        .run(refund.refundAmount, row.userId);

    db.prepare('UPDATE bookings SET refunded_amount = refunded_amount + ? WHERE id = ?')
        .run(refund.refundAmount, row.bookingId);

    // 整筆訂單的座位都退光了就標記為 Refunded，否則是部分退票
    const remaining = db.prepare(`
        SELECT COUNT(*) AS n FROM booking_seats WHERE booking_id = ? AND status != 'refunded'
    `).get(row.bookingId).n;

    db.prepare('UPDATE bookings SET status = ? WHERE id = ?')
        .run(remaining === 0 ? 'Refunded' : 'PartiallyRefunded', row.bookingId);

    db.prepare(`
        INSERT INTO transactions (user_id, type, amount, movie_title, movie_date, showtime, booking_id)
        VALUES (?, '退票', ?, ?, ?, ?, ?)
    `).run(row.userId, refund.refundAmount, row.movieTitle, row.date, row.time, row.bookingId);

    const balance = db.prepare('SELECT balance FROM users WHERE id = ?').get(row.userId).balance;

    return {
        refundAmount: refund.refundAmount,
        fee: refund.fee,
        balance,
        seatLabel: seatService.formatSeat({ row: row.row, col: row.col })
    };
});

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
    if (ticket.status === 'using') return { alreadyUsing: true };

    // 用白名單而不是逐一排除：新增狀態時不會不小心讓它變成可使用。
    // 特別是 refunded——退票後座位可能已經賣給別人，若讓它回到 using，
    // 不只是讓已退款的票還能進場，還會撞上座位的唯一索引直接噴 500。
    if (ticket.status !== 'unused') {
        const reason = {
            used: '這張票券已經使用過了',
            refunded: '這張票券已退票，無法使用'
        }[ticket.status] || '這張票券目前無法使用';
        throw badRequest(reason);
    }

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
            SUM(CASE WHEN bs.status = 'used' THEN 1 ELSE 0 END) AS used,
            SUM(CASE WHEN bs.status = 'refunded' THEN 1 ELSE 0 END) AS refunded
        FROM booking_seats bs
        JOIN bookings b ON b.id = bs.booking_id
        WHERE b.user_id = ?
    `).get(userId);

    // 累計消費 = 支出總額 - 退票退回的金額
    const spent = db.prepare(`
        SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN type = '退票' THEN amount ELSE 0 END), 0) AS spent
        FROM transactions WHERE user_id = ?
    `).get(userId);

    return {
        activeTickets: counts.active || 0,
        usedTickets: counts.used || 0,
        refundedTickets: counts.refunded || 0,
        totalSpent: spent.spent || 0
    };
}

module.exports = {
    createBooking, listTickets, useTicket, getTicketStats,
    refundTicket, evaluateRefund, archiveExpiredTickets
};
