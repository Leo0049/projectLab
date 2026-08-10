'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

let db = null;

/**
 * 取得資料庫連線（單例）。
 *
 * WAL 模式讓讀取不會被寫入阻塞，配合寫入時的 BEGIN IMMEDIATE 交易，
 * 即使多個行程同時操作也不會出現超賣或髒讀。
 */
function getDb() {
    if (db) return db;

    fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });

    db = new Database(config.DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // 遇到鎖定時最多等 5 秒再回報 SQLITE_BUSY
    db.pragma('busy_timeout = 5000');

    return db;
}

/**
 * 建立資料表（IF NOT EXISTS，可重複執行）
 */
function migrate() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    getDb().exec(schema);
}

/**
 * 包成 BEGIN IMMEDIATE 交易。
 * IMMEDIATE 會在交易開始時就取得寫入鎖，避免兩個交易都讀完才發現要寫同一列而互相卡死。
 * @param {Function} fn
 * @returns {Function}
 */
function writeTransaction(fn) {
    return getDb().transaction(fn).immediate;
}

function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = { getDb, migrate, writeTransaction, closeDb };
