import type { NextConfig } from 'next';
import { loadEnvConfig } from '@next/env';
import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';
import { resolve } from 'path';

// Load .env from monorepo root (convention: single .env at monorepo root)
// Next.js only loads .env from its own project dir (apps/web/),
// so force-reload the repo root with Next's dotenv-compatible parser after
// Next's project-dir env pass has already run.
const monorepoRoot = resolve(__dirname, '../..');
const isDev = process.env.NODE_ENV !== 'production';
loadEnvConfig(monorepoRoot, isDev, console, true);

const r2Hostname = process.env.NEXT_PUBLIC_R2_HOSTNAME;

// WR-04: allowedDevOrigins 를 NEXT_DEV_ALLOWED_ORIGINS 환경변수로 분리.
// 이전에는 특정 개발자의 사설 IP(`192.168.0.78`) 및 ngrok 터널 도메인이
// 레포에 하드코딩되어 있어 다른 협업자가 매번 수정해야 했다.
// 빈 문자열은 필터링하며, 미설정이면 비어있는 배열을 전달한다.
const devOriginsEnv = process.env.NEXT_DEV_ALLOWED_ORIGINS ?? '';
const allowedDevOrigins = devOriginsEnv
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins,
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ['@grabit/shared'],
  turbopack: {
    root: monorepoRoot,
    rules: {
      '*.md': { as: '*.js', loaders: ['raw-loader'] },
      '*.md?raw': { as: '*.js', loaders: ['raw-loader'] },
    },
  },
  async rewrites() {
    if (process.env.NODE_ENV === 'production') {
      return [];
    }

    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8080/api/:path*',
      },
      {
        source: '/socket.io/:path*',
        destination: 'http://localhost:8080/socket.io/:path*',
      },
    ];
  },
  images: {
    unoptimized: process.env.NODE_ENV !== 'production',
    remotePatterns: [
      ...(r2Hostname
        ? [{ protocol: 'https' as const, hostname: r2Hostname }]
        : []),
    ],
  },
};

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
