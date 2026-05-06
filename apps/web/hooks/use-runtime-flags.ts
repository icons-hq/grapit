'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import {
  fetchRuntimeFlags,
  getBookingDisabledCopy,
  type RuntimeFlags,
} from '@/lib/runtime-flags';

const DISABLED_DEFAULT: RuntimeFlags = { bookingEnabled: false };

export function useRuntimeFlags() {
  const locale = useLocale();
  const query = useQuery({
    queryKey: ['runtime-flags'],
    queryFn: () => fetchRuntimeFlags(),
    initialData: DISABLED_DEFAULT,
    staleTime: 30_000,
  });

  return {
    ...query.data,
    isLoading: query.isLoading,
    bookingDisabledMessage: getBookingDisabledCopy(locale),
  };
}
