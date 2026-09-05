"use strict";

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// Путь к файлу базы данных. По умолчанию — ./data/moonshine.db,
// чтобы файл можно было легко скопировать для backup или положить в volume.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "moonshine.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
    created_at    TEXT NOT NULL DEFAULT (${NOW})
  );

  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS articles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    content     TEXT NOT NULL DEFAULT '',
    category_id INTEGER,
    author_id   INTEGER,
    created_at  TEXT NOT NULL DEFAULT (${NOW}),
    updated_at  TEXT NOT NULL DEFAULT (${NOW}),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id);
  CREATE INDEX IF NOT EXISTS idx_articles_title ON articles(title);
`);

module.exports = db;
