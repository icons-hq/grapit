FROM node:22-alpine AS dependencies
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm --filter @grabit/api... install --frozen-lockfile

FROM dependencies AS builder
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
RUN pnpm --filter @grabit/shared build
COPY apps/api apps/api
RUN pnpm --filter @grabit/api build
RUN pnpm --filter @grabit/api deploy --prod --legacy /deploy

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /deploy/node_modules ./node_modules
COPY --from=builder /deploy/package.json ./package.json
RUN mkdir -p /app/phase26
COPY .planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json /app/phase26/26-GATE-LEDGER.json
USER nestjs
EXPOSE 8080
ENV PORT=8080
CMD ["node", "dist/main.js"]
