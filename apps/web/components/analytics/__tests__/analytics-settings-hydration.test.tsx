import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AnalyticsPrivacyPage from '@/app/legal/analytics/page';

vi.mock('next-intl', () => ({ useLocale: () => 'ko' }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: () => new Promise(() => {}) } }));
vi.mock('@/stores/use-auth-store', () => ({ useAuthStore: (select: (state: { user: null }) => unknown) => select({ user: null }) }));

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('analytics settings hydration with a cache populated by a provider', () => {
  it.each(['first-party', 'google'])('keeps the server snapshot when %s config arrives before the page hydrates', async (source) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const server = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const render = (queryClient: QueryClient) => <QueryClientProvider client={queryClient}><AnalyticsPrivacyPage /></QueryClientProvider>;
    const container = document.createElement('div');
    container.innerHTML = renderToString(render(server)); document.body.append(container);
    // Layout providers fetch shared config independently of this streamed page.
    // It can already be cached when React first hydrates the page boundary.
    if (source === 'first-party') client.setQueryData(['analytics', 'config'], { enabled: true, aggregateEnabled: true });
    else client.setQueryData(['audience', 'ga4-config'], { enabled: true, measurementId: 'G-TESTABCD', noticeVersion: 'google-interests-v2', transferCountries: ['US'] });
    const errors: string[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(container, render(client), { onRecoverableError: (error) => errors.push(String(error)) }); });
      expect(errors).toEqual([]);
      expect(container.textContent).toContain(source === 'google' ? '미국' : '이 브라우저의 횟수 집계가');
    } finally {
      await act(async () => { root?.unmount(); });
      server.clear(); client.clear(); container.remove();
    }
  });
});
