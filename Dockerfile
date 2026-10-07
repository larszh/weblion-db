# syntax=docker/dockerfile:1.7
# One image serves the API and the built web console.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @weblion/web build \
 && pnpm --filter @weblion/api build \
 && pnpm --filter @weblion/api deploy --prod --legacy /out \
 && cp -r apps/web/dist /out/web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST_DIR=/app/web
WORKDIR /app
RUN addgroup -S weblion && adduser -S weblion -G weblion
COPY --from=build --chown=weblion:weblion /out/package.json ./package.json
COPY --from=build --chown=weblion:weblion /out/node_modules ./node_modules
COPY --from=build --chown=weblion:weblion /out/dist ./dist
COPY --from=build --chown=weblion:weblion /out/drizzle ./drizzle
COPY --from=build --chown=weblion:weblion /out/web ./web
USER weblion
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/readyz || exit 1
CMD ["node", "dist/index.js"]
