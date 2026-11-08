# syntax=docker/dockerfile:1
# Node 22 matches CI. Build and runtime share the same OS family for native deps.
FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS build
ENV HUSKY=0
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY nest-cli.json tsconfig.json tsconfig.build.json prisma7.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npm run db:generate && npm run build

# The migration stage carries Prisma CLI and migration files, unlike runtime.
FROM build AS migrate
ENV NODE_ENV=production
USER node
CMD ["./node_modules/.bin/prisma", "migrate", "deploy", "--config", "prisma7.config.ts"]

# Install native binaries while all dependencies exist; prune dev-only packages
# after compilation, without re-running dependency lifecycle scripts.
FROM build AS production-deps
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    AVATAR_STORAGE_DIR=/app/uploads/avatars

COPY package.json ./
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/uploads/avatars && chown -R node:node /app/uploads
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM

# No curl/wget needed. Readiness returns 503 when PostgreSQL is unavailable.
HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "const c=new AbortController();setTimeout(()=>c.abort(),3000).unref();fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/ready',{signal:c.signal}).then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))"

CMD ["node", "dist/main.js"]
