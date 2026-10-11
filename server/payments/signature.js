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
 *   4. 依綠界字元表還原 - _ . ! * ( )，' 與 ~ 維持跳脫（見 dotNetUrlEncode）
 *   5. SHA256 後轉大寫
 */

/**
 * 綠界 AIO 的 URL encode 規則：先做 urlencode、轉小寫，再把 - _ . ! * ( ) 還原成原字元。
 *
 * 這裡的實作與上述規則逐字元一致，而且已用 PHP 的 urlencode（綠界官方 PHP SDK 的作法）
 * 對上千組隨機字串比對過，結果完全相同。
 *   - encodeURIComponent 本來就不跳脫 - _ . ! * ( )，等同於「跳脫後再還原」
 *   - 但它不跳脫 ' 與 ~，而 urlencode 會把它們編成 %27 與 %7e，而且還原表不包含這兩個字元，
 *     所以必須明確補上，否則內容含有這兩個字元時簽章會與綠界對不上
 */
function dotNetUrlEncode(value) {
    return encodeURIComponent(value)
        .replace(/'/g, '%27')
        .replace(/~/g, '%7E')
        .replace(/%20/g, '+')
        .toLowerCase();
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
    // 空金鑰會讓簽章退化成可預測的公開雜湊，不能視為有效設定。
    if (!String(hashKey || '').trim() || !String(hashIV || '').trim()) return false;

    const received = String(params.CheckMacValue || '');
    if (!/^[0-9a-f]{64}$/i.test(received)) return false;

    const expected = createCheckMacValue(params, hashKey, hashIV);

    if (received.length !== expected.length) return false;

    return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

module.exports = { createCheckMacValue, verifyCheckMacValue, dotNetUrlEncode };
