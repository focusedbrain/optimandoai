# Production Docker image for wrdesk.com Coordination Service
# Deterministic Node 22 build — native modules compile inside container.
# Build from repo root: podman build -t coordination-test -f packages/coordination-service/Dockerfile .

FROM node:22-bookworm-slim AS builder
WORKDIR /build

# Install build tools for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests first (no node_modules, no dist — .dockerignore excludes them)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ingestion-core/ packages/ingestion-core/
COPY packages/coordination-service/ packages/coordination-service/

# Install and build inside container — native modules compile for container Node ABI
RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @repo/ingestion-core build \
  && pnpm --filter @repo/coordination-service build

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -r beap && useradd -r -g beap -d /app -s /sbin/nologin beap

WORKDIR /app

COPY --from=builder /build/package.json /build/pnpm-lock.yaml /build/pnpm-workspace.yaml ./
COPY --from=builder /build/packages/ packages/
COPY --from=builder /build/node_modules/ node_modules/

RUN mkdir -p /data && chown -R beap:beap /data
VOLUME ["/data"]

ENV COORD_PORT=51249
ENV COORD_HOST=0.0.0.0
ENV COORD_DB_PATH=/data/coordination.db

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "const p=process.env.COORD_PORT||51249;fetch('http://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 51249

USER beap

ENTRYPOINT ["tini", "--"]
CMD ["node", "packages/coordination-service/dist/server.js"]
