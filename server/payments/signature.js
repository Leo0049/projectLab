'use strict';

const crypto = require('crypto');

/**
 * 綠界 ECPay 的 CheckMacValue 演算法。
 *
 * 這段是金流整合中最不能寫錯的部分：驗證失敗代表回調可能被偽造。
 * 沙盒與正式環境用的是同一套規則，換成真的金流商時只要換金鑰。
 *
 * 步驟：
 *   1. 參數依照鍵名的字典序排序（不分大小寫）
 *   2. 前後接上 HashKey 與 HashIV
 *   3. 整串做 URL encode，再轉小寫
 *   4. 套用 .NET UrlEncode 的字元差異
 *   5. SHA256 後轉大寫
 */

/**
 * .NET 的 HttpUtility.UrlEncode 與 JavaScript 的 encodeURIComponent 對部分字元處理不同，
 * 綠界的規格是以前者為準，這裡把差異補回來。
 */
function dotNetUrlEncode(value) {
    return encodeURIComponent(value)
        .toLowerCase()
        .replace(/%20/g, '+')
        .replace(/%21/g, '!')
        .replace(/%27/g, "'")
        .replace(/%28/g, '(')
        .replace(/%29/g, ')')
        .replace(/%2a/g, '*')
        .replace(/%2d/g, '-')
        .replace(/%2e/g, '.')
        .replace(/%5f/g, '_');
}

/**
 * 計算 CheckMacValue
 * @param {Object} params - 不含 CheckMacValue 的參數
 * @param {string} hashKey
 * @param {string} hashIV
 * @returns {string} 64 字元的大寫十六進位字串
 */
function createCheckMacValue(params, hashKey, hashIV) {
    const sorted = Object.keys(params)
        .filter(key => key !== 'CheckMacValue')
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map(key => `${key}=${params[key]}`)
        .join('&');

    const raw = `HashKey=${hashKey}&${sorted}&HashIV=${hashIV}`;

    return crypto
        .createHash('sha256')
        .update(dotNetUrlEncode(raw))
        .digest('hex')
        .toUpperCase();
}

/**
 * 驗證回調的簽章。
 * 使用 timingSafeEqual 比對，避免以回應時間推測正確簽章。
 * @param {Object} params - 含 CheckMacValue 的完整回調參數
 * @returns {boolean}
 */
function verifyCheckMacValue(params, hashKey, hashIV) {
    const received = String(params.CheckMacValue || '');
    const expected = createCheckMacValue(params, hashKey, hashIV);

    if (received.length !== expected.length) return false;

    return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

module.exports = { createCheckMacValue, verifyCheckMacValue, dotNetUrlEncode };
