'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getCatalogOptions } from '@/lib/performance/catalog-query';
import type { FilterUpdates } from '@/components/performance/catalog-filters';

export function useCatalogNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const options = getCatalogOptions(params);
  function update(updates: FilterUpdates) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) { if (value) next.set(key,value); else next.delete(key); }
    if (!('page' in updates)) next.delete('page');
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  }
  function reset() {
    const next = new URLSearchParams();
    const q = params.get('q'); if (q) next.set('q',q);
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  }
  return { params, options, update, reset };
}
