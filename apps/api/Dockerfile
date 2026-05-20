# Stage 1: Build
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @grabit/shared build
RUN pnpm --filter @grabit/api build
RUN pnpm --filter @grabit/api deploy --prod --legacy /deploy

# Stage 2: Production
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /deploy/node_modules ./node_modules
COPY --from=builder /deploy/package.json ./package.json
RUN mkdir -p /app/phase26
COPY --from=builder /app/.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json /app/phase26/26-GATE-LEDGER.json
USER nestjs
EXPOSE 8080
ENV PORT=8080
CMD ["node", "dist/main.js"]
