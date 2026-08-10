'use strict';

/**
 * 取得本地時區的 YYYY-MM-DD。
 * 不能用 toISOString()，那是 UTC，在 UTC+8 的凌晨會少算一天。
 * @param {Date} date
 * @returns {string}
 */
function toLocalDateStr(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 取得本地時區的 HH:MM
 * @param {Date} date
 * @returns {string}
 */
function toLocalTimeStr(date = new Date()) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

module.exports = { toLocalDateStr, toLocalTimeStr };
