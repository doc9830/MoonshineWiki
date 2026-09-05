"use strict";

const bcrypt = require("bcryptjs");
const session = require("express-session");
const db = require("./db");

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

// Лёгкий store сессий поверх той же SQLite-базы.
// Сессии переживают перезапуск сервера и хранятся в том же volume.
class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid    TEXT PRIMARY KEY,
        sess   TEXT NOT NULL,
        expire INTEGER NOT NULL
      );
    `);
    this.getStmt = db.prepare("SELECT sess FROM sessions WHERE sid = ?");
    this.setStmt = db.prepare(
      "INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?) " +
        "ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire"
    );
    this.delStmt = db.prepare("DELETE FROM sessions WHERE sid = ?");
  }

  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      const cookie = sess.cookie || {};
      const expire = cookie.expires
        ? Math.ceil(new Date(cookie.expires).getTime())
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      this.setStmt.run(sid, JSON.stringify(sess), expire);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.delStmt.run(sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      this.set(sid, sess, cb);
    } catch (err) {
      cb(err);
    }
  }
}

// Требуется авторизованная сессия. Заполняет req.user.
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Требуется авторизация" });
  }
  const user = db
    .prepare("SELECT id, username, role, created_at FROM users WHERE id = ?")
    .get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Пользователь не найден" });
  }
  req.user = user;
  next();
}

// Требуется роль admin. Серверная проверка прав — обычный пользователь
// не может вызвать admin API даже напрямую.
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Недостаточно прав" });
    }
    next();
  });
}

module.exports = {
  hashPassword,
  verifyPassword,
  requireAuth,
  requireAdmin,
  SqliteSessionStore,
};
