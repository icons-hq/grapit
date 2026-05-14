import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/lib/api-client';
import {
  useCreateBanner,
  useDeleteBanner,
  useReorderBanners,
  useUpdateBanner,
} from '@/hooks/use-admin';
import { BannerForm } from '../banner-manager';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient = createQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  optionName: string,
) {
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole('option', { name: optionName }));
}

describe('BannerForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => false),
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  it('renders placement, device, schedule, status, image, link, and sort controls', () => {
    render(
      <BannerForm
        initialData={{
          imageUrl: 'https://r2.example.com/banners/current.jpg',
          linkUrl: 'https://www.heygrabit.com/performances/current',
          placement: 'operations_notice',
          deviceTarget: 'desktop',
          startsAt: '2026-05-15T00:00:00.000Z',
          endsAt: '2026-05-31T23:59:59.000Z',
          status: 'scheduled',
          sortOrder: 4,
          isActive: true,
        }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting={false}
      />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByAltText('배너 미리보기')).toBeInTheDocument();
    expect(screen.getByLabelText('링크 URL (선택)')).toHaveValue(
      'https://www.heygrabit.com/performances/current',
    );
    expect(screen.getByLabelText('배너 위치')).toBeInTheDocument();
    expect(screen.getByLabelText('기기 대상')).toBeInTheDocument();
    expect(screen.getByLabelText('배너 시작 시각')).toBeInTheDocument();
    expect(screen.getByLabelText('배너 종료 시각')).toBeInTheDocument();
    expect(screen.getByLabelText('배너 상태')).toBeInTheDocument();
    expect(screen.getByLabelText('순서')).toHaveValue(4);
  });

  it('keeps image upload and submits expanded banner fields', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uploadUrl: 'https://upload.example.com/banner',
      publicUrl: 'https://r2.example.com/banners/uploaded.jpg',
      key: 'banners/uploaded.jpg',
      mode: 'r2',
    });

    render(
      <BannerForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        isSubmitting={false}
      />,
      { wrapper: createWrapper() },
    );

    await user.upload(
      screen.getByLabelText('배너 이미지 파일'),
      new File(['banner'], 'banner.jpg', { type: 'image/jpeg' }),
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        'https://upload.example.com/banner',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      );
    });

    await user.type(
      screen.getByLabelText('링크 URL (선택)'),
      'https://www.heygrabit.com/performances/uploaded',
    );
    await chooseSelectOption(user, '배너 위치', '홈 보조');
    await chooseSelectOption(user, '기기 대상', '모바일');
    await user.type(screen.getByLabelText('배너 시작 시각'), '2026-05-15T09:00');
    await user.type(screen.getByLabelText('배너 종료 시각'), '2026-05-31T23:59');
    await chooseSelectOption(user, '배너 상태', '예약됨');
    await user.clear(screen.getByLabelText('순서'));
    await user.type(screen.getByLabelText('순서'), '3');

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: 'https://r2.example.com/banners/uploaded.jpg',
        linkUrl: 'https://www.heygrabit.com/performances/uploaded',
        placement: 'home_secondary',
        deviceTarget: 'mobile',
        startsAt: new Date('2026-05-15T09:00').toISOString(),
        endsAt: new Date('2026-05-31T23:59').toISOString(),
        status: 'scheduled',
        sortOrder: 3,
        isActive: true,
      }),
    );
  });
});

describe('banner admin hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates admin and public banner query families after mutations', async () => {
    (apiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'banner-created',
    });
    (apiClient.put as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'banner-updated',
    });
    (apiClient.delete as ReturnType<typeof vi.fn>).mockResolvedValue({
      message: 'deleted',
    });
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = createWrapper(queryClient);

    const createMutation = renderHook(() => useCreateBanner(), { wrapper });
    await createMutation.result.current.mutateAsync({
      imageUrl: 'https://r2.example.com/banners/create.jpg',
      linkUrl: 'https://www.heygrabit.com/performances/create',
      placement: 'home_hero',
      deviceTarget: 'all',
      status: 'active',
      sortOrder: 0,
      isActive: true,
    });

    const updateMutation = renderHook(() => useUpdateBanner('banner-1'), {
      wrapper,
    });
    await updateMutation.result.current.mutateAsync({
      placement: 'performance_detail',
      deviceTarget: 'desktop',
      status: 'paused',
    });

    const deleteMutation = renderHook(() => useDeleteBanner(), { wrapper });
    await deleteMutation.result.current.mutateAsync('banner-1');

    const reorderMutation = renderHook(() => useReorderBanners(), { wrapper });
    await reorderMutation.result.current.mutateAsync(['banner-2', 'banner-1']);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['admin', 'banners'],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['home', 'banners'],
    });
    expect(
      invalidateSpy.mock.calls.filter(
        ([options]) => options?.queryKey?.join(':') === 'home:banners',
      ),
    ).toHaveLength(4);
  });
});
