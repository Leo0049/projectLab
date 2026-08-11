'use strict';

const config = require('../config');

/**
 * 網址的信任邊界
 *
 * 金流流程有兩個網址會被傳來傳去，兩個都不能直接相信外部輸入：
 *
 *   ReturnURL      伺服器會主動對它發出 POST → 若可被指定，就是 SSRF
 *   ClientBackURL  使用者的瀏覽器會被導過去 → 若可被指定，就是開放轉址（釣魚）
 *
 * 這裡的原則是「能不信就不信」：
 *   - 對外顯示用的網址以 PUBLIC_URL 為準，沒設定才退回 Host 標頭（Host 可被偽造）
 *   - 伺服器自己要打的回調，一律用連線的實際本地位址組出來，完全不看任何輸入
 *   - 瀏覽器要導去的位置，一律降級成相對路徑，跨站的可能性直接消失
 */

/**
 * 對外的正式網址（給使用者看、放進表單的那一個）
 * @param {import('express').Request} req
 * @returns {string} 不含結尾斜線
 */
function publicOrigin(req) {
    if (config.PUBLIC_URL) {
        return config.PUBLIC_URL.replace(/\/+$/, '');
    }
    return `${req.protocol}://${req.get('host')}`;
}

/**
 * 伺服器自己要呼叫的本站網址。
 *
 * 用這條連線實際綁定的位址與埠號，而不是 Host 標頭或設定值——
 * 這兩者都可能指向別的主機，只有 socket 的本地位址是偽造不了的。
 * @param {import('express').Request} req
 * @param {string} pathname - 以 / 開頭的路徑
 * @returns {string}
 */
function internalUrl(req, pathname) {
    const { localAddress, localPort } = req.socket;
    // IPv6 位址要加中括號才是合法的網址
    const host = localAddress && localAddress.includes(':')
        ? `[${localAddress}]`
        : (localAddress || '127.0.0.1');

    return `http://${host}:${localPort}${pathname}`;
}

// 解析相對路徑用的固定 base，本身不會被採用
const PLACEHOLDER_BASE = 'http://placeholder.invalid';

/**
 * 把外部傳來的返回網址降級成本站的相對路徑。
 *
 * 回傳值一定是相對路徑，所以不論如何都不可能轉址到站外；
 * 另外絕對網址還必須與信任來源同源，否則整個丟掉改用預設路徑
 * （避免把 https://evil.com/phish 變成本站的 /phish 而導向不存在的頁面）。
 *
 * @param {string} candidate
 * @param {string} fallbackPath - 不合法時使用的預設路徑
 * @param {string|null} trustedOrigin - 允許的來源，通常是 publicOrigin(req)
 * @returns {string} 以 / 開頭的相對路徑
 */
function toLocalPath(candidate, fallbackPath = '/', trustedOrigin = null) {
    const raw = String(candidate || '').trim();
    // `//evil.com/x` 會被瀏覽器當成跨站網址，不能只看開頭是不是 /
    if (!raw || raw.startsWith('//')) return fallbackPath;

    let url;
    try {
        url = new URL(raw, PLACEHOLDER_BASE);
    } catch (error) {
        return fallbackPath;
    }

    // origin 還是 placeholder，代表傳進來的本來就是相對路徑
    if (url.origin !== PLACEHOLDER_BASE) {
        if (!trustedOrigin) return fallbackPath;
        try {
            if (url.origin !== new URL(trustedOrigin).origin) return fallbackPath;
        } catch (error) {
            return fallbackPath;
        }
    }

    return `${url.pathname}${url.search}`;
}

module.exports = { publicOrigin, internalUrl, toLocalPath };
