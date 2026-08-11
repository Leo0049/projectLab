'use strict';

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { badRequest, readPagination } = require('../utils/http');
const adminService = require('../services/admin');
const bookingService = require('../services/bookings');

const router = express.Router();

// 這個路由底下全部都要管理員身分
router.use(requireAuth, requireAdmin);

function pagination(req) {
    return readPagination(req, { defaultLimit: 20, maxLimit: 100 });
}

/**
 * GET /api/admin/stats - 營運儀表板
 */
router.get('/stats', (req, res) => {
    res.json(adminService.getDashboard());
});

/**
 * GET /api/admin/showtimes?date=&limit=&offset=
 */
router.get('/showtimes', (req, res) => {
    res.json(adminService.listShowtimes({ date: req.query.date, ...pagination(req) }));
});

/**
 * POST /api/admin/showtimes - 排片
 */
router.post('/showtimes', (req, res) => {
    const body = req.body || {};
    const result = adminService.createShowtime({
        movieId: Number(body.movieId),
        theaterId: Number(body.theaterId),
        date: String(body.date || ''),
        time: String(body.time || ''),
        price: Number(body.price)
    });
    res.status(201).json(result);
});

/**
 * DELETE /api/admin/showtimes/:id
 */
router.delete('/showtimes/:id', (req, res) => {
    res.json(adminService.deleteShowtime(Number(req.params.id)));
});

/**
 * GET /api/admin/bookings?limit=&offset=
 */
router.get('/bookings', (req, res) => {
    res.json(adminService.listBookings(pagination(req)));
});

/**
 * GET /api/admin/users?limit=&offset=
 */
router.get('/users', (req, res) => {
    res.json(adminService.listUsers(pagination(req)));
});

/**
 * POST /api/admin/tickets/:id/refund - 代客退票
 * userId 傳 null 表示跳過擁有者檢查
 */
router.post('/tickets/:id/refund', (req, res) => {
    const ticketId = Number(req.params.id);
    if (!Number.isInteger(ticketId)) throw badRequest('票券編號不正確');

    res.json(bookingService.refundTicket(ticketId, null));
});

module.exports = router;
