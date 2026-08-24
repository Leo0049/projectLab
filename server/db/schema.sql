-- FakeTheater 資料表定義
--
-- 設計重點：
--   booking_seats 上的 UNIQUE(showtime_id, seat_row, seat_col) 是防止超賣的最後一道防線，
--   即使應用層邏輯有漏洞、或有多個伺服器行程同時寫入，資料庫也不可能讓同一個位子賣出兩次。

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    balance       INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    role          TEXT    NOT NULL DEFAULT 'user',   -- user | admin
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS movies (
    id            INTEGER PRIMARY KEY,
    title         TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    poster_image  TEXT    NOT NULL DEFAULT '',
    hposter_image TEXT    NOT NULL DEFAULT '',
    category      TEXT    NOT NULL,
    rating        REAL    NOT NULL DEFAULT 0,
    duration      TEXT    NOT NULL DEFAULT '',
    rating_class  TEXT    NOT NULL DEFAULT '',
    release_date  TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS theaters (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    total_rows INTEGER NOT NULL CHECK (total_rows > 0),
    total_cols INTEGER NOT NULL CHECK (total_cols > 0)
);

CREATE TABLE IF NOT EXISTS showtimes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    movie_id   INTEGER NOT NULL REFERENCES movies(id),
    theater_id INTEGER NOT NULL REFERENCES theaters(id),
    date       TEXT    NOT NULL,   -- YYYY-MM-DD
    time       TEXT    NOT NULL,   -- HH:MM
    price      INTEGER NOT NULL CHECK (price >= 0),
    -- 同一個影廳的同一個時段只能排一場電影
    UNIQUE (theater_id, date, time)
);

CREATE INDEX IF NOT EXISTS idx_showtimes_lookup ON showtimes (date, movie_id);

CREATE TABLE IF NOT EXISTS bookings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    showtime_id     INTEGER NOT NULL REFERENCES showtimes(id),
    total_amount    INTEGER NOT NULL CHECK (total_amount >= 0),
    refunded_amount INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
    status          TEXT    NOT NULL DEFAULT 'Paid',  -- Paid | PartiallyRefunded | Refunded
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS booking_seats (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    showtime_id INTEGER NOT NULL REFERENCES showtimes(id),
    seat_row    INTEGER NOT NULL CHECK (seat_row > 0),
    seat_col    INTEGER NOT NULL CHECK (seat_col > 0),
    status      TEXT    NOT NULL DEFAULT 'unused',   -- unused | using | used | refunded
    used_at     INTEGER,                             -- epoch ms
    refunded_at INTEGER                              -- epoch ms
);

-- ★ 防止超賣的關鍵：部分唯一索引
-- 同一場次的同一個座位，在「尚未退票」的紀錄中只能存在一筆。
-- 退票後該列的 status 變成 refunded，就被排除在索引之外，位子可以重新賣出，
-- 但歷史紀錄仍然完整保留（不需要刪除資料）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_seats_unique
    ON booking_seats (showtime_id, seat_row, seat_col)
    WHERE status != 'refunded';

CREATE INDEX IF NOT EXISTS idx_booking_seats_showtime ON booking_seats (showtime_id);

-- 選位後的暫時保留。過期的列會在每次查詢／鎖定前被清掉。
CREATE TABLE IF NOT EXISTS seat_locks (
    showtime_id INTEGER NOT NULL REFERENCES showtimes(id),
    seat_row    INTEGER NOT NULL,
    seat_col    INTEGER NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    expires_at  INTEGER NOT NULL,                    -- epoch ms
    PRIMARY KEY (showtime_id, seat_row, seat_col)
);

CREATE INDEX IF NOT EXISTS idx_seat_locks_expiry ON seat_locks (expires_at);

CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    type        TEXT    NOT NULL,                    -- 儲值 | 購票 | 退票
    amount      INTEGER NOT NULL,                    -- 正數為收入、負數為支出
    movie_title TEXT    NOT NULL DEFAULT '',
    movie_date  TEXT    NOT NULL DEFAULT '',
    showtime    TEXT    NOT NULL DEFAULT '',
    booking_id  INTEGER REFERENCES bookings(id),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions (user_id, id DESC);

-- 金流訂單。儲值走第三方金流（沙盒），購票則是從錢包餘額扣款。
CREATE TABLE IF NOT EXISTS payment_orders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_order_no TEXT   NOT NULL UNIQUE,        -- 我方訂單編號，送給金流商
    user_id          INTEGER NOT NULL REFERENCES users(id),
    amount           INTEGER NOT NULL CHECK (amount > 0),
    status           TEXT    NOT NULL DEFAULT 'pending',  -- pending | paid | failed | expired
    provider         TEXT    NOT NULL DEFAULT 'sandbox',
    provider_trade_no TEXT,                          -- 金流商的交易編號
    callback_raw     TEXT,                           -- 原始回調內容，對帳用
    -- created_at／paid_at 是 UTC datetime 字串（給人看的，與其他表一致）
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    paid_at          TEXT,
    -- epoch ms：要跟 Date.now() 直接做數值比較（逾時判定），所以不用 datetime 字串
    expires_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders (user_id, id DESC);
