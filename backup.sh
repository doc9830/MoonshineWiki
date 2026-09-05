#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "▶ Экспорт данных из базы в data/export/data.json..."

mkdir -p data/export

# Если контейнер запущен — экспортируем через него (не требует Node на хосте).
if docker compose ps -q app >/dev/null 2>&1; then
  docker compose exec -T app node scripts/export-data.js > data/export/data.json
else
  # Иначе — локально, если установлены зависимости.
  node scripts/export-data.js > data/export/data.json
fi

echo "▶ Фиксируем изменения в git..."
git add data/export/data.json

if git diff --cached --quiet; then
  echo "✔ Изменений нет — выгружать нечего."
  exit 0
fi

git commit -m "Данные: автосохранение $(date '+%Y-%m-%d %H:%M:%S')"
git push
echo "✔ Данные выгружены в GitHub."
