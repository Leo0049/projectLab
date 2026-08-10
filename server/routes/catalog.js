'use strict';

const express = require('express');
const { getDb } = require('../db');
const { notFound } = require('../utils/http');
const { toLocalDateStr, toLocalTimeStr } = require('../utils/dates');

const router = express.Router();

const MOVIE_COLUMNS = `
    id, title, description,
    poster_image  AS posterImage,
    hposter_image AS hposterImage,
    category, rating, duration,
    rating_class  AS ratingClass,
    release_date  AS releaseDate
`;

/**
 * GET /api/movies?category=NowShowing
 */
router.get('/movies', (req, res) => {
    const category = req.query.category;
    const db = getDb();

    const movies = category
        ? db.prepare(`SELECT ${MOVIE_COLUMNS} FROM movies WHERE category = ? ORDER BY id`).all(category)
        : db.prepare(`SELECT ${MOVIE_COLUMNS} FROM movies ORDER BY id`).all();

    res.json({ movies });
});

/**
 * GET /api/movies/:id
 */
router.get('/movies/:id', (req, res) => {
    const movie = getDb()
        .prepare(`SELECT ${MOVIE_COLUMNS} FROM movies WHERE id = ?`)
        .get(Number(req.params.id));

    if (!movie) throw notFound('找不到這部電影');
    res.json({ movie });
});

/**
 * GET /api/theaters
 */
router.get('/theaters', (req, res) => {
    const theaters = getDb().prepare(`
        SELECT id, name, total_rows AS totalRows, total_cols AS totalCols
        FROM theaters ORDER BY id
    `).all();

    res.json({ theaters });
});

/**
 * GET /api/showtimes?movieId=&date=&theaterId=
 *
 * 只回傳還沒開演的場次，並附上電影與影廳資訊，前端不需要再自己 join。
 */
router.get('/showtimes', (req, res) => {
    const now = new Date();
    const today = toLocalDateStr(now);
    const currentTime = toLocalTimeStr(now);

    const conditions = ['(s.date > @today OR (s.date = @today AND s.time > @currentTime))'];
    const params = { today, currentTime };

    if (req.query.movieId) {
        conditions.push('s.movie_id = @movieId');
        params.movieId = Number(req.query.movieId);
    }
    if (req.query.date) {
        conditions.push('s.date = @date');
        params.date = String(req.query.date);
    }
    if (req.query.theaterId) {
        conditions.push('s.theater_id = @theaterId');
        params.theaterId = Number(req.query.theaterId);
    }

    const db = getDb();
    const whereClause = conditions.join(' AND ');

    const total = db.prepare(`SELECT COUNT(*) AS n FROM showtimes s WHERE ${whereClause}`)
        .get(params).n;

    // 有給 limit 才分頁；時刻表與電影詳情需要一次拿完，就不帶 limit
    const paginated = req.query.limit !== undefined;
    params.limit = Math.min(Number(req.query.limit) || 20, 100);
    params.offset = Math.max(Number(req.query.offset) || 0, 0);

    const showtimes = db.prepare(`
        SELECT s.id, s.movie_id AS movieId, s.theater_id AS theaterId,
               s.date, s.time, s.price,
               m.title        AS movieTitle,
               m.poster_image AS moviePoster,
               m.rating       AS movieRating,
               m.duration     AS movieDuration,
               m.rating_class AS movieRatingClass,
               t.name         AS theaterName,
               t.total_rows   AS theaterRows,
               t.total_cols   AS theaterCols,
               (SELECT COUNT(*) FROM booking_seats bs
                 WHERE bs.showtime_id = s.id AND bs.status != 'refunded') AS soldSeats
        FROM showtimes s
        JOIN movies m   ON m.id = s.movie_id
        JOIN theaters t ON t.id = s.theater_id
        WHERE ${whereClause}
        ORDER BY s.date, s.time, s.id
        ${paginated ? 'LIMIT @limit OFFSET @offset' : ''}
    `).all(params);

    res.json({
        showtimes,
        total,
        hasMore: paginated ? params.offset + showtimes.length < total : false
    });
});

module.exports = router;
