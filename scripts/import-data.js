"use strict";

// Импорт категорий и статей из data/export/data.json (upsert по slug).
// Идемпотентно: повторный запуск обновляет существующие записи, не дублируя.

const fs = require("fs");
const path = require("path");
const db = require("../db");

const EXPORT_PATH = path.join(__dirname, "..", "data", "export", "data.json");

function importData(filePath) {
  const src = filePath || EXPORT_PATH;
  if (!fs.existsSync(src)) {
    return { imported: false, reason: "file-not-found", path: src };
  }

  const data = JSON.parse(fs.readFileSync(src, "utf8"));
  const categories = data.categories || [];
  const articles = data.articles || [];

  const upsertCategory = db.prepare(
    `INSERT INTO categories (name, slug, sort_order)
     VALUES (@name, @slug, @sort_order)
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name,
       sort_order = excluded.sort_order`
  );

  const upsertArticle = db.prepare(
    `INSERT INTO articles (title, slug, content, category_id, created_at, updated_at)
     VALUES (@title, @slug, @content, @category_id, @created_at, @updated_at)
     ON CONFLICT(slug) DO UPDATE SET
       title = excluded.title,
       content = excluded.content,
       category_id = excluded.category_id,
       updated_at = excluded.updated_at`
  );

  const getCategoryId = db.prepare("SELECT id FROM categories WHERE slug = ?");

  const tx = db.transaction(() => {
    for (const c of categories) {
      upsertCategory.run({
        name: c.name,
        slug: c.slug,
        sort_order: Number(c.sort_order) || 0,
      });
    }
    for (const a of articles) {
      const cat = a.category_slug ? getCategoryId.get(a.category_slug) : null;
      const now = new Date().toISOString();
      upsertArticle.run({
        title: a.title,
        slug: a.slug,
        content: a.content || "",
        category_id: cat ? cat.id : null,
        created_at: a.created_at || now,
        updated_at: a.updated_at || a.created_at || now,
      });
    }
  });
  tx();

  return { imported: true, categories: categories.length, articles: articles.length };
}

// Импорт только на пустую базу — используется при первом запуске сервера.
function importDataIfEmpty() {
  const nCategories = db.prepare("SELECT COUNT(*) AS n FROM categories").get().n;
  const nArticles = db.prepare("SELECT COUNT(*) AS n FROM articles").get().n;
  if (nCategories === 0 && nArticles === 0) {
    return importData();
  }
  return { imported: false, reason: "db-not-empty" };
}

module.exports = { importData, importDataIfEmpty };

if (require.main === module) {
  const result = importData();
  console.log("Импорт завершён:", result);
}
