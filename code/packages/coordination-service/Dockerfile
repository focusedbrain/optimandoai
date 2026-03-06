# Production Docker image for wrdesk.com Coordination Service
# Build from code/ directory: pnpm exec docker build -t wrdesk/coordination-service:latest -f packages/coordination-service/Dockerfile .

FROM node:20-slim AS builder
WORKDIR /build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ingestion-core/ packages/ingestion-core/
COPY packages/coordination-service/ packages/coordination-service/

RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @repo/ingestion-core build \
  && pnpm --filter @repo/coordination-service build

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -r beap && useradd -r -g beap -d /app -s /sbin/nologin beap

WORKDIR /app

COPY --from=builder /build/package.json /build/pnpm-lock.yaml /build/pnpm-workspace.yaml ./
COPY --from=builder /build/packages/ packages/
COPY --from=builder /build/node_modules/ node_modules/

RUN mkdir -p /data && chown -R beap:beap /data
VOLUME ["/data"]

ENV COORD_PORT=8443
ENV COORD_HOST=0.0.0.0
ENV COORD_DB_PATH=/data/coordination.db

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "const p=process.env.COORD_PORT||8443;fetch('http://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 8443

USER beap

ENTRYPOINT ["tini", "--"]
CMD ["node", "packages/coordination-service/dist/index.js"]
