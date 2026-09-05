#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=============================================="
echo "  Установка MoonshineWiki"
echo "=============================================="
echo

DEFAULT_PORT=3000
DEFAULT_USER=admin

# Если .env уже существует — берём из него порт и логин как значения по умолчанию.
if [ -f .env ]; then
  echo "Найден .env — его порт и логин будут значениями по умолчанию."
  DEFAULT_PORT=$(grep -E '^APP_PORT=' .env | tail -n1 | cut -d= -f2- | tr -d '"')
  DEFAULT_USER=$(grep -E '^ADMIN_USERNAME=' .env | tail -n1 | cut -d= -f2- | tr -d '"')
fi
DEFAULT_PORT=${DEFAULT_PORT:-3000}
DEFAULT_USER=${DEFAULT_USER:-admin}

port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    # -H убирает строку-заголовок, иначе grep всегда находит её и порт кажется занятым.
    ss -ltnH "sport = :$1" | grep -q .
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
  else
    return 1
  fi
}

# --- Порт ---
while true; do
  read -r -p "Порт для приложения [${DEFAULT_PORT}]: " APP_PORT
  APP_PORT=${APP_PORT:-${DEFAULT_PORT}}
  if ! [[ "$APP_PORT" =~ ^[0-9]+$ ]]; then
    echo "  Порт должен быть числом." >&2
    continue
  fi
  if port_in_use "$APP_PORT"; then
    echo "  Порт ${APP_PORT} уже занят. Выберите другой." >&2
    DEFAULT_PORT=$((APP_PORT + 1))
    continue
  fi
  break
done

# --- Логин администратора ---
read -r -p "Логин администратора [${DEFAULT_USER}]: " ADMIN_USERNAME
ADMIN_USERNAME=${ADMIN_USERNAME:-${DEFAULT_USER}}

# --- Пароль администратора ---
while true; do
  read -r -s -p "Пароль администратора (ввод скрыт): " ADMIN_PASSWORD
  echo
  if [ -z "$ADMIN_PASSWORD" ]; then
    echo "  Пароль не может быть пустым." >&2
    continue
  fi
  break
done

# --- Секрет сессий ---
if command -v openssl >/dev/null 2>&1; then
  SESSION_SECRET=$(openssl rand -hex 32)
else
  SESSION_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '=\n')
fi

# --- Записываем .env ---
cat > .env <<EOF
APP_PORT="${APP_PORT}"
ADMIN_USERNAME="${ADMIN_USERNAME}"
ADMIN_PASSWORD="${ADMIN_PASSWORD}"
SESSION_SECRET="${SESSION_SECRET}"
EOF
chmod 600 .env

echo
echo "Параметры сохранены в .env"
echo
echo "Запуск контейнера (docker compose up -d --build)..."
docker compose up -d --build

echo
echo "=============================================="
echo "  Готово!"
echo "  Адрес: http://localhost:${APP_PORT}"
echo "  Логин: ${ADMIN_USERNAME}"
echo "=============================================="
echo
echo "Логин и пароль применяются только при ПЕРВОМ запуске на пустой базе."
echo "Если администратор уже был создан ранее, эти значения не изменятся."
echo "Для полного сброса базы: docker compose down -v"
