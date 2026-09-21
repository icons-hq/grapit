import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('@/stores/use-auth-store', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({
      accessToken: 'test-token',
      user: { id: '1', email: 'test@test.com' },
      setAuth: vi.fn(),
      clearAuth: vi.fn(),
    })),
  },
}));

const navigation = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@/lib/i18n/locale-navigation', () => ({ navigateToLocalizedPath: navigation.navigate }));
const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mockFetch;
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('api-client error interceptor', () => {
  it('Test 1: 400 에러 시 toast.error가 기본 메시지와 ERR-400 코드로 호출된다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: '', statusCode: 400 }),
    });

    const { apiClient } = await import('@/lib/api-client');

    await expect(apiClient.get('/test')).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(
      '잘못된 요청입니다.',
      expect.objectContaining({
        description: '오류 코드: ERR-400',
      }),
    );
  });

  it('Test 2: 403 에러 시 toast.error가 "접근 권한이 없습니다."로 호출된다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ message: '', statusCode: 403 }),
    });

    const { apiClient } = await import('@/lib/api-client');

    await expect(apiClient.get('/test')).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(
      '접근 권한이 없습니다.',
      expect.objectContaining({
        description: '오류 코드: ERR-403',
      }),
    );
  });

  it('Test 3: 404 에러 시 toast.error가 "요청하신 정보를 찾을 수 없습니다."로 호출된다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: '', statusCode: 404 }),
    });

    const { apiClient } = await import('@/lib/api-client');

    await expect(apiClient.get('/test')).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(
      '요청하신 정보를 찾을 수 없습니다.',
      expect.objectContaining({
        description: '오류 코드: ERR-404',
      }),
    );
  });

  it('Test 4: 500 에러 시 toast.error가 서버 에러 메시지로 호출된다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: '', statusCode: 500 }),
    });

    const { apiClient } = await import('@/lib/api-client');

    await expect(apiClient.get('/test')).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        description: '오류 코드: ERR-500',
      }),
    );
  });

  it('Test 5: 401 에러 시 toast.error가 호출되지 않는다', async () => {
    // First call returns 401 (the main request)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized', statusCode: 401 }),
    });
    // Second call is the refresh attempt - also fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Refresh failed', statusCode: 401 }),
    });

    const { apiClient } = await import('@/lib/api-client');

    await expect(apiClient.get('/test')).rejects.toThrow();

    expect(toast.error).not.toHaveBeenCalled();
  });

  it('returns an expired session to the same localized pending booking', async () => {
    window.history.replaceState(null, '', '/th/booking/show/confirm?resumeOrderId=kept');
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const { apiClient } = await import('@/lib/api-client');
    await expect(apiClient.get('/api/v1/reservations')).rejects.toThrow();
    expect(navigation.navigate).toHaveBeenCalledWith('/th/auth?returnTo=%2Fth%2Fbooking%2Fshow%2Fconfirm%3FresumeOrderId%3Dkept');
  });

  it('Test 6: 서버가 커스텀 message를 반환하면 기본 메시지 대신 서버 메시지 사용', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: '이메일 형식이 올바르지 않습니다.', statusCode: 400 }),
    });

    const { apiClient } = await import('@/lib/api-client');

    await expect(apiClient.get('/test')).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(
      '이메일 형식이 올바르지 않습니다.',
      expect.objectContaining({
        description: '오류 코드: ERR-400',
      }),
    );
  });

  it('Test 7: toast.error의 duration이 5000ms로 설정된다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: '', statusCode: 500 }),
    });

    const { apiClient } = await import('@/lib/api-client');

    await expect(apiClient.get('/test')).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        duration: 5000,
      }),
    );
  });

  it('suppresses the global error toast when showErrorToast is false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ message: '이미 다른 사용자가 선택한 좌석입니다.', statusCode: 409 }),
    });

    const { apiClient } = await import('@/lib/api-client');

    await expect(
      apiClient.post('/api/v1/payments/confirm', { orderId: 'GRP-LOCK' }, { showErrorToast: false }),
    ).rejects.toThrow('이미 다른 사용자가 선택한 좌석입니다.');

    expect(toast.error).not.toHaveBeenCalled();
  });

  it('Test 8: STATUS_MESSAGES에 400, 403, 404, 408, 429 키가 존재한다', async () => {
    const { STATUS_MESSAGES } = await import('@/lib/error-messages');

    expect(STATUS_MESSAGES[400]).toBeDefined();
    expect(STATUS_MESSAGES[403]).toBeDefined();
    expect(STATUS_MESSAGES[404]).toBeDefined();
    expect(STATUS_MESSAGES[408]).toBeDefined();
    expect(STATUS_MESSAGES[429]).toBeDefined();
  });
});
