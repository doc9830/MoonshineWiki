# --- Сборочная стадия: компилируем нативный better-sqlite3 ---
FROM node:22-slim AS build

WORKDIR /app

# Инструменты для node-gyp (без них better-sqlite3 собирается из исходников).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Слой зависимостей кэшируется, пока не меняются package*.json.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Итоговый образ: только рантайм ---
FROM node:22-slim

WORKDIR /app

# libstdc++6 нужна собранному нативному модулю better-sqlite3.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/moonshine.db

COPY --from=build /app/node_modules ./node_modules
COPY . .

# SQLite хранится в /app/data — монтируется как volume (см. docker-compose.yml).
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "server.js"]
