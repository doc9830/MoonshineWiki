"use strict";

const db = require("./db");
const { hashPassword } = require("./auth");
const { slugify } = require("./util");
const { CATEGORIES, ARTICLES } = require("./seed-data");

// Создаёт первого администратора и демо-контент, если база пуста.
// Идемпотентно: повторный запуск ничего не дублирует.
function ensureSeed() {
  const result = { adminCreated: false, categoriesCreated: false, articlesCreated: 0 };

  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (userCount === 0) {
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD || "admin123";
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(
      username,
      hashPassword(password)
    );
    result.adminCreated = true;
    console.log(`[seed] Создан администратор: ${username}`);
  }

  const categoryCount = db.prepare("SELECT COUNT(*) AS n FROM categories").get().n;
  if (categoryCount === 0) {
    const insertCategory = db.prepare(
      "INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)"
    );
    CATEGORIES.forEach((name, i) => insertCategory.run(name, slugify(name), i));
    result.categoriesCreated = true;
  }

  const articleCount = db.prepare("SELECT COUNT(*) AS n FROM articles").get().n;
  if (articleCount === 0) {
    const getCategory = db.prepare("SELECT id FROM categories WHERE name = ?");
    const getAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
    const admin = getAdmin.get();
    const insertArticle = db.prepare(
      "INSERT INTO articles (title, slug, content, category_id, author_id) VALUES (?, ?, ?, ?, ?)"
    );

    const tx = db.transaction(() => {
      for (const a of ARTICLES) {
        const cat = getCategory.get(a.category);
        insertArticle.run(
          a.title,
          slugify(a.title),
          a.content.trim(),
          cat ? cat.id : null,
          admin ? admin.id : null
        );
      }
    });
    tx();
    result.articlesCreated = ARTICLES.length;
  }

  return result;
}

module.exports = { ensureSeed };

if (require.main === module) {
  const r = ensureSeed();
  console.log("Seed завершён:", r);
}
