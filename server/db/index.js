'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

let db = null;

/**
 * 取得資料庫連線（單例）。
 *
 * WAL 模式讓讀取不會被寫入阻塞，配合寫入時的 BEGIN IMMEDIATE 交易，
 * 即使多個行程同時操作也不會出現超賣或髒讀。
 */
function getDb() {
    if (db) return db;

    fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });

    db = new Database(config.DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // 遇到鎖定時最多等 5 秒再回報 SQLITE_BUSY
    db.pragma('busy_timeout = 5000');

    return db;
}

/**
 * 建立資料表並補齊既有資料庫缺少的欄位。
 *
 * schema.sql 全部使用 IF NOT EXISTS，所以只會建立缺少的表；
 * 但已存在的表不會因此長出新欄位，因此後面再跑一次欄位遷移。
 * 整個流程可重複執行，伺服器每次啟動都會跑。
 */
function migrate() {
    const db = getDb();
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);
    applyColumnMigrations(db);
    rebuildLegacySeatIndex(db);
}

/**
 * 為既有資料表補上後來才加入的欄位
 */
function applyColumnMigrations(db) {
    const additions = [
        ['users', 'role', "TEXT NOT NULL DEFAULT 'user'"],
        ['bookings', 'refunded_amount', 'INTEGER NOT NULL DEFAULT 0'],
        ['booking_seats', 'refunded_at', 'INTEGER']
    ];

    additions.forEach(([table, column, definition]) => {
        const exists = db.prepare(`PRAGMA table_info(${table})`).all()
            .some(col => col.name === column);
        if (!exists) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
    });
}

/**
 * 早期版本用的是資料表內建的 UNIQUE(showtime_id, seat_row, seat_col)，
 * 那會讓退票後的位子永遠賣不出去。這裡把舊表換成使用部分唯一索引的新表。
 */
function rebuildLegacySeatIndex(db) {
    const hasLegacyUnique = db.prepare('PRAGMA index_list(booking_seats)').all()
        .some(index => index.origin === 'u');

    if (!hasLegacyUnique) return;

    db.exec(`
        BEGIN IMMEDIATE;

        CREATE TABLE booking_seats_new (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
            showtime_id INTEGER NOT NULL REFERENCES showtimes(id),
            seat_row    INTEGER NOT NULL CHECK (seat_row > 0),
            seat_col    INTEGER NOT NULL CHECK (seat_col > 0),
            status      TEXT    NOT NULL DEFAULT 'unused',
            used_at     INTEGER,
            refunded_at INTEGER
        );

        INSERT INTO booking_seats_new (id, booking_id, showtime_id, seat_row, seat_col, status, used_at, refunded_at)
            SELECT id, booking_id, showtime_id, seat_row, seat_col, status, used_at, refunded_at FROM booking_seats;

        DROP TABLE booking_seats;
        ALTER TABLE booking_seats_new RENAME TO booking_seats;

        CREATE UNIQUE INDEX idx_booking_seats_unique
            ON booking_seats (showtime_id, seat_row, seat_col)
            WHERE status != 'refunded';
        CREATE INDEX idx_booking_seats_showtime ON booking_seats (showtime_id);

        COMMIT;
    `);

    console.log('已將 booking_seats 遷移為部分唯一索引（支援退票）');
}

/**
 * 包成 BEGIN IMMEDIATE 交易。
 * IMMEDIATE 會在交易開始時就取得寫入鎖，避免兩個交易都讀完才發現要寫同一列而互相卡死。
 * @param {Function} fn
 * @returns {Function}
 */
function writeTransaction(fn) {
    return getDb().transaction(fn).immediate;
}

function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = { getDb, migrate, writeTransaction, closeDb };
