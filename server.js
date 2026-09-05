"use strict";

const path = require("path");
const express = require("express");
const session = require("express-session");

const db = require("./db");
const { hashPassword, verifyPassword, requireAuth, requireAdmin, SqliteSessionStore } = require("./auth");
const { slugify } = require("./util");
const { ensureSeed } = require("./seed");
const { importDataIfEmpty } = require("./scripts/import-data");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

app.disable("x-powered-by");
app.use(express.json());

// --- Сессии (persistent, хранятся в SQLite) ---
app.use(
  session({
    store: new SqliteSessionStore(),
    secret: process.env.SESSION_SECRET || "moonshinewiki-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
    },
  })
);

// --- Статические файлы фронтенда и vendor-библиотеки ---
app.use(express.static(PUBLIC_DIR));
app.get("/vendor/marked.min.js", (req, res) =>
  res.sendFile(path.join(__dirname, "node_modules", "marked", "lib", "marked.umd.js"))
);
app.get("/vendor/purify.min.js", (req, res) =>
  res.sendFile(path.join(__dirname, "node_modules", "dompurify", "dist", "purify.min.js"))
);

// --- Auth ---
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Введите логин и пароль" });
  }
  const user = db
    .prepare("SELECT id, username, password_hash, role FROM users WHERE username = ?")
    .get(String(username).trim());
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    return res.status(401).json({ error: "Неверный логин или пароль" });
  }
  req.session.userId = user.id;
  res.json({ id: user.id, username: user.username, role: user.role });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Требуется авторизация" });
  }
  const user = db
    .prepare("SELECT id, username, role, created_at FROM users WHERE id = ?")
    .get(req.session.userId);
  if (!user) return res.status(401).json({ error: "Пользователь не найден" });
  res.json(user);
});

// --- Категории ---
app.get("/api/categories", requireAuth, (req, res) => {
  const categories = db
    .prepare(
      `SELECT c.id, c.name, c.slug,
              COUNT(a.id) AS article_count
         FROM categories c
         LEFT JOIN articles a ON a.category_id = c.id
        GROUP BY c.id
        ORDER BY c.sort_order, c.name`
    )
    .all();
  res.json(categories);
});

// --- Статьи: список и поиск ---
app.get("/api/articles", requireAuth, (req, res) => {
  const category = (req.query.category || "").trim();
  if (category) {
    const rows = db
      .prepare(
        `SELECT a.id, a.title, a.slug, a.updated_at,
                c.name AS category_name, c.slug AS category_slug
           FROM articles a
           LEFT JOIN categories c ON a.category_id = c.id
          WHERE c.slug = ?
          ORDER BY a.title`
      )
      .all(category);
    return res.json(rows);
  }
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.slug, a.updated_at,
              c.name AS category_name, c.slug AS category_slug
         FROM articles a
         LEFT JOIN categories c ON a.category_id = c.id
        ORDER BY a.updated_at DESC, a.title`
    )
    .all();
  res.json(rows);
});

// Поиск по названию и содержимому. База маленькая, поэтому простой
// регистронезависимый фильтр на JS (корректно работает с кириллицей).
app.get("/api/search", requireAuth, (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  if (!q) return res.json([]);
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.slug, a.content, a.updated_at,
              c.name AS category_name, c.slug AS category_slug
         FROM articles a
         LEFT JOIN categories c ON a.category_id = c.id
        ORDER BY a.title`
    )
    .all();
  const results = rows
    .filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.content || "").toLowerCase().includes(q)
    )
    .slice(0, 50)
    .map(({ content, ...rest }) => rest);
  res.json(results);
});

// --- Статья по slug ---
app.get("/api/articles/:slug", requireAuth, (req, res) => {
  const article = db
    .prepare(
      `SELECT a.id, a.title, a.slug, a.content, a.created_at, a.updated_at,
              a.category_id, c.name AS category_name, c.slug AS category_slug,
              u.username AS author_name
         FROM articles a
         LEFT JOIN categories c ON a.category_id = c.id
         LEFT JOIN users u ON a.author_id = u.id
        WHERE a.slug = ?`
    )
    .get(req.params.slug);
  if (!article) return res.status(404).json({ error: "Статья не найдена" });
  res.json(article);
});

function uniqueSlug(base) {
  const baseSlug = base || "article";
  let slug = baseSlug;
  let i = 2;
  const exists = db.prepare("SELECT 1 FROM articles WHERE slug = ?");
  while (exists.get(slug)) {
    slug = `${baseSlug}-${i++}`;
  }
  return slug;
}

// --- Создание статьи (только admin) ---
app.post("/api/articles", requireAdmin, (req, res) => {
  const { title, content, category_id } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: "Заголовок обязателен" });
  }
  const slug = uniqueSlug(slugify(String(title)));
  const now = new Date().toISOString();
  const info = db
    .prepare(
      "INSERT INTO articles (title, slug, content, category_id, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      String(title).trim(),
      slug,
      String(content || ""),
      category_id || null,
      req.user.id,
      now,
      now
    );
  const article = db
    .prepare("SELECT id, title, slug, content, category_id, updated_at FROM articles WHERE id = ?")
    .get(info.lastInsertRowid);
  res.status(201).json(article);
});

// --- Редактирование статьи (только admin). Slug не меняем, чтобы ссылки
// между статьями оставались рабочими. ---
app.put("/api/articles/:id", requireAdmin, (req, res) => {
  const { title, content, category_id } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: "Заголовок обязателен" });
  }
  const existing = db.prepare("SELECT id FROM articles WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Статья не найдена" });

  db.prepare(
    "UPDATE articles SET title = ?, content = ?, category_id = ?, updated_at = ? WHERE id = ?"
  ).run(
    String(title).trim(),
    String(content || ""),
    category_id || null,
    new Date().toISOString(),
    req.params.id
  );
  const article = db
    .prepare("SELECT id, title, slug, content, category_id, updated_at FROM articles WHERE id = ?")
    .get(req.params.id);
  res.json(article);
});

// --- Удаление статьи (только admin) ---
app.delete("/api/articles/:id", requireAdmin, (req, res) => {
  const info = db.prepare("DELETE FROM articles WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Статья не найдена" });
  res.json({ ok: true });
});

// --- Пользователи (только admin) ---
app.get("/api/users", requireAdmin, (req, res) => {
  const users = db
    .prepare("SELECT id, username, role, created_at FROM users ORDER BY id")
    .all();
  res.json(users);
});

app.post("/api/users", requireAdmin, (req, res) => {
  const { username, password, role } = req.body || {};
  const name = String(username || "").trim();
  if (!name || !password) {
    return res.status(400).json({ error: "Логин и пароль обязательны" });
  }
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(name);
  if (existing) return res.status(409).json({ error: "Такой логин уже существует" });
  const userRole = role === "admin" ? "admin" : "user";
  const info = db
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
    .run(name, hashPassword(String(password)), userRole);
  const user = db
    .prepare("SELECT id, username, role, created_at FROM users WHERE id = ?")
    .get(info.lastInsertRowid);
  res.status(201).json(user);
});

app.put("/api/users/:id", requireAdmin, (req, res) => {
  const { username, password, role } = req.body || {};
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Пользователь не найден" });

  const name = username ? String(username).trim() : existing.username;
  const dup = db
    .prepare("SELECT id FROM users WHERE username = ? AND id != ?")
    .get(name, req.params.id);
  if (dup) return res.status(409).json({ error: "Такой логин уже существует" });

  const userRole = role === "admin" ? "admin" : role === "user" ? "user" : existing.role;

  if (password) {
    db.prepare("UPDATE users SET username = ?, role = ?, password_hash = ? WHERE id = ?").run(
      name,
      userRole,
      hashPassword(String(password)),
      req.params.id
    );
  } else {
    db.prepare("UPDATE users SET username = ?, role = ? WHERE id = ?").run(name, userRole, req.params.id);
  }

  const user = db
    .prepare("SELECT id, username, role, created_at FROM users WHERE id = ?")
    .get(req.params.id);
  res.json(user);
});

app.delete("/api/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(400).json({ error: "Нельзя удалить самого себя" });
  }
  const target = db.prepare("SELECT id, role FROM users WHERE id = ?").get(id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });

  if (target.role === "admin") {
    const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (adminCount <= 1) {
      return res.status(400).json({ error: "Нельзя удалить последнего администратора" });
    }
  }

  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.json({ ok: true });
});

// --- SPA fallback: все GET-запросы (кроме /api и файлов) отдают index.html ---
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api")) return next();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// --- Обработка ошибок ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

// --- Первоначальная настройка: импорт сохранённых данных + администратор + демо-контент ---
importDataIfEmpty();
ensureSeed();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MoonshineWiki запущен на http://localhost:${PORT}`);
  console.log(
    `База данных: ${path.resolve(process.env.DB_PATH || path.join(__dirname, "data", "moonshine.db"))}`
  );
});


