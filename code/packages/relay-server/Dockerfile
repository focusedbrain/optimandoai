# Production Docker image for BEAP Relay Server
# Build from code/ directory: docker build -t wrdesk/beap-relay:latest -f packages/relay-server/Dockerfile .

# ── Build stage ──
FROM node:20-slim AS builder
WORKDIR /build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ingestion-core/ packages/ingestion-core/
COPY packages/relay-server/ packages/relay-server/

RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @repo/ingestion-core build \
  && pnpm --filter @repo/relay-server build

# ── Production stage ──
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    && rm -rf /var/lib/apt/lists/*

# Security: non-root user
RUN groupadd -r beap && useradd -r -g beap -d /app -s /sbin/nologin beap

WORKDIR /app

# Copy built artifacts from builder (preserve workspace structure for module resolution)
COPY --from=builder /build/package.json /build/pnpm-lock.yaml /build/pnpm-workspace.yaml ./
COPY --from=builder /build/packages/ packages/
COPY --from=builder /build/node_modules/ node_modules/

# Data directory for SQLite and TLS certs
RUN mkdir -p /data/certs && chown -R beap:beap /data
VOLUME ["/data"]

# Default config (override via env)
ENV RELAY_PORT=51249
ENV RELAY_BIND_ADDRESS=0.0.0.0
ENV RELAY_DB_PATH=/data/relay.db
ENV RELAY_TLS_CERT_PATH=/data/certs/cert.pem
ENV RELAY_TLS_KEY_PATH=/data/certs/key.pem
ENV RELAY_MAX_CAPSULE_AGE_DAYS=7

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "const p=process.env.RELAY_PORT||51249;fetch('http://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 51249

USER beap

ENTRYPOINT ["tini", "--"]
CMD ["node", "packages/relay-server/dist/index.js"]
