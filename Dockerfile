FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/demo/package.json apps/demo/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/widget/package.json packages/widget/package.json
COPY packages/email/package.json packages/email/package.json
RUN npm ci
COPY . .
RUN npm run db:generate
ENV COMMUNITY_WEB_BUILD=true
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM caddy:2.10.2-alpine AS gateway
FROM postgres:17-bookworm AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends supervisor tini ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 node && useradd --uid 1000 --gid node --create-home node
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=gateway /usr/bin/caddy /usr/local/bin/caddy
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/admin/dist ./apps/admin/dist
COPY --from=build /app/apps/demo/dist ./apps/demo/dist
COPY --from=build /app/packages/widget/dist ./packages/widget/dist
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/email ./packages/email
COPY deploy ./deploy
COPY deploy/supervisord.conf /etc/supervisor/supervisord.conf
COPY LICENSE NOTICE ./
COPY docs/LICENSING.md ./docs/LICENSING.md
RUN chmod +x deploy/entrypoint deploy/run-service deploy/database \
    && ln -s /var/lib/postgresql/data /data \
    && mkdir -p /data/uploads /data/postgres /data/caddy /run/tracegenie \
    && chown node:node /data/uploads /data/caddy
ENV NODE_ENV=production SERVE_WEB=true API_HOST=127.0.0.1 API_PORT=4310 \
    PGDATA=/data/postgres POSTGRES_USER=community POSTGRES_DB=community \
    STORAGE_LOCAL_ROOT=/data/uploads XDG_DATA_HOME=/data/caddy/data XDG_CONFIG_HOME=/data/caddy/config
LABEL org.tracegenie.packaging="single-container-v1"
STOPSIGNAL SIGTERM
EXPOSE 8080 8443
HEALTHCHECK --interval=5s --timeout=10s --start-period=60s --retries=12 CMD ["node", "/app/deploy/healthcheck.mjs"]
ENTRYPOINT ["/usr/bin/tini", "--", "/app/deploy/entrypoint"]
CMD ["serve"]
