'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';

/** Manual provider reconciliation is separate from cheap local-state polling. */
export function useCheckPaymentStatus(orderId: string | null | undefined, refetch: () => Promise<unknown>) {
  const [checking, setChecking] = useState(false);
  const [providerUnavailable, setProviderUnavailable] = useState(false);
  const currentOrder = useRef(orderId);
  const inFlight = useRef(false);
  useEffect(() => {
    currentOrder.current = orderId;
    setProviderUnavailable(false);
  }, [orderId]);
  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    let unavailable = false;
    try {
      if (orderId) {
        const result = await apiClient.post<{ outcome: 'checked' | 'unavailable' | 'not_needed' }>(
          '/api/v1/payments/status-check', { orderId }, { showErrorToast: false },
        );
        unavailable = result.outcome === 'unavailable';
      }
    } catch {
      unavailable = true;
    } finally {
      try { await refetch(); } catch { unavailable = true; }
      if (currentOrder.current === orderId) setProviderUnavailable(unavailable);
      inFlight.current = false;
      setChecking(false);
    }
  }, [orderId, refetch]);
  return { check, checking, providerUnavailable };
}
