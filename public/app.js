"use strict";

/* MoonshineWiki — клиентское SPA (без сборки). */

function readLS(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage может быть недоступен */
  }
}

const state = {
  user: null,
  theme: readLS("wiki-theme", "light"),
  catView: readLS("wiki-catview", "grid"),
};

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
}

// ---------- Утилиты ----------

function $(sel) {
  return document.querySelector(sel);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

let toastTimer;
function toast(message) {
  const t = $("#toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function renderMarkdown(text) {
  if (!window.marked) return escapeHtml(text);
  let html;
  try {
    html = window.marked.parse(String(text || ""), { breaks: true, gfm: true });
  } catch (e) {
    html = window.marked.parse(String(text || ""));
  }
  return window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
}

// ---------- API ----------

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
  });
  if (res.status === 401) {
    state.user = null;
    renderHeader();
    renderNav(currentRouteName());
    if (location.pathname !== "/login") {
      navigate("/login", true);
    }
    const err = new Error("Требуется авторизация");
    err.unauthorized = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Ошибка запроса");
  }
  return data;
}

// ---------- Роутер ----------

function parseRoute() {
  const path = location.pathname;
  if (path === "/") return { name: "home" };
  if (path === "/search") {
    return { name: "search", q: new URLSearchParams(location.search).get("q") || "" };
  }
  if (path === "/login") return { name: "login" };
  if (path === "/profile") return { name: "profile" };
  if (path === "/admin") return { name: "admin" };
  if (path === "/new") return { name: "new" };

  let m = path.match(/^\/category\/([^/]+)$/);
  if (m) return { name: "category", slug: decodeURIComponent(m[1]) };

  m = path.match(/^\/articles\/([^/]+)$/);
  if (m) return { name: "article", slug: decodeURIComponent(m[1]) };

  m = path.match(/^\/edit\/([^/]+)$/);
  if (m) return { name: "edit", slug: decodeURIComponent(m[1]) };

  return { name: "notfound" };
}

function currentRouteName() {
  return parseRoute().name;
}

function navigate(path, replace = false) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  render();
}

// ---------- Навигация и шапка ----------

function renderHeader() {
  const box = $("#header-actions");
  const themeBtn = `<button class="icon-btn" data-action="toggle-theme" title="Переключить тему" aria-label="Переключить тему">${state.theme === "dark" ? "☀️" : "🌙"}</button>`;
  if (state.user) {
    box.innerHTML = `
      ${state.user.role === "admin" ? '<a class="icon-btn" href="/admin" data-link title="Админка">⚙️</a>' : ""}
      <a class="icon-btn" href="/profile" data-link title="Профиль">👤</a>
      ${themeBtn}`;
  } else {
    box.innerHTML = themeBtn;
  }
}

function renderNav(routeName) {
  const nav = $("#main-nav");
  // Пока пользователь не авторизован, показываем только страницу входа.
  if (!state.user) {
    nav.innerHTML = "";
    return;
  }
  const items = [
    { href: "/", label: "Главная", ico: "🏠", key: "home" },
    { href: "/search", label: "Поиск", ico: "🔍", key: "search" },
    { href: "/profile", label: "Профиль", ico: "👤", key: "profile" },
  ];
  if (state.user && state.user.role === "admin") {
    items.push({ href: "/admin", label: "Админ", ico: "⚙️", key: "admin" });
  }
  nav.innerHTML = items
    .map(
      (it) =>
        `<a href="${it.href}" data-link class="${routeName === it.key ? "active" : ""}">
          <span class="nav-ico">${it.ico}</span>${it.label}
        </a>`
    )
    .join("");
}

// ---------- Рендер страниц ----------

async function render() {
  const route = parseRoute();
  const app = $("#app");
  renderHeader();
  renderNav(route.name);

  if (state.user && route.name === "login") {
    navigate("/", true);
    return;
  }

  if (!state.user && route.name !== "login") {
    renderLogin();
    return;
  }

  try {
    switch (route.name) {
      case "home":
        await renderHome();
        break;
      case "category":
        await renderCategory(route.slug);
        break;
      case "article":
        await renderArticle(route.slug);
        break;
      case "search":
        await renderSearch(route.q);
        break;
      case "profile":
        renderProfile();
        break;
      case "admin":
        await renderAdmin();
        break;
      case "new":
        await renderEditor(null);
        break;
      case "edit":
        await renderEditor(route.slug);
        break;
      case "login":
        renderLogin();
        break;
      default:
        app.innerHTML = `<div class="empty">Страница не найдена. <a href="/" data-link>На главную</a></div>`;
    }
  } catch (err) {
    if (!err.unauthorized) {
      app.innerHTML = `<div class="empty">Не удалось загрузить страницу: ${escapeHtml(err.message)}</div>`;
    }
  }
}

async function renderHome() {
  const [categories, articles] = await Promise.all([api("/api/categories"), api("/api/articles")]);
  const recent = articles.slice(0, 8);

  const catHtml =
    categories.length === 0
      ? `<div class="empty">Разделов пока нет.</div>`
      : `<div class="category-grid${state.catView === "list" ? " is-list" : ""}">
          ${categories
            .map(
              (c) => `<a class="category-card" href="/category/${encodeURIComponent(c.slug)}" data-link>
                <span class="cat-name">${escapeHtml(c.name)}</span>
                <span class="cat-count">${c.article_count} ${plural(c.article_count, "статья", "статьи", "статей")}</span>
              </a>`
            )
            .join("")}
        </div>`;

  const recentHtml = recent.length
    ? `<div class="article-list">
        ${recent
          .map(
            (a) => `<a class="article-item" href="/articles/${encodeURIComponent(a.slug)}" data-link>
              <span class="a-title">${escapeHtml(a.title)}</span>
              <span class="a-meta">${escapeHtml(a.category_name || "Без раздела")} · ${formatDate(a.updated_at)}</span>
            </a>`
          )
          .join("")}
      </div>`
    : `<div class="empty">Статей пока нет.</div>`;

  $("#app").innerHTML = `
    <div class="screen">
      <div>
        <h1 class="page-title">База знаний</h1>
        <p class="page-subtitle">Самогон, вино, пиво и домашние напитки</p>
      </div>

      <form class="search-input-wrap" action="/search" method="get" data-action="search">
        <span class="search-ico">🔍</span>
        <input type="search" name="q" placeholder="Поиск по статьям…" autocomplete="off" />
      </form>

      ${state.user && state.user.role === "admin"
        ? `<a class="btn btn-primary" href="/new" data-link>+ Новая статья</a>`
        : ""}

      <div>
        <div class="section-head">
          <h2 class="section-title">Разделы</h2>
          <div class="view-toggle" role="group" aria-label="Вид разделов">
            <button class="view-btn${state.catView === "grid" ? " active" : ""}" data-action="set-cat-view" data-view="grid" title="Плитки" aria-pressed="${state.catView === "grid"}">▦</button>
            <button class="view-btn${state.catView === "list" ? " active" : ""}" data-action="set-cat-view" data-view="list" title="Список" aria-pressed="${state.catView === "list"}">☰</button>
          </div>
        </div>
        ${catHtml}
      </div>

      <div>
        <h2 class="section-title">Последние статьи</h2>
        ${recentHtml}
      </div>
    </div>`;
}

async function renderCategory(slug) {
  const categories = await api("/api/categories");
  const cat = categories.find((c) => c.slug === slug);
  const articles = await api(`/api/articles?category=${encodeURIComponent(slug)}`);
  if (!cat) {
    $("#app").innerHTML = `<div class="empty">Раздел не найден. <a href="/" data-link>На главную</a></div>`;
    return;
  }
  $("#app").innerHTML = `
    <div class="screen">
      <div>
        <a href="/" data-link class="btn btn-ghost btn-sm">← Все разделы</a>
        <h1 class="page-title">${escapeHtml(cat.name)}</h1>
        <p class="page-subtitle">${articles.length} ${plural(articles.length, "статья", "статьи", "статей")}</p>
      </div>
      ${articles.length
        ? `<div class="article-list">
            ${articles
              .map(
                (a) => `<a class="article-item" href="/articles/${encodeURIComponent(a.slug)}" data-link>
                  <span class="a-title">${escapeHtml(a.title)}</span>
                  <span class="a-meta">${formatDate(a.updated_at)}</span>
                </a>`
              )
              .join("")}
          </div>`
        : `<div class="empty">В этом разделе пока нет статей.</div>`}
    </div>`;
}

async function renderArticle(slug) {
  const article = await api(`/api/articles/${encodeURIComponent(slug)}`);
  const admin = state.user && state.user.role === "admin";
  $("#app").innerHTML = `
    <article class="article-view">
      <div>
        <a href="/" data-link class="btn btn-ghost btn-sm">← Назад</a>
        <h1 class="title">${escapeHtml(article.title)}</h1>
        <div class="article-meta">
          ${article.category_name
            ? `<a href="/category/${encodeURIComponent(article.category_slug)}" data-link>${escapeHtml(article.category_name)}</a>`
            : `<span>Без раздела</span>`}
          <span>Обновлено: ${formatDate(article.updated_at)}</span>
          ${article.author_name ? `<span>Автор: ${escapeHtml(article.author_name)}</span>` : ""}
        </div>
      </div>

      ${admin
        ? `<div class="article-toolbar">
            <a class="btn btn-sm" href="/edit/${encodeURIComponent(article.slug)}" data-link>Изменить</a>
            <button class="btn btn-sm btn-danger" data-action="delete-article" data-id="${article.id}" data-title="${escapeHtml(article.title)}">Удалить</button>
          </div>`
        : ""}

      <div class="article-content">${renderMarkdown(article.content)}</div>
    </article>`;
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

async function renderSearch(q) {
  let resultsHtml = "";
  const query = (q || "").trim();
  if (query) {
    const results = await api(`/api/search?q=${encodeURIComponent(query)}`);
    resultsHtml = results.length
      ? `<div class="article-list">
          ${results
            .map(
              (a) => `<a class="article-item" href="/articles/${encodeURIComponent(a.slug)}" data-link>
                <span class="a-title">${escapeHtml(a.title)}</span>
                <span class="a-meta">${escapeHtml(a.category_name || "Без раздела")}</span>
              </a>`
            )
            .join("")}
        </div>`
      : `<div class="empty">Ничего не найдено.</div>`;
  }

  $("#app").innerHTML = `
    <div class="screen">
      <h1 class="page-title">Поиск</h1>
      <form class="search-input-wrap" action="/search" method="get" data-action="search">
        <span class="search-ico">🔍</span>
        <input type="search" name="q" value="${escapeHtml(q)}" placeholder="Что искать?…" autocomplete="off" autofocus />
      </form>
      ${query ? resultsHtml : `<div class="empty">Введите запрос, чтобы найти статьи.</div>`}
    </div>`;
}

function renderLogin() {
  $("#app").innerHTML = `
    <div class="login-card">
      <div class="login-brand">🌙 MoonshineWiki</div>
      <p class="login-hint">Войдите, чтобы продолжить.</p>
      <form data-action="login" class="form">
        <div class="form-error" id="login-error" hidden></div>
        <div class="field"><label>Логин</label><input name="username" required autocomplete="username" /></div>
        <div class="field"><label>Пароль</label><input name="password" type="password" required autocomplete="current-password" /></div>
        <button class="btn btn-primary btn-block" type="submit">Войти</button>
      </form>
    </div>`;
}

function renderProfile() {
  const u = state.user;
  $("#app").innerHTML = `
    <div class="screen">
      <h1 class="page-title">Профиль</h1>
      <div class="article-content">
        <p><strong>Логин:</strong> ${escapeHtml(u.username)}</p>
        <p><strong>Роль:</strong> ${u.role === "admin" ? "Администратор" : "Пользователь"}</p>
        <p><strong>Создан:</strong> ${formatDate(u.created_at)}</p>
      </div>
      ${u.role === "admin" ? `<a class="btn" href="/admin" data-link>Админка</a>` : ""}
      <button class="btn btn-danger" data-action="logout">Выйти</button>
    </div>`;
}

async function renderAdmin() {
  const [users, articles] = await Promise.all([api("/api/users"), api("/api/articles")]);

  const usersHtml = users.length
    ? `<div class="user-list">
        ${users
          .map(
            (u) => `<div class="user-item">
              <div class="u-info">
                <span class="u-name">${escapeHtml(u.username)} <span class="badge ${u.role === "admin" ? "badge-admin" : "badge-user"}">${u.role === "admin" ? "админ" : "пользователь"}</span></span>
                <span class="u-meta">Создан: ${formatDate(u.created_at)}</span>
              </div>
              <div class="user-actions">
                <button class="btn btn-sm" data-action="edit-user" data-id="${u.id}" data-username="${escapeHtml(u.username)}" data-role="${u.role}">Изменить</button>
                <button class="btn btn-sm btn-danger" data-action="delete-user" data-id="${u.id}" data-username="${escapeHtml(u.username)}">Удалить</button>
              </div>
            </div>`
          )
          .join("")}
      </div>`
    : `<div class="empty">Пользователей нет.</div>`;

  const articlesHtml = articles.length
    ? `<div class="article-list">
        ${articles
          .map(
            (a) => `<div class="user-item">
              <div class="u-info">
                <a class="u-name" href="/articles/${encodeURIComponent(a.slug)}" data-link>${escapeHtml(a.title)}</a>
                <span class="u-meta">${escapeHtml(a.category_name || "Без раздела")}</span>
              </div>
              <div class="user-actions">
                <a class="btn btn-sm" href="/edit/${encodeURIComponent(a.slug)}" data-link>Изменить</a>
                <button class="btn btn-sm btn-danger" data-action="delete-article" data-id="${a.id}" data-title="${escapeHtml(a.title)}">Удалить</button>
              </div>
            </div>`
          )
          .join("")}
      </div>`
    : `<div class="empty">Статей нет.</div>`;

  $("#app").innerHTML = `
    <div class="screen">
      <h1 class="page-title">Админка</h1>

      <div>
        <h2 class="section-title">Пользователи</h2>
        ${usersHtml}
      </div>

      <form data-action="save-user" class="form" style="background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px;">
        <h2 class="section-title" id="user-form-title">Новый пользователь</h2>
        <input type="hidden" name="id" id="user-id" value="" />
        <div class="field"><label>Логин</label><input name="username" id="user-username" required /></div>
        <div class="field"><label>Пароль <span class="hint">(при редактировании оставьте пустым, чтобы не менять)</span></label><input name="password" type="password" id="user-password" /></div>
        <div class="field"><label>Роль</label><select name="role" id="user-role">
          <option value="user">Пользователь</option>
          <option value="admin">Администратор</option>
        </select></div>
        <div class="field" style="flex-direction: row;">
          <button class="btn btn-primary" type="submit">Сохранить</button>
          <button class="btn" type="button" data-action="reset-user-form">Сбросить</button>
        </div>
      </form>

      <div>
        <h2 class="section-title">Статьи</h2>
        <a class="btn btn-primary" href="/new" data-link>+ Новая статья</a>
        <div style="margin-top: 10px;">${articlesHtml}</div>
      </div>
    </div>`;
}

function toolbarButtons() {
  const cmds = [
    ["bold", "B"],
    ["italic", "I"],
    ["h2", "H2"],
    ["h3", "H3"],
    ["ul", "• Список"],
    ["ol", "1. Список"],
    ["quote", "❝ Цитата"],
    ["link", "Ссылка"],
    ["code", "Код"],
  ];
  return cmds
    .map(([cmd, label]) => `<button type="button" data-action="format" data-cmd="${cmd}">${label}</button>`)
    .join("");
}

async function renderEditor(slug) {
  const categories = await api("/api/categories");
  let article = { id: "", title: "", content: "", category_id: "" };
  if (slug) {
    article = await api(`/api/articles/${encodeURIComponent(slug)}`);
  }
  const catOptions = categories
    .map(
      (c) =>
        `<option value="${c.id}" ${String(c.id) === String(article.category_id) ? "selected" : ""}>${escapeHtml(c.name)}</option>`
    )
    .join("");

  $("#app").innerHTML = `
    <div class="screen">
      <h1 class="page-title">${slug ? "Редактирование статьи" : "Новая статья"}</h1>
      <form data-action="save-article" class="editor">
        <input type="hidden" name="id" value="${article.id}" />
        <div class="field"><label>Заголовок</label><input name="title" value="${escapeHtml(article.title)}" required /></div>
        <div class="field"><label>Раздел</label><select name="category_id"><option value="">— Без раздела —</option>${catOptions}</select></div>
        <div class="field">
          <label>Содержимое (Markdown)</label>
          <div class="editor-toolbar">${toolbarButtons()}</div>
          <div class="preview-toggle">
            <button type="button" class="active" data-action="preview-mode" data-mode="edit">Редактор</button>
            <button type="button" data-action="preview-mode" data-mode="preview">Просмотр</button>
          </div>
          <textarea class="editor-textarea" name="content" id="editor-content">${escapeHtml(article.content)}</textarea>
          <div class="preview article-content" id="editor-preview" hidden></div>
        </div>
        <div class="field" style="flex-direction: row;">
          <button class="btn btn-primary" type="submit">Сохранить</button>
          <a class="btn" href="${slug ? `/articles/${encodeURIComponent(slug)}` : "/"}" data-link>Отмена</a>
        </div>
      </form>
    </div>`;
}

// ---------- Форматирование текста в редакторе ----------

function updatePreview() {
  const prev = document.getElementById("editor-preview");
  const ta = document.getElementById("editor-content");
  if (prev && ta && !prev.hidden) {
    prev.innerHTML = renderMarkdown(ta.value);
  }
}

function setPreviewMode(mode) {
  const ta = document.getElementById("editor-content");
  const prev = document.getElementById("editor-preview");
  if (!ta || !prev) return;
  if (mode === "preview") {
    prev.hidden = false;
    ta.hidden = true;
    prev.innerHTML = renderMarkdown(ta.value);
  } else {
    prev.hidden = true;
    ta.hidden = false;
  }
  document.querySelectorAll("[data-action='preview-mode']").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
}

function formatTextarea(cmd) {
  const ta = document.getElementById("editor-content");
  if (!ta) return;
  const value = ta.value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = value.slice(start, end);

  let before = "";
  let after = "";
  let placeholder = "";
  let lineMode = false;

  switch (cmd) {
    case "bold": before = "**"; after = "**"; placeholder = "жирный"; break;
    case "italic": before = "*"; after = "*"; placeholder = "курсив"; break;
    case "code": before = "`"; after = "`"; placeholder = "код"; break;
    case "link": before = "["; after = "](https://)"; placeholder = "текст"; break;
    case "h2": before = "## "; placeholder = "Заголовок"; lineMode = true; break;
    case "h3": before = "### "; placeholder = "Заголовок"; lineMode = true; break;
    case "ul": before = "- "; placeholder = "пункт"; lineMode = true; break;
    case "ol": before = "1. "; placeholder = "пункт"; lineMode = true; break;
    case "quote": before = "> "; placeholder = "цитата"; lineMode = true; break;
    default: return;
  }

  let newValue;
  let selStart;
  let selEnd;

  if (lineMode) {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = value.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.slice(lineStart, lineEnd);
    const text = sel || block;
    const prefixed = text.split("\n").map((l) => before + l).join("\n");
    newValue = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
    selStart = lineStart;
    selEnd = lineStart + prefixed.length;
  } else {
    const text = sel || placeholder;
    const replacement = before + text + after;
    newValue = value.slice(0, start) + replacement + value.slice(end);
    selStart = start + before.length;
    selEnd = selStart + text.length;
  }

  ta.value = newValue;
  ta.focus();
  ta.setSelectionRange(selStart, selEnd);
  updatePreview();
}

// ---------- Обработчики действий ----------

async function handleAction(el) {
  const action = el.dataset.action;
  switch (action) {
    case "toggle-theme": {
      state.theme = state.theme === "dark" ? "light" : "dark";
      writeLS("wiki-theme", state.theme);
      applyTheme();
      renderHeader();
      break;
    }
    case "set-cat-view": {
      state.catView = el.dataset.view || "grid";
      writeLS("wiki-catview", state.catView);
      renderHome();
      break;
    }
    case "logout": {
      await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
      state.user = null;
      renderHeader();
      renderNav("login");
      navigate("/login", true);
      break;
    }
    case "delete-article": {
      if (!confirm(`Удалить статью «${el.dataset.title}»?`)) return;
      try {
        await api(`/api/articles/${el.dataset.id}`, { method: "DELETE" });
        toast("Статья удалена");
        render();
      } catch (e) {
        toast(e.message);
      }
      break;
    }
    case "delete-user": {
      if (!confirm(`Удалить пользователя «${el.dataset.username}»?`)) return;
      try {
        await api(`/api/users/${el.dataset.id}`, { method: "DELETE" });
        toast("Пользователь удалён");
        renderAdmin();
      } catch (e) {
        toast(e.message);
      }
      break;
    }
    case "edit-user": {
      document.getElementById("user-id").value = el.dataset.id;
      document.getElementById("user-username").value = el.dataset.username;
      document.getElementById("user-role").value = el.dataset.role;
      document.getElementById("user-password").value = "";
      document.getElementById("user-form-title").textContent = `Редактирование: ${el.dataset.username}`;
      break;
    }
    case "reset-user-form": {
      document.getElementById("user-id").value = "";
      document.getElementById("user-username").value = "";
      document.getElementById("user-password").value = "";
      document.getElementById("user-role").value = "user";
      document.getElementById("user-form-title").textContent = "Новый пользователь";
      break;
    }
    case "preview-mode": {
      setPreviewMode(el.dataset.mode);
      break;
    }
    case "format": {
      formatTextarea(el.dataset.cmd);
      break;
    }
  }
}

async function handleForm(form) {
  const action = form.dataset.action;
  switch (action) {
    case "search": {
      const q = (form.elements.q.value || "").trim();
      navigate(`/search?q=${encodeURIComponent(q)}`);
      break;
    }
    case "login": {
      const username = form.elements.username.value.trim();
      const password = form.elements.password.value;
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = document.getElementById("login-error");
          err.textContent = data.error || "Ошибка входа";
          err.hidden = false;
          return;
        }
        state.user = data;
        navigate("/", true);
      } catch (e) {
        toast(e.message);
      }
      break;
    }
    case "save-user": {
      const id = form.elements.id.value;
      const username = form.elements.username.value.trim();
      const password = form.elements.password.value;
      const role = form.elements.role.value;
      if (!id && !password) {
        toast("Укажите пароль для нового пользователя");
        return;
      }
      try {
        if (id) {
          const body = { username, role };
          if (password) body.password = password;
          await api(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(body) });
          toast("Пользователь обновлён");
        } else {
          await api("/api/users", { method: "POST", body: JSON.stringify({ username, password, role }) });
          toast("Пользователь создан");
        }
        renderAdmin();
      } catch (e) {
        toast(e.message);
      }
      break;
    }
    case "save-article": {
      const id = form.elements.id.value;
      const title = form.elements.title.value.trim();
      const category_id = form.elements.category_id.value;
      const content = form.elements.content.value;
      try {
        let slug;
        if (id) {
          const res = await api(`/api/articles/${id}`, {
            method: "PUT",
            body: JSON.stringify({ title, category_id: category_id || null, content }),
          });
          slug = res.slug;
        } else {
          const res = await api("/api/articles", {
            method: "POST",
            body: JSON.stringify({ title, category_id: category_id || null, content }),
          });
          slug = res.slug;
        }
        toast("Сохранено");
        navigate(`/articles/${encodeURIComponent(slug)}`);
      } catch (e) {
        toast(e.message);
      }
      break;
    }
  }
}

// ---------- Инициализация ----------

async function loadMe() {
  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    if (res.ok) state.user = await res.json();
    else state.user = null;
  } catch (e) {
    state.user = null;
  }
}

function bindEvents() {
  document.addEventListener("click", (e) => {
    const actionEl = e.target.closest("[data-action]");
    // Не перехватываем клик по submit-кнопкам внутри форм с data-action:
    // иначе form.submit не сработает. Отправка формы обрабатывается в
    // отдельном обработчике "submit".
    if (actionEl && actionEl.tagName !== "FORM") {
      e.preventDefault();
      handleAction(actionEl);
      return;
    }
    const link = e.target.closest("a[href]");
    if (link) {
      const href = link.getAttribute("href");
      if (href && href.startsWith("/")) {
        e.preventDefault();
        navigate(href);
      }
    }
  });

  document.addEventListener("submit", (e) => {
    const form = e.target.closest("form[data-action]");
    if (form) {
      e.preventDefault();
      handleForm(form);
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target && e.target.id === "editor-content") {
      updatePreview();
    }
  });

  window.addEventListener("popstate", render);
}

function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

async function init() {
  applyTheme();
  bindEvents();
  renderHeader();
  renderNav(parseRoute().name);
  await loadMe();
  render();
  registerSW();
}

document.addEventListener("DOMContentLoaded", init);





