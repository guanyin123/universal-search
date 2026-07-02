# syntax=docker/dockerfile:1

# ---- Build stage: install all deps and build the adapter-node server ----
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Runtime stage: production deps only + the built server ----
FROM node:24-slim AS runner
ENV NODE_ENV=production
# git is required at runtime: the "deposit to vault" feature auto-commits via simple-git.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev
COPY --from=builder /app/build ./build
# Runtime state: settings SQLite (.data) + per-run JSON artifacts (.runs).
# Mount these as volumes (see docker-compose.yml) to persist across restarts.
RUN mkdir -p /app/.data /app/.runs && chown -R node:node /app/.data /app/.runs
USER node
# adapter-node listens on PORT (default 3000) and HOST 0.0.0.0.
EXPOSE 3000
CMD ["node", "build"]
