'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { getDb, writeTransaction } = require('./index');
const config = require('../config');
const { toLocalDateStr } = require('../utils/dates');

/**
 * 種子資料放在伺服器端，不能放進 FakeTheater/（那整個目錄是靜態公開的），
 * 否則 users.json 裡的明文密碼會直接被 GET 到。
 */
const DATA_DIR = path.join(__dirname, 'seed-data');

function readJson(name) {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
}

/**
 * 匯入電影與影廳（可重複執行，內容以 JSON 為準）
 */
const seedCatalog = writeTransaction(() => {
    const db = getDb();

    const insertMovie = db.prepare(`
        INSERT INTO movies (id, title, description, poster_image, hposter_image,
                            category, rating, duration, rating_class, release_date)
        VALUES (@id, @title, @description, @posterImage, @hposterImage,
                @category, @rating, @duration, @ratingClass, @releaseDate)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            description = excluded.description,
            poster_image = excluded.poster_image,
            hposter_image = excluded.hposter_image,
            category = excluded.category,
            rating = excluded.rating,
            duration = excluded.duration,
            rating_class = excluded.rating_class,
            release_date = excluded.release_date
    `);

    readJson('movies.json').forEach(movie => {
        insertMovie.run({
            id: movie.id,
            title: movie.title,
            description: movie.description || '',
            posterImage: movie.posterImage || '',
            hposterImage: movie.hposterImage || '',
            category: movie.category,
            rating: movie.rating || 0,
            duration: movie.duration || '',
            ratingClass: movie.ratingClass || '',
            releaseDate: movie.releaseDate || ''
        });
    });

    const insertTheater = db.prepare(`
        INSERT INTO theaters (id, name, total_rows, total_cols)
        VALUES (@id, @name, @totalRows, @totalCols)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            total_rows = excluded.total_rows,
            total_cols = excluded.total_cols
    `);

    readJson('theaters.json').forEach(theater => insertTheater.run(theater));
});

/**
 * 建立展示帳號。密碼在這裡才做 hash，資料庫不會存明文。
 * 已存在的帳號不會被覆蓋，避免洗掉使用者自己改過的餘額。
 *
 * 例外是管理員：設定了 ADMIN_PASSWORD 就每次啟動都覆寫它的密碼。
 * 種子檔裡的 admin123 寫在公開的原始碼與 README 裡，公開部署時必須換掉，
 * 而「已存在就不動」會讓改設定完全不生效。
 */
const seedDemoUsers = writeTransaction(() => {
    const db = getDb();
    const insert = db.prepare(`
        INSERT OR IGNORE INTO users (id, username, email, password_hash, balance, role)
        VALUES (@id, @username, @email, @passwordHash, @balance, @role)
    `);
    // 角色可能是後來才加的，既有帳號要補上
    const syncRole = db.prepare('UPDATE users SET role = ? WHERE id = ? AND role != ?');
    const setPassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');

    readJson('users.json').forEach(user => {
        const role = user.role === 'admin' ? 'admin' : 'user';
        const password = role === 'admin' && config.ADMIN_PASSWORD
            ? config.ADMIN_PASSWORD
            : user.password;

        const inserted = insert.run({
            id: user.id,
            username: user.username,
            email: user.email || `${user.username}@faketheater.com`,
            passwordHash: bcrypt.hashSync(password, 10),
            balance: Math.round(user.balance || 0),
            role: role
        }).changes > 0;
        syncRole.run(role, user.id, role);

        // 帳號已經存在時 INSERT OR IGNORE 什麼也沒做，管理員密碼要另外補寫
        if (!inserted && role === 'admin' && config.ADMIN_PASSWORD) {
            setPassword.run(bcrypt.hashSync(config.ADMIN_PASSWORD, 10), user.id);
        }
    });
});

/**
 * 產生某一天的場次。
 *
 * 依「影廳 × 時段」逐格排片，再把電影輪流填進去，
 * 因此天生就滿足 UNIQUE(theater_id, date, time)，不會排出兩場撞廳的電影。
 * @param {string} dateStr - YYYY-MM-DD
 * @param {number} dayOffset - 用來讓每天的片單輪替
 */
function buildDaySchedule(dateStr, dayOffset) {
    const db = getDb();
    const movies = db.prepare('SELECT id FROM movies ORDER BY id').all();
    const theaters = db.prepare('SELECT id FROM theaters ORDER BY id').all();
    if (movies.length === 0 || theaters.length === 0) return [];

    const rows = [];
    theaters.forEach((theater, theaterIndex) => {
        config.SCHEDULE_TIMES.forEach((time, timeIndex) => {
            const slot = theaterIndex * config.SCHEDULE_TIMES.length + timeIndex;
            const movie = movies[(slot + dayOffset) % movies.length];
            rows.push({
                movieId: movie.id,
                theaterId: theater.id,
                date: dateStr,
                time: time,
                price: config.SCHEDULE_PRICES[timeIndex % config.SCHEDULE_PRICES.length]
            });
        });
    });

    return rows;
}

/**
 * 確保未來 SCHEDULE_DAYS 天都有場次可訂。
 * 伺服器每次啟動時執行，所以放著幾週後再打開也不會變成空的。
 * @returns {number} 這次新增的場次數
 */
const ensureUpcomingShowtimes = writeTransaction(() => {
    const db = getDb();
    const countForDate = db.prepare('SELECT COUNT(*) AS n FROM showtimes WHERE date = ?');
    const insert = db.prepare(`
        INSERT OR IGNORE INTO showtimes (movie_id, theater_id, date, time, price)
        VALUES (@movieId, @theaterId, @date, @time, @price)
    `);

    const today = new Date();
    let created = 0;

    for (let dayOffset = 0; dayOffset < config.SCHEDULE_DAYS; dayOffset++) {
        const date = new Date(today);
        date.setDate(today.getDate() + dayOffset);
        const dateStr = toLocalDateStr(date);

        if (countForDate.get(dateStr).n > 0) continue;

        buildDaySchedule(dateStr, dayOffset).forEach(row => {
            created += insert.run(row).changes;
        });
    }

    return created;
});

module.exports = { seedCatalog, seedDemoUsers, ensureUpcomingShowtimes };
