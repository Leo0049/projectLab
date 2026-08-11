'use strict';

/**
 * 帶 HTTP 狀態碼的錯誤，交給錯誤處理中介層轉成 JSON 回應。
 */
class HttpError extends Error {
    /**
     * @param {number} status
     * @param {string} message - 會直接顯示給使用者，請寫成看得懂的中文
     * @param {Object} [details] - 額外資訊，例如衝突的座位清單
     */
    constructor(status, message, details) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        if (details) this.details = details;
    }
}

const badRequest = (message, details) => new HttpError(400, message, details);
const unauthorized = (message = '請先登入') => new HttpError(401, message);
const notFound = (message = '找不到資料') => new HttpError(404, message);
const conflict = (message, details) => new HttpError(409, message, details);

/**
 * 驗證座位陣列格式
 * @param {*} seats
 * @returns {Array<{row:number, col:number}>}
 */
function parseSeats(seats) {
    if (!Array.isArray(seats) || seats.length === 0) {
        throw badRequest('請至少選擇一個座位');
    }

    const parsed = seats.map(seat => {
        const row = Number(seat?.row);
        const col = Number(seat?.col);
        if (!Number.isInteger(row) || !Number.isInteger(col) || row < 1 || col < 1) {
            throw badRequest('座位格式不正確');
        }
        return { row, col };
    });

    const unique = new Set(parsed.map(s => `${s.row}-${s.col}`));
    if (unique.size !== parsed.length) {
        throw badRequest('選位中有重複的座位');
    }

    return parsed;
}

/**
 * 解析分頁參數。
 *
 * limit 一定要有下界：SQLite 把 `LIMIT -1` 當成「不限筆數」，
 * 只設上界的話 ?limit=-1 就會把整張表倒出來。
 * @param {import('express').Request} req
 * @param {{defaultLimit?:number, maxLimit?:number}} options
 * @returns {{limit:number, offset:number}}
 */
function readPagination(req, { defaultLimit = 20, maxLimit = 100 } = {}) {
    const rawLimit = Number(req.query.limit);
    const rawOffset = Number(req.query.offset);

    const limit = Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), maxLimit)
        : defaultLimit;

    const offset = Number.isFinite(rawOffset) && rawOffset > 0
        ? Math.floor(rawOffset)
        : 0;

    return { limit, offset };
}

module.exports = {
    HttpError, badRequest, unauthorized, notFound, conflict, parseSeats, readPagination
};
