'use strict';

const { ensureUpcomingShowtimes } = require('./db/seed');

/**
 * 定時補齊未來幾天的場次。
 *
 * 場次原本只在伺服器啟動時補齊。一台長時間沒有重新部署的伺服器，
 * 排片視窗會一天天往前走，超過 SCHEDULE_DAYS 的新日期就永遠排不進去，前台會慢慢沒有場次可賣。
 * 這裡定時執行同一支補齊邏輯；已有場次的日期會跳過，重複執行沒有副作用。
 */

/**
 * 執行一次補齊。
 * @param {Date} [now] - 以這個時間點往後算視窗，預設為現在
 * @returns {number} 新增的場次數
 */
function refreshSchedule(now = new Date()) {
    return ensureUpcomingShowtimes(now);
}

/**
 * 啟動定時補齊。
 *
 * - 計時器呼叫 unref()：它本身不該讓行程保持存活（連接埠才是），關閉流程也不會被它卡住。
 * - 單次補齊失敗只記錄、不往外拋：setInterval 的回呼若拋出例外，會變成未捕捉例外把整個行程打掛。
 *
 * @param {Object} options
 * @param {number} options.intervalMs - 間隔（毫秒），0 表示不啟動
 * @param {Function} [options.refresh] - 實際執行補齊的函式，預設為 refreshSchedule
 * @param {Function} [options.onCreated] - 本次有新增場次時呼叫，參數為新增數量
 * @param {Function} [options.onError] - 補齊失敗時呼叫
 * @param {Function} [options.setIntervalFn] - 可注入的計時器（測試用）
 * @param {Function} [options.clearIntervalFn]
 * @returns {{stop: Function}|null} 未啟動時為 null
 */
function startScheduleRefresh({
    intervalMs,
    refresh = refreshSchedule,
    onCreated = () => {},
    onError = error => console.error('[schedule] 定時補齊失敗:', error),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
} = {}) {
    if (!intervalMs) return null;

    const tick = () => {
        try {
            const created = refresh();
            if (created > 0) onCreated(created);
        } catch (error) {
            onError(error);
        }
    };

    const timer = setIntervalFn(tick, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();

    return {
        stop: () => clearIntervalFn(timer)
    };
}

module.exports = { refreshSchedule, startScheduleRefresh };
