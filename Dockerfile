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

FROM node:24.21.0-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4310 SERVE_WEB=true
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/admin/dist ./apps/admin/dist
COPY --from=build /app/apps/demo/dist ./apps/demo/dist
COPY --from=build /app/packages/widget/dist ./packages/widget/dist
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/email ./packages/email
COPY --from=build /app/deploy ./deploy
COPY LICENSE NOTICE ./
COPY docs/LICENSING.md ./docs/LICENSING.md
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 4310
CMD ["node", "apps/api/dist/server.js"]
