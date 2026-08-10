'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { parseSeats } = require('../utils/http');
const seatService = require('../services/seats');
const bookingService = require('../services/bookings');

const router = express.Router();

/**
 * GET /api/showtimes/:id/seats
 * 座位圖。未登入也能看，只是不會有 heldByMe。
 */
router.get('/showtimes/:id/seats', (req, res) => {
    const userId = req.user ? req.user.id : null;
    res.json(seatService.getSeatMap(Number(req.params.id), userId));
});

/**
 * POST /api/showtimes/:id/locks
 * 選位後暫時保留座位，回傳保留到什麼時候
 */
router.post('/showtimes/:id/locks', requireAuth, (req, res) => {
    const seats = parseSeats(req.body?.seats);
    const result = seatService.lockSeats(Number(req.params.id), req.user.id, seats);
    res.json(result);
});

/**
 * DELETE /api/showtimes/:id/locks
 * 放棄結帳時把位子還回去
 */
router.delete('/showtimes/:id/locks', requireAuth, (req, res) => {
    res.json(seatService.releaseSeats(Number(req.params.id), req.user.id));
});

/**
 * POST /api/bookings
 * 付款並開票
 */
router.post('/bookings', requireAuth, (req, res) => {
    const showtimeId = Number(req.body?.showtimeId);
    const seats = parseSeats(req.body?.seats);

    const result = bookingService.createBooking(showtimeId, req.user.id, seats);
    res.status(201).json(result);
});

/**
 * GET /api/tickets
 * 我的票夾
 */
router.get('/tickets', requireAuth, (req, res) => {
    res.json(bookingService.listTickets(req.user.id));
});

/**
 * POST /api/tickets/:id/use
 * 進場（開始倒數）
 */
router.post('/tickets/:id/use', requireAuth, (req, res) => {
    bookingService.useTicket(Number(req.params.id), req.user.id);
    res.json(bookingService.listTickets(req.user.id));
});

/**
 * GET /api/tickets/stats
 */
router.get('/tickets/stats', requireAuth, (req, res) => {
    res.json(bookingService.getTicketStats(req.user.id));
});

module.exports = router;
