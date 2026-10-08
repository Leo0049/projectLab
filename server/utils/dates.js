'use strict';

// 場次日期與時間是台灣的營業時間，不應隨部署主機的時區改變。
const BUSINESS_TIME_ZONE = 'Asia/Taipei';
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
});

function getBusinessTimeParts(date) {
    return Object.fromEntries(
        dateTimeFormatter.formatToParts(date)
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value])
    );
}

/**
 * 取得台灣營業時區的 YYYY-MM-DD。
 * @param {Date} date
 * @returns {string}
 */
function toLocalDateStr(date = new Date()) {
    const { year, month, day } = getBusinessTimeParts(date);
    return `${year}-${month}-${day}`;
}

/**
 * 取得台灣營業時區的 HH:MM。
 * @param {Date} date
 * @returns {string}
 */
function toLocalTimeStr(date = new Date()) {
    const { hour, minute } = getBusinessTimeParts(date);
    return `${hour}:${minute}`;
}

/**
 * 將台灣營業時區的日期時間格式化成 YYYY/MM/DD HH:mm:ss。
 * @param {Date} date
 * @returns {string}
 */
function toLocalDateTimeStr(date = new Date()) {
    const { year, month, day, hour, minute, second } = getBusinessTimeParts(date);
    return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}

/**
 * 將台灣營業時區的日期與時間轉成絕對時間，避免依賴執行主機時區。
 * @param {string} dateStr YYYY-MM-DD
 * @param {string} timeStr HH:MM
 * @returns {Date}
 */
function localDateTimeToDate(dateStr, timeStr) {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(timeStr));
    if (!dateMatch || !timeMatch) return new Date(NaN);

    const [, yearText, monthText, dayText] = dateMatch;
    const [, hourText, minuteText] = timeMatch;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);

    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
        return new Date(NaN);
    }

    const localAsUtc = new Date(0);
    localAsUtc.setUTCFullYear(year, month - 1, day);
    localAsUtc.setUTCHours(hour, minute, 0, 0);
    if (localAsUtc.getUTCFullYear() !== year || localAsUtc.getUTCMonth() !== month - 1 ||
        localAsUtc.getUTCDate() !== day) {
        return new Date(NaN);
    }

    const guessedUtc = localAsUtc.getTime();
    const zoned = getBusinessTimeParts(new Date(guessedUtc));
    const zonedAsUtc = new Date(0);
    zonedAsUtc.setUTCFullYear(Number(zoned.year), Number(zoned.month) - 1, Number(zoned.day));
    zonedAsUtc.setUTCHours(Number(zoned.hour), Number(zoned.minute), Number(zoned.second), 0);
    const offset = zonedAsUtc.getTime() - guessedUtc;

    return new Date(guessedUtc - offset);
}

module.exports = {
    BUSINESS_TIME_ZONE,
    toLocalDateStr,
    toLocalTimeStr,
    toLocalDateTimeStr,
    localDateTimeToDate
};
