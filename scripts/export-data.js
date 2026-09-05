"use strict";

// Экспорт категорий и статей из SQLite в JSON (в stdout).
// Пароли пользователей и сессии НЕ выгружаются — только контент.

const db = require("../db");

const categories = db
  .prepare("SELECT name, slug, sort_order FROM categories ORDER BY sort_order, name")
  .all();

const articles = db
  .prepare(
    `SELECT a.title, a.slug, a.content, a.created_at, a.updated_at,
            c.slug AS category_slug
       FROM articles a
       LEFT JOIN categories c ON c.id = a.category_id
      ORDER BY a.title`
  )
  .all();

const payload = {
  exported_at: new Date().toISOString(),
  categories,
  articles,
};

process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
