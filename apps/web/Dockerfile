FROM scratch AS previous-web-static

FROM node:22-alpine AS dependencies
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm --filter @grabit/web... install --frozen-lockfile

FROM dependencies AS builder
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
RUN pnpm --filter @grabit/shared build
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ANALYTICS_API_URL
ENV NEXT_PUBLIC_ANALYTICS_API_URL=$NEXT_PUBLIC_ANALYTICS_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_R2_HOSTNAME
ENV NEXT_PUBLIC_R2_HOSTNAME=$NEXT_PUBLIC_R2_HOSTNAME
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_TOSS_CLIENT_KEY
ENV NEXT_PUBLIC_TOSS_CLIENT_KEY=$NEXT_PUBLIC_TOSS_CLIENT_KEY
ARG NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY
ENV NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY=$NEXT_PUBLIC_TOSS_FOREIGN_EASY_PAY_CLIENT_KEY
ARG NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY
ARG NEXT_PUBLIC_TOSS_VIRTUAL_ACCOUNT_VARIANT_KEY
ENV NEXT_PUBLIC_TOSS_VIRTUAL_ACCOUNT_VARIANT_KEY=$NEXT_PUBLIC_TOSS_VIRTUAL_ACCOUNT_VARIANT_KEY
ENV NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY=$NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY
RUN pnpm --filter @grabit/web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=previous-web-static / ./apps/web/.next/static/
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
RUN mkdir -p /app/apps/web/.next/cache && \
    chown -R nextjs:nodejs /app/apps/web/.next/cache
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/web/server.js"]
