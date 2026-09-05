"use strict";

// Транслитерация кириллицы в латиницу для понятных URL-адресов статей.
const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g",
};

// Превращает произвольный заголовок в slug: "Первая перегонка" -> "pervaya-peregonka".
function slugify(text) {
  const lower = String(text || "").toLowerCase();
  let out = "";
  for (const ch of lower) {
    if (ch >= "a" && ch <= "z") out += ch;
    else if (ch >= "0" && ch <= "9") out += ch;
    else if (TRANSLIT[ch]) out += TRANSLIT[ch];
    else if (ch === " " || ch === "-" || ch === "_") out += "-";
  }
  return out
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

module.exports = { slugify };
