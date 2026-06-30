# syntax=docker/dockerfile:1.6

# ── Stage 1: install deps + build the Vite bundle ───────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies first so this layer is cached across source-only edits.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# Copy the rest of the source and produce dist/.
COPY . .
RUN npm run build

# ── Stage 2: production runtime (only what server.js needs) ─────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Reuse the build stage's already-installed node_modules and prune to prod-only.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
RUN --mount=type=cache,target=/root/.npm \
    npm prune --omit=dev

# Server code + built static assets.
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/dracoCompress.mjs ./dracoCompress.mjs
COPY --from=build /app/dist ./dist

EXPOSE 8080
CMD ["node", "server.js"]
