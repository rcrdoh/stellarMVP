# Single-container image for Render: Fastify API + React SPA (with `/v1/*`
# reverse proxy) run together via `scripts/start-all.ts`.
#
# The API binds an internal port (`API_PORT`, default 3000, localhost only) and
# the web server binds Render's injected `PORT`, proxying `/v1/*` to the API.
# Build context: repository root.
FROM oven/bun:1.4.0-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY config ./config
COPY specs ./specs
COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json tsconfig.build.json ./
RUN bun run build && rm -rf node_modules && bun install --frozen-lockfile --production

ENV NODE_ENV=production \
    APP_ENV=prod \
    HOST=0.0.0.0 \
    PORT=3000 \
    API_PORT=3000 \
    API_HOST=127.0.0.1 \
    CONFIG_FILE=config/settings.toml

EXPOSE 3000

CMD ["bun", "run", "start:all"]
