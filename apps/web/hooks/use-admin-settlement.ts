'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { FinanceLedger, FinanceLedgerExportRequest, FinanceLedgerQuery } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { apiUrl } from '@/lib/api-url';
import { useAuthStore } from '@/stores/use-auth-store';

export function useAdminFinanceLedger(query: FinanceLedgerQuery | null, enabled = true) {
  return useQuery({
    queryKey: ['admin', 'finance-ledger', query],
    queryFn: () => apiClient.get<FinanceLedger>(`/api/v1/admin/settlement/ledger?${new URLSearchParams(query as Record<string, string>)}`, { showErrorToast: false }),
    enabled: enabled && query !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useAdminFinanceExport() {
  return useMutation({ mutationFn: async (payload: FinanceLedgerExportRequest) => {
    const token = useAuthStore.getState().accessToken;
    const response = await fetch(apiUrl('/api/v1/admin/settlement/ledger/export'), {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: unknown } | null;
      throw new Error(typeof body?.message === 'string' ? body.message : 'CSV 내보내기에 실패했습니다. 다시 시도해주세요.');
    }
    const blob = await response.blob();
    const header = response.headers.get('content-disposition');
    const filename = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename ? decodeURIComponent(filename) : `finance-${payload.dataset}.csv`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  } });
}
