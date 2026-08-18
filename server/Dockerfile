FROM node:22-slim AS builder

WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
COPY src/ src/
RUN npm ci && npx tsc

FROM node:22-slim

RUN apt-get update && apt-get install -y dumb-init && rm -rf /var/lib/apt/lists/*

RUN adduser --disabled-password --gecos "" mcpuser

WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /build/server/dist/ dist/

ENV NODE_ENV=production
ENV CAPACITIES_API_BASE_URL=https://api.capacities.io
ENV LOG_LEVEL=info

USER mcpuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD pgrep -f "node.*index.js" || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
