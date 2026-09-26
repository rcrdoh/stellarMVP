FROM oven/bun:1.4.0-slim AS runtime

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY config ./config
COPY public ./public
COPY specs ./specs
COPY src ./src

ENV APP_ENV=prod \
    HOST=0.0.0.0 \
    PORT=3000 \
    CONFIG_FILE=config/settings.toml

EXPOSE 3000

CMD ["bun", "run", "start"]
